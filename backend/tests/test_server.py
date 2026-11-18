"""HTTP-level regression tests; no BAR network requests are performed."""

import concurrent.futures
import csv
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest import mock

import httpx
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.app import create_app
from app.models import Replay
from app.schemas import CreateEntryRequest, StoredEntry
from app.services import (ApiError, MapAssets, REALBO_COLUMNS, canonical_replay_url,
                              fetch_map_texture, fetch_replay_snapshot, fetch_unit_icon, recording_unit_names)
from tests.recording_data import recording_csv, unit_definitions

ID1 = "56acec6a4612a888703f0b94af10d0c8"
ID2 = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
JPEG = b"\xff\xd8\xfftest image\xff\xd9"
CSV = recording_csv(
    {"start_time": "00:01", "finish_time": "00:04", "status": "finished", "player": "Alice", "team_id": 0,
     "building": "Metal Extractor, basic", "unit_def_id": 10, "unit_id": 101, "x": 100, "z": 200,
     "start_seconds": 1, "start_frame": 30, "finish_frame": 120},
    {"start_time": "00:05", "status": "removed_before_completion", "player": "Bob", "team_id": 1,
     "building": "Solar Collector", "unit_def_id": 20, "unit_id": 102, "x": 300, "z": 400,
     "start_seconds": 5, "start_frame": 150},
)


def recording_summary():
    return {
        "format": "realbo_summary", "schema_version": 1, "replay_file": "test.sdfz", "map": "Aurelia v4.1",
        "game_version": "test", "export_frame": 150, "export_time": "00:05.00", "game_over": True,
        "full_replay_captured": True, "started_frame": 0, "skipped_frames": False, "rewind_detected": False,
        "counts": {"started": 2, "buildings": 2, "units": 0, "completed": 1, "removed_before_completion": 1, "unfinished": 0},
    }


def snapshot(replay_id):
    return {
        "id": replay_id,
        "startTime": "2026-11-05T16:18:30.000Z",
        "durationMs": 4096800,
        "hostSettings": {"mapname": "Aurelia v4.1"},
        "Map": {"scriptName": "Aurelia v4.1", "fileName": "aurelia_v4.1", "width": 14, "height": 14},
        "preset": "duel",
        "AllyTeams": [
            {"winningTeam": True, "Players": [{"name": "Alice", "faction": "Cortex"}]},
            {"winningTeam": False, "Players": [{"name": "Bob", "faction": "Armada"}]},
        ],
        "nested": {"unexpected": ["fields", {"should": "be preserved"}]},
    }


class LibraryServerTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory(prefix="bar-library-test-")
        self.addCleanup(self.temp_dir.cleanup)
        self.data_file = Path(self.temp_dir.name) / "build_orders.sqlite3"
        self.fetches = []
        self.fetch_lock = threading.Lock()

        def fake_fetch(replay_id):
            with self.fetch_lock:
                self.fetches.append(replay_id)
            return snapshot(replay_id)

        self.assets_dir = Path(self.temp_dir.name) / "assets"
        self.texture_fetch = mock.Mock(return_value=JPEG)
        self.icon_fetch = mock.Mock(return_value=JPEG)
        self.app = create_app(database_file=self.data_file, fetch_snapshot=fake_fetch,
                              assets_dir=self.assets_dir, fetch_texture=self.texture_fetch, fetch_icon=self.icon_fetch)
        self.client = TestClient(self.app, base_url="http://127.0.0.1")
        self.client.__enter__()
        self.addCleanup(self.client.__exit__, None, None, None)

    def seed_entries(self, entries):
        with Session(self.app.state.engine) as session, session.begin():
            for url, entry in entries.items():
                session.add(Replay(replay_id=url.rsplit("/", 1)[-1],
                                   **StoredEntry.model_validate(entry).model_dump(exclude={"recorded_build_order"})))

    def request(self, method, route, body=None, headers=None):
        h = dict(headers or {})
        if body is not None:
            h.setdefault("Content-Type", "application/json")
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        response = self.client.request(method, route, content=body, headers=h)
        raw = response.content
        status = response.status_code
        result_headers = response.headers
        try:
            data = json.loads(raw) if raw else None
        except (ValueError, UnicodeDecodeError):
            data = raw
        return status, data, result_headers

    def test_url_canonicalization_and_restricted_host(self):
        self.assertEqual(
            canonical_replay_url(f"http://www.bar-rts.com/replays/{ID1.upper()}/"),
            f"https://bar-rts.com/replays/{ID1}"
        )
        for bad in [f"https://bar-rts.com.evil.invalid/replays/{ID1}",
                    f"https://api.bar-rts.com/replays/{ID1}",
                    "https://bar-rts.com/replays/nope"]:
            with self.subTest(bad=bad), self.assertRaises(ApiError):
                canonical_replay_url(bad)

    def test_creation_edit_immutability_duplicate_export_delete(self):
        url = f"https://bar-rts.com/replays/{ID1}"
        self.assertEqual(self.request("GET", "/api/entries")[:2], (200, {}))
        created = self.request("POST", "/api/entries", {
            "replay_url": url, "remarks": "initial", "build_order": "mex > solar"
        })
        self.assertEqual(created[0], 201)
        self.assertEqual(created[1]["entry"], {
            "bar_api": snapshot(ID1), "remarks": "initial", "build_order": "mex > solar"
        })
        self.assertEqual(self.fetches, [ID1])
        persisted = self.app.state.library.read_db()
        self.assertEqual(list(persisted), [url])
        self.assertEqual(persisted[url]["bar_api"], snapshot(ID1))

        edited = self.request("PUT", f"/api/entries/{ID1}", {
            "remarks": "Updated note", "build_order": "00:10 — 2 mex"
        })
        self.assertEqual(edited[0], 200)
        self.assertEqual(edited[1]["entry"]["bar_api"], snapshot(ID1))
        self.assertEqual(edited[1]["entry"]["build_order"], "00:10 — 2 mex")
        self.assertEqual(self.fetches, [ID1], "Editing must never refetch the BAR snapshot")

        for forbidden in [{"remarks": "x", "bar_api": {}}, {"replay_url": url}]:
            self.assertEqual(self.request("PUT", f"/api/entries/{ID1}", forbidden)[0], 400)
        self.assertEqual(self.app.state.library.read_db()[url]["bar_api"], snapshot(ID1))
        self.assertEqual(self.request("POST", "/api/entries", {"replay_url": url})[0], 409)
        self.assertEqual(self.fetches, [ID1])

        status, info, _ = self.request("GET", "/api/status")
        self.assertEqual((status, info["count"]), (200, 1))
        self.assertEqual(info["database_path"], str(self.data_file))
        status, exported, headers = self.request("GET", "/api/export")
        self.assertEqual(status, 200)
        self.assertIn("build_orders.json", headers["Content-Disposition"])
        self.assertEqual(exported, self.request("GET", "/api/entries")[1])

        self.assertEqual(self.request("DELETE", f"/api/entries/{ID1}")[0], 200)
        self.assertEqual(self.request("GET", "/api/entries")[:2], (200, {}))
        self.assertEqual(self.request("DELETE", f"/api/entries/{ID1}")[0], 404)

    def test_parallel_writes(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            responses = list(executor.map(lambda replay_id: self.request(
                "POST", "/api/entries", {"replay_url": f"https://bar-rts.com/replays/{replay_id}"}),
                [ID1, ID2]))
        self.assertEqual([response[0] for response in responses], [201, 201])
        self.assertEqual(len(self.request("GET", "/api/entries")[1]), 2)

    def test_origin_file_access_and_request_validation(self):
        self.assertEqual(self.request("GET", "/")[0], 404)
        self.assertEqual(self.request("GET", "/assets/index-test.css")[0], 404)
        self.assertEqual(self.request("GET", "/assets/index-test.js")[0], 404)
        self.assertEqual(self.request("GET", "/app.js")[0], 404)
        self.assertEqual(self.request("GET", "/recorded-build-order.js")[0], 404)
        self.assertEqual(self.request("HEAD", "/")[0], 404)
        self.assertEqual(self.request("GET", "/../server.py")[0], 404)
        self.assertEqual(self.request("GET", "/private.txt")[0], 404)
        bad_origin = self.request("POST", "/api/entries", {"replay_url": f"https://bar-rts.com/replays/{ID1}"},
                                  {"Origin": "https://untrusted.example"})
        self.assertEqual(bad_origin[0], 403)
        self.assertEqual(self.request("GET", "/api/entries", headers={"Host": "evil.example"})[0], 403)
        self.assertEqual(self.request("POST", "/api/entries", {"bar_api": {}},
                                      {"Content-Type": "application/json"})[0], 400)
        self.assertEqual(self.request("POST", "/api/entries", {"replay_url": "invalid"})[0], 400)
        self.assertEqual(self.request("POST", "/api/entries", {"replay_url": f"https://bar-rts.com/replays/{ID1}",
                                                                  "remarks": 17})[0], 400)
        self.assertEqual(self.request("POST", "/api/entries", {"replay_url": f"https://bar-rts.com/replays/{ID1}",
                                                                  "remarks": "x" * 200001})[0], 400)
        self.assertEqual(self.request("GET", "/api/entries")[1], {})

    def test_bar_api_fetch_preserves_nested_json_and_rejects_mismatched_id(self):
        requests = []

        def respond(request):
            requests.append(request)
            return httpx.Response(200, json=snapshot(ID1))

        client = httpx.Client(transport=httpx.MockTransport(respond))
        with mock.patch("app.services.httpx.Client", return_value=client):
            self.assertEqual(fetch_replay_snapshot(ID1), snapshot(ID1))
        self.assertEqual(str(requests[0].url), f"https://api.bar-rts.com/replays/{ID1}")

        client = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=snapshot(ID2))))
        with mock.patch("app.services.httpx.Client", return_value=client):
            with self.assertRaises(ApiError) as captured:
                fetch_replay_snapshot(ID1)
        self.assertEqual(captured.exception.status, 502)

    def test_upstream_error_does_not_create_entry(self):
        from app.library import ReplayLibrary

        def upstream_error(replay_id):
            raise ApiError(502, "BAR API returned HTTP 404.")

        library = ReplayLibrary(self.app.state.engine, upstream_error)
        with self.assertRaises(ApiError) as captured:
            library.create(CreateEntryRequest(replay_url=f"https://bar-rts.com/replays/{ID1}"))
        self.assertEqual(captured.exception.status, 502)
        self.assertEqual(library.read_db(), {})

    def test_map_assets_cached_deduplicated_and_refreshed_without_changing_entries(self):
        for replay_id in [ID1, ID2]:
            self.assertEqual(self.request("POST", "/api/entries", {
                "replay_url": f"https://bar-rts.com/replays/{replay_id}", "remarks": "keep me"
            })[0], 201)
        original = self.data_file.read_bytes()
        image_url = f"/api/entries/{ID1}/map-image"
        self.assertEqual(self.request("GET", image_url)[0], 404)
        self.texture_fetch.assert_not_called()
        self.assertFalse(self.assets_dir.exists())

        status, result, _ = self.request("POST", "/api/assets/refresh", {})
        self.assertEqual((status, result), (200, {"refreshed": ["aurelia_v4.1"], "failed": []}))
        self.texture_fetch.assert_called_once_with("aurelia_v4.1")
        files = list((self.assets_dir / "maps").iterdir())
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0].read_bytes(), JPEG)
        status, image, headers = self.request("GET", image_url)
        self.assertEqual((status, image, headers["Content-Type"]), (200, JPEG, "image/jpeg"))
        self.assertEqual(self.request("GET", f"/api/entries/{ID2}/map-image")[1], JPEG)
        self.assertEqual(self.request("HEAD", image_url)[:2], (200, None))
        self.assertEqual(self.request("HEAD", image_url)[2]["Content-Length"], str(len(JPEG)))
        self.assertIn("default-src 'none'", headers["Content-Security-Policy"])
        self.texture_fetch.assert_called_once()  # Reads never use the network.

        replacement = b"\xff\xd8\xffreplacement image\xff\xd9"
        self.texture_fetch.return_value = replacement
        self.assertEqual(self.request("POST", "/api/assets/refresh", {})[0], 200)
        self.assertEqual(self.request("GET", image_url)[1], replacement)
        self.texture_fetch.side_effect = ApiError(502, "Offline")
        status, result, _ = self.request("POST", "/api/assets/refresh", {})
        self.assertEqual(status, 200)
        self.assertEqual(result, {"refreshed": [], "failed": [{"map": "aurelia_v4.1", "error": "Offline"}]})
        self.assertEqual(self.request("GET", image_url)[1], replacement)
        self.assertEqual(self.data_file.read_bytes(), original)
        self.assertEqual(len(list((self.assets_dir / "maps").iterdir())), 1)
        self.assertEqual(self.fetches, [ID1, ID2])

    def test_asset_refresh_validation_and_partial_failure(self):
        self.assertEqual(self.request("POST", "/api/assets/refresh", {})[:2],
                         (200, {"refreshed": [], "failed": []}))
        self.assertFalse(self.assets_dir.exists())
        self.assertEqual(self.request("POST", "/api/assets/refresh", {},
                                      {"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.request("POST", "/api/assets/refresh", {"url": "https://evil.example"})[0], 400)
        self.assertEqual(self.request("GET", f"/api/entries/{ID1}/map-image")[0], 404)
        self.assertEqual(self.request("GET", "/assets/maps/../../server.py")[0], 404)
        self.texture_fetch.assert_not_called()

        bad = snapshot(ID2)
        bad["Map"]["fileName"] = "../server.py"
        entries = {
            f"https://bar-rts.com/replays/{ID1}": {"bar_api": snapshot(ID1)},
            f"https://bar-rts.com/replays/{ID2}": {"bar_api": bad},
        }
        self.seed_entries(entries)
        status, result, _ = self.request("POST", "/api/assets/refresh", {})
        self.assertEqual(status, 200)
        self.assertEqual(result["refreshed"], ["aurelia_v4.1"])
        self.assertEqual(len(result["failed"]), 1)
        self.texture_fetch.assert_called_once_with("aurelia_v4.1")
        self.assertEqual(self.request("GET", f"/api/entries/{ID2}/map-image")[0], 404)

    def test_asset_status_is_local_deduplicated_and_tracks_library_changes(self):
        self.assertEqual(self.request("GET", "/api/assets/status")[:2],
                         (200, {"maps": {}, "units": {}, "entries": {}}))
        csv_text = recording_csv({"start_time": "00:01", "building": "Mex", "unit_name": "armmex"},
                                 {"start_time": "00:02", "building": "Mex", "unit_name": "armmex"})
        for replay_id in (ID1, ID2):
            self.request("POST", "/api/entries", {"replay_url": f"https://bar-rts.com/replays/{replay_id}"})
            self.request("PUT", f"/api/entries/{replay_id}/recording", {"csv": csv_text})
        original = self.data_file.read_bytes()
        result = self.request("GET", "/api/assets/status")[1]
        self.assertEqual(result["maps"], {"aurelia_v4.1": {"state": "missing"}})
        self.assertEqual(result["units"], {"armmex": {"state": "missing"}})
        self.assertEqual(result["entries"][f"https://bar-rts.com/replays/{ID1}"],
                         {"map": "aurelia_v4.1", "units": ["armmex"]})
        self.texture_fetch.assert_not_called()
        self.icon_fetch.assert_not_called()
        self.assertFalse(self.assets_dir.exists(), "Status checks must not write anything")
        self.request("POST", "/api/assets/refresh", {})
        result = self.request("GET", "/api/assets/status")[1]
        self.assertEqual(result["maps"]["aurelia_v4.1"]["state"], "cached")
        self.assertEqual(result["units"]["armmex"]["state"], "cached")
        self.assertEqual(self.data_file.read_bytes(), original)
        self.assertEqual(self.texture_fetch.call_count, 1)
        self.assertEqual(self.icon_fetch.call_count, 1)
        self.request("DELETE", f"/api/entries/{ID1}/recording")
        result = self.request("GET", "/api/assets/status")[1]
        self.assertEqual(result["entries"][f"https://bar-rts.com/replays/{ID1}"]["units"], [])
        self.assertIn("armmex", result["units"], "Other replay still uses the shared icon")
        self.request("DELETE", f"/api/entries/{ID2}")
        self.assertEqual(self.request("GET", "/api/assets/status")[1]["units"], {})

    def test_asset_status_remembers_failures_across_restarts_and_successful_retry(self):
        self.request("POST", "/api/entries", {"replay_url": f"https://bar-rts.com/replays/{ID1}"})
        self.request("PUT", f"/api/entries/{ID1}/recording", {
            "csv": recording_csv({"start_time": "00:01", "building": "Mex", "unit_name": "armmex"})
        })
        original = self.data_file.read_bytes()
        self.texture_fetch.side_effect = ApiError(502, "Map offline")
        self.icon_fetch.side_effect = ApiError(502, "No artwork")
        self.request("POST", "/api/assets/refresh", {})
        result = self.request("GET", "/api/assets/status")[1]
        self.assertEqual(result["maps"]["aurelia_v4.1"], {"state": "failed", "error": "Map offline"})
        self.assertEqual(result["units"]["armmex"], {"state": "failed", "error": "No artwork"})
        assets = MapAssets(self.assets_dir, self.texture_fetch, self.icon_fetch)
        entries = self.request("GET", "/api/entries")[1]
        with assets.refresh_lock:
            self.assertEqual(assets.status(entries), result, "Status remains readable during refresh")
        self.assertTrue(assets.failures_path.is_file())
        self.texture_fetch.side_effect = self.icon_fetch.side_effect = None
        assets.refresh(entries)
        self.assertEqual(assets.status(entries)["units"]["armmex"], {"state": "cached"})
        self.icon_fetch.side_effect = ApiError(502, "Offline again")
        assets.refresh(entries)
        self.assertEqual(assets.status(entries)["units"]["armmex"],
                         {"state": "cached", "error": "Offline again"})
        self.assertEqual(assets.read_icon("armmex"), JPEG)
        self.assertEqual(self.data_file.read_bytes(), original)

    def test_asset_status_handles_missing_metadata_empty_files_and_corrupt_history(self):
        entries = {"bad": {"bar_api": {"Map": {"fileName": "../private"}},
                           "recorded_build_order": {"csv": CSV}}}
        assets = MapAssets(self.assets_dir, self.texture_fetch, self.icon_fetch)
        self.assertEqual(assets.status(entries), {"maps": {}, "units": {},
                                               "entries": {"bad": {"map": None, "units": []}}})
        assets.failures_path.parent.mkdir(parents=True)
        assets.failures_path.write_text('{broken', encoding="utf-8")
        assets = MapAssets(self.assets_dir, self.texture_fetch, self.icon_fetch)
        assets.maps_dir.mkdir()
        assets.path_for("aurelia_v4.1").write_bytes(b"")
        self.assertEqual(assets.status({"ok": {"bar_api": snapshot(ID1)}})["maps"],
                         {"aurelia_v4.1": {"state": "missing"}})
        self.texture_fetch.assert_not_called()
        self.icon_fetch.assert_not_called()

    def test_asset_refresh_releases_lock_and_keeps_cache_on_write_failure(self):
        assets = MapAssets(self.assets_dir, self.texture_fetch)
        entries = {"replay": {"bar_api": snapshot(ID1)}}
        with assets.refresh_lock:
            with self.assertRaises(ApiError) as captured:
                assets.refresh(entries)
        self.assertEqual(captured.exception.status, 409)
        self.assertEqual(assets.refresh(entries)["failed"], [])
        with mock.patch("app.services.os.replace", side_effect=OSError("Disk error")):
            self.assertEqual(len(assets.refresh(entries)["failed"]), 1)
        self.assertEqual(assets.read(entries["replay"]), JPEG)
        self.assertEqual(len(list(assets.maps_dir.iterdir())), 1)
        self.assertEqual(assets.refresh(entries)["failed"], [])

    def test_map_download_validation(self):
        with mock.patch("app.services.download", return_value=(JPEG, httpx.Headers({"Content-Type": "image/jpeg"}))) as download:
            self.assertEqual(fetch_map_texture("Aurelia v4.1"), JPEG)
            self.assertEqual(download.call_args.args[0], "https://api.bar-rts.com/maps/Aurelia%20v4.1/texture-mq.jpg")
            for name in ["../secret", "https://evil.example", "/absolute", "x\\y", "..", "bad\nname"]:
                with self.subTest(name=name), self.assertRaises(ApiError):
                    fetch_map_texture(name)
            download.assert_called_once()

            for content in [b"<html>error</html>", b"\xff\xd8\xfftruncated"]:
                download.return_value = (content, httpx.Headers({"Content-Type": "image/jpeg"}))
                with self.assertRaises(ApiError):
                    fetch_map_texture("aurelia_v4.1")
            download.return_value = (JPEG, httpx.Headers({"Content-Type": "text/html"}))
            with self.assertRaises(ApiError):
                fetch_map_texture("aurelia_v4.1")

    def test_unit_icons_shared_cached_and_refreshed_without_touching_recordings(self):
        csv_text = recording_csv({"start_time": "00:01", "building": "Mex", "unit_name": "armmex", "unit_def_id": 10},
                                 {"start_time": "00:02", "building": "Mex", "unit_name": "armmex", "unit_def_id": 10},
                                 {"start_time": "00:03", "building": "Solar", "unit_def_id": 20})
        for replay_id in [ID1, ID2]:
            self.request("POST", "/api/entries", {"replay_url": f"https://bar-rts.com/replays/{replay_id}"})
            self.request("PUT", f"/api/entries/{replay_id}/recording", {
                "csv": csv_text, "unit_map": unit_definitions({"20": {"display_name": "Solar", "internal_name": "armsolar"}})
            })
        original = self.data_file.read_bytes()
        route = "/api/assets/units/armmex"
        self.assertEqual(self.request("GET", route)[0], 404)
        self.icon_fetch.assert_not_called()
        result = self.request("POST", "/api/assets/refresh", {})[1]
        self.assertEqual(result["units_refreshed"], ["armmex", "armsolar"])
        self.assertEqual(result["units_failed"], [])
        self.assertEqual(self.icon_fetch.call_count, 2)
        self.assertEqual(len(list((self.assets_dir / "units").iterdir())), 2)
        self.assertEqual(self.request("GET", route)[:2], (200, JPEG))
        self.assertEqual(self.request("HEAD", route)[:2], (200, None))
        self.assertEqual(self.request("GET", route)[2]["Content-Type"], "image/jpeg")
        self.assertEqual(self.icon_fetch.call_count, 2, "Reads must remain offline")
        self.icon_fetch.side_effect = ApiError(502, "Offline")
        result = self.request("POST", "/api/assets/refresh", {})[1]
        self.assertEqual(len(result["units_failed"]), 2)
        self.assertEqual(self.request("GET", route)[1], JPEG)
        self.assertEqual(self.data_file.read_bytes(), original)
        self.assertEqual(len(list((self.assets_dir / "units").iterdir())), 2)
        for route in ["/api/assets/units/../server.py", "/api/assets/units/CON", "/api/assets/units/https%3Aevil", "/assets/units/armmex"]:
            self.assertEqual(self.request("GET", route)[0], 404)
        assets = MapAssets(self.assets_dir, self.texture_fetch, mock.Mock(return_value=JPEG))
        with mock.patch("app.services.os.replace", side_effect=OSError("Disk error")):
            self.assertIn("error", assets.refresh_icon("armmex"))
        self.assertEqual(assets.read_icon("armmex"), JPEG)
        self.assertEqual(len(list(assets.units_dir.iterdir())), 2)

    def test_unit_names_only_use_internal_names_not_version_dependent_numeric_ids(self):
        self.assertEqual(recording_unit_names({"recorded_build_order": {"csv":
            recording_csv({"start_time": "00:01", "building": "Metal Extractor", "unit_name": "ARMMEX"},
                          {"start_time": "00:02", "building": "Solar", "unit_name": "../../secret"},
                          {"start_time": "00:03", "building": "123", "unit_name": "123"})
        }}), {"armmex"})
        self.assertEqual(recording_unit_names({"recorded_build_order": {"csv": CSV}}), set())

    def test_unit_download_uses_only_official_sources_and_validated_images(self):
        url = "https://cdn.prod.website-files.com/5c69241780da2a1dfc6caa4e/art_armmex.webp"
        html = f'<meta content="{url}" property="og:image">'.encode()
        with mock.patch("app.services.download") as download:
            download.side_effect = [(html, {}), (JPEG, {})]
            self.assertEqual(fetch_unit_icon("armmex"), JPEG)
            self.assertEqual(download.call_args_list[0].args[0], "https://www.beyondallreason.info/unit/armmex")
            self.assertEqual(download.call_args_list[1].args[0], url)
            for bad in ["../secret", "https://evil.example", "CON", "123", "x\ny"]:
                with self.assertRaises(ApiError):
                    fetch_unit_icon(bad)
            for image_url in ["https://evil.example/image.png", "http://cdn.prod.website-files.com/image.png", url + "?url=evil", "https://cdn.prod.website-files.com@evil.example/image.png"]:
                download.reset_mock()
                download.side_effect = [(f'<meta property="og:image" content="{image_url}">'.encode(), {})]
                with self.assertRaises(ApiError):
                    fetch_unit_icon("armmex")
                download.assert_called_once()
            download.side_effect = [(html, {}), (b"<svg>unsafe</svg>", {})]
            with self.assertRaises(ApiError):
                fetch_unit_icon("armmex")

    def test_recording_persistence_export_notes_and_removal(self):
        url = f"https://bar-rts.com/replays/{ID1}"
        self.assertEqual(self.request("POST", "/api/entries", {
            "replay_url": url, "remarks": "manual notes", "build_order": "manual build order"
        })[0], 201)
        route = f"/api/entries/{ID1}/recording"
        payload = {"csv": "\ufeff" + CSV, "filename": r"C:\BAR\realbo_all_units_buildings.csv"}
        status, result, _ = self.request("PUT", route, payload)
        self.assertEqual(status, 200)
        recording = {"csv": "\ufeff" + CSV, "filename": "realbo_all_units_buildings.csv", "unit_map": None, "unit_map_filename": ""}
        self.assertEqual(result, {"replay_url": url, "recording": recording})
        entry = self.request("GET", "/api/entries")[1][url]
        self.assertEqual(entry["recorded_build_order"], recording)
        self.assertEqual(entry["bar_api"], snapshot(ID1))
        self.assertEqual(entry["remarks"], "manual notes")
        self.assertEqual(entry["build_order"], "manual build order")
        self.assertEqual(self.request("GET", "/api/export")[1][url]["recorded_build_order"], recording)
        self.assertEqual(self.request("PUT", f"/api/entries/{ID1}", {"remarks": "edited", "build_order": "edited order"})[0], 200)
        self.assertEqual(self.request("GET", "/api/entries")[1][url]["recorded_build_order"], recording)

        for mapping in [unit_definitions({"10": {"display_name": "Version-specific Extractor"}}),
                        unit_definitions({"10": {"display_name": "Extractor"}})]:
            payload.update(unit_map=mapping, unit_map_filename="unit_defs.json")
            self.assertEqual(self.request("PUT", route, payload)[1]["recording"]["unit_map"], mapping)
        # Importing the recording doesn't go through the BAR API or asset downloader.
        self.assertEqual(self.fetches, [ID1])
        self.texture_fetch.assert_not_called()
        self.assertEqual(self.request("DELETE", route)[:2], (200, {"replay_url": url, "recording": None}))
        entry = self.request("GET", "/api/entries")[1][url]
        self.assertNotIn("recorded_build_order", entry)
        self.assertEqual(entry["remarks"], "edited")
        self.assertEqual(entry["build_order"], "edited order")
        self.assertEqual(entry["bar_api"], snapshot(ID1))

    def test_mixed_buildings_and_units_preserve_type_and_mobile_assets(self):
        url = f"https://bar-rts.com/replays/{ID1}"
        self.request("POST", "/api/entries", {"replay_url": url})
        columns = REALBO_COLUMNS
        output = io.StringIO(newline="")
        writer = csv.DictWriter(output, fieldnames=columns)
        writer.writeheader()
        for kind, name, internal in [("building", "Bot Lab", "armlab"), ("unit", "Pawn", "armpw")]:
            writer.writerow({"start_time": "00:01", "building": name, "unit_name": internal, "unit_kind": kind,
                             "status": "finished", "finish_frame": "60", "builder_id": "105" if kind == "unit" else ""})
        text = output.getvalue()
        response = self.request("PUT", f"/api/entries/{ID1}/recording", {"csv": text, "filename": "realbo_all_units_buildings.csv"})
        self.assertEqual(response[0], 200)
        self.assertEqual(response[1]["recording"]["csv"], text)
        entry = self.request("GET", "/api/entries")[1][url]
        self.assertEqual(recording_unit_names(entry), {"armlab", "armpw"})
        self.assertEqual(self.request("GET", "/api/export")[1][url]["recorded_build_order"]["csv"], text)

    def test_capture_summary_persistence_backup_notes_and_removal(self):
        url = f"https://bar-rts.com/replays/{ID1}"
        self.request("POST", "/api/entries", {"replay_url": url})
        route = f"/api/entries/{ID1}/recording"
        summary = recording_summary()
        payload = {"csv": CSV, "summary": summary, "summary_filename": r"C:\BAR\realbo_summary.json",
                   "unit_map": unit_definitions({"10": {"display_name": "Extractor"}})}
        response = self.request("PUT", route, payload)
        self.assertEqual(response[0], 200)
        self.assertEqual(response[1]["recording"]["summary"], summary)
        self.assertEqual(response[1]["recording"]["summary_filename"], "realbo_summary.json")
        self.assertEqual(self.request("GET", "/api/entries")[1][url]["recorded_build_order"]["summary"], summary)
        self.assertEqual(self.request("GET", "/api/export")[1][url]["recorded_build_order"]["summary"], summary)
        self.request("PUT", f"/api/entries/{ID1}", {"remarks": "keep notes"})
        self.assertEqual(self.request("GET", "/api/entries")[1][url]["recorded_build_order"]["summary"], summary)
        payload.update(summary=None, summary_filename="")
        result = self.request("PUT", route, payload)[1]["recording"]
        self.assertIsNone(result["summary"])
        self.assertEqual(result["csv"], CSV)
        self.assertEqual(result["unit_map"], payload["unit_map"])
        self.assertEqual(self.request("GET", "/api/entries")[1][url]["remarks"], "keep notes")

    def test_invalid_capture_summary_does_not_overwrite_recording(self):
        self.request("POST", "/api/entries", {"replay_url": f"https://bar-rts.com/replays/{ID1}"})
        route = f"/api/entries/{ID1}/recording"
        summary = recording_summary()
        payload = {"csv": CSV, "summary": summary}
        self.assertEqual(self.request("PUT", route, payload)[0], 200)
        original = self.data_file.read_bytes()
        for candidate in [[], {}, {"10": "Extractor"}, {**summary, "schema_version": True},
                          {**summary, "schema_version": 2}, {**summary, "game_over": "true"},
                          {**summary, "started_frame": -1}, {**summary, "map": None},
                          {**summary, "counts": {**summary["counts"], "started": 99}},
                          {**summary, "counts": {**summary["counts"], "units": False}}]:
            with self.subTest(candidate=candidate):
                self.assertEqual(self.request("PUT", route, {**payload, "summary": candidate})[0], 400)
                self.assertEqual(self.data_file.read_bytes(), original)
        oversized = {**summary, "notes": ["x" * (1024 * 1024)]}
        self.assertEqual(self.request("PUT", route, {**payload, "summary": oversized})[0], 413)
        self.assertEqual(self.data_file.read_bytes(), original)

    def test_invalid_recording_import_keeps_existing_recording(self):
        self.request("POST", "/api/entries", {"replay_url": f"https://bar-rts.com/replays/{ID1}"})
        route = f"/api/entries/{ID1}/recording"
        self.assertEqual(self.request("PUT", route, {"csv": CSV})[0], 200)
        original = self.data_file.read_bytes()
        invalid = [
            {}, {"csv": ""}, {"csv": 7}, {"csv": "foo,bar\na,b"},
            {"csv": 'start_time,building\n00:01,"unterminated'},
            {"csv": 'start_time,building\n00:01,one,extra'},
            {"csv": 'start_time,building,building\n00:01,one,two'},
            {"csv": CSV, "bar_api": {}}, {"csv": CSV, "remarks": "no"},
            {"csv": CSV, "filename": "bad\nname.csv"},
            {"csv": CSV, "filename": "a" * 256},
            *({"csv": CSV, "unit_map": value} for value in [[], {}, {"1": []}, {"1": True}, {"1": " "}, {"units": []}]),
        ]
        for payload in invalid:
            with self.subTest(payload=str(payload)[:100]):
                self.assertEqual(self.request("PUT", route, payload)[0], 400)
                self.assertEqual(self.data_file.read_bytes(), original)
        self.assertEqual(self.request("PUT", route, {"csv": CSV}, {"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.request("DELETE", route, headers={"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.request("PUT", route, {"csv": CSV}, {"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.request("PUT", f"/api/entries/{ID1}", {"recorded_build_order": {}})[0], 400)
        self.assertEqual(self.data_file.read_bytes(), original)

    def test_recording_limits_and_missing_replay(self):
        route = f"/api/entries/{ID1}/recording"
        self.assertEqual(self.request("PUT", route, {"csv": CSV})[0], 404)
        self.assertEqual(self.request("DELETE", route)[0], 404)
        self.assertEqual(self.app.state.library.count(), 0)
        self.request("POST", "/api/entries", {"replay_url": f"https://bar-rts.com/replays/{ID1}"})
        with mock.patch("app.services.MAX_RECORDING_BYTES", 10):
            self.assertEqual(self.request("PUT", route, {"csv": CSV})[0], 413)
        with mock.patch("app.services.MAX_RECORDING_ROWS", 1):
            self.assertEqual(self.request("PUT", route, {"csv": CSV})[0], 413)
        with mock.patch("app.services.MAX_RECORDING_BODY_BYTES", 10):
            self.assertEqual(self.request("PUT", route, {"csv": CSV})[0], 413)

    def test_recording_and_note_writes_do_not_lose_each_other(self):
        url = f"https://bar-rts.com/replays/{ID1}"
        self.request("POST", "/api/entries", {"replay_url": url})
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            recording = executor.submit(self.request, "PUT", f"/api/entries/{ID1}/recording", {"csv": CSV})
            notes = executor.submit(self.request, "PUT", f"/api/entries/{ID1}", {"remarks": "concurrent", "build_order": "sequence"})
            self.assertEqual(recording.result()[0], 200)
            self.assertEqual(notes.result()[0], 200)
        entry = self.request("GET", "/api/entries")[1][url]
        self.assertEqual(entry["remarks"], "concurrent")
        self.assertEqual(entry["build_order"], "sequence")
        self.assertEqual(entry["recorded_build_order"]["csv"], CSV)
        self.assertEqual(entry["bar_api"], snapshot(ID1))

    def test_malformed_rows_are_rejected_without_overwriting(self):
        text = CSV
        header, finished, removed = list(csv.reader(io.StringIO(text)))
        self.request("POST", "/api/entries", {"replay_url": f"https://bar-rts.com/replays/{ID1}"})
        route = f"/api/entries/{ID1}/recording"
        self.assertEqual(self.request("PUT", route, {"csv": text})[0], 200)
        original = self.data_file.read_bytes()
        for row in [finished[:19], finished[:20], finished[:21], removed[:24], removed + ["extra"]]:
            output = io.StringIO(newline="")
            csv.writer(output).writerows([header, row])
            with self.subTest(row=row[:4], width=len(row)):
                response = self.request("PUT", route, {"csv": output.getvalue()})
                self.assertEqual(response[0], 400)
                self.assertIn("CSV data row 1", response[1]["error"])
                self.assertEqual(self.data_file.read_bytes(), original)
        # Do not silently pad arbitrary CSV formats or altered header layouts.
        for columns in [header[::-1], header[:-1]]:
            output = io.StringIO(newline="")
            csv.writer(output).writerows([columns, finished])
            self.assertEqual(self.request("PUT", route, {"csv": output.getvalue()})[0], 400)


if __name__ == "__main__":
    unittest.main()
