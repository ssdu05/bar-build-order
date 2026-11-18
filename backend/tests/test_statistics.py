"""Statistics validation and round-trip persistence in an isolated library."""

from copy import deepcopy
import json
import re
import shutil
import subprocess

from fastapi.testclient import TestClient
import pytest

from app.app import create_app
from app.services import PROJECT_DIR
from app.statistics import RecordingStatistics, STATISTIC_KEYS
from tests.recording_data import recording_csv, unit_definitions

ID = "a" * 32
URL = f"https://bar-rts.com/replays/{ID}"


def statistics():
    return {
        "format": "realbo_statistics", "schema_version": 1,
        "replay_file": "match.sdfz", "map": "Aurelia", "game_version": "test",
        "game_speed": 30, "sample_period_frames": 150,
        "started_frame": 0, "export_frame": 300, "game_over": True,
        "full_replay_captured": True, "truncated": False,
        "metrics": ["metalIncome", "valueArmy"],
        "teams": [{"team_id": 0, "ally_team_id": 0, "player": "Alice",
                   "samples": [{"frame": 0, "values": [0, None]},
                               {"frame": 150, "values": [5.5, 100]}]}],
    }


@pytest.fixture
def client(tmp_path):
    app = create_app(database_file=tmp_path / "library.sqlite3", assets_dir=tmp_path / "assets",
                     fetch_snapshot=lambda replay_id: {"id": replay_id})
    with TestClient(app, base_url="http://127.0.0.1") as client:
        assert client.post("/api/entries", json={"replay_url": URL}).status_code == 201
        yield client


def test_statistics_roundtrip_and_independent_removal(client):
    source = statistics()
    payload = {"csv": recording_csv({"start_seconds": "1"}), "statistics": source,
               "statistics_filename": "some/folder/match_statistics.json"}
    response = client.put(f"/api/entries/{ID}/recording", json=payload)
    assert response.status_code == 200, response.text
    saved = client.get("/api/entries").json()[URL]["recorded_build_order"]
    assert saved["statistics"] == source
    assert saved["statistics_filename"] == "match_statistics.json"
    assert client.get("/api/export").json()[URL]["recorded_build_order"]["statistics"] == source
    saved["statistics"] = None
    saved["statistics_filename"] = ""
    assert client.put(f"/api/entries/{ID}/recording", json=saved).status_code == 200
    assert client.get("/api/entries").json()[URL]["recorded_build_order"]["statistics"] is None


@pytest.mark.parametrize("mutate", [
    lambda s: s.update(schema_version=2),
    lambda s: s.update(started_frame=301),
    lambda s: s.update(metrics=["unknown", "valueArmy"]),
    lambda s: s.update(metrics=["metalIncome", "metalIncome"]),
    lambda s: s["teams"].append(deepcopy(s["teams"][0])),
    lambda s: s["teams"][0]["samples"][1].update(frame=0),
    lambda s: s["teams"][0]["samples"][1].update(frame=301),
    lambda s: s["teams"][0]["samples"][1].update(values=[5]),
    lambda s: s["teams"][0]["samples"][1].update(values=[True, 100]),
    lambda s: s.update(truncated="false"),
])
def test_bad_statistics_leave_recording_untouched(client, mutate):
    valid = {"csv": recording_csv({"building": "Mex"}), "statistics": statistics()}
    assert client.put(f"/api/entries/{ID}/recording", json=valid).status_code == 200
    broken = deepcopy(valid)
    mutate(broken["statistics"])
    assert client.put(f"/api/entries/{ID}/recording", json=broken).status_code == 400
    assert client.get("/api/entries").json()[URL]["recorded_build_order"]["statistics"] == valid["statistics"]


def test_optional_unit_costs_are_version_matched_and_backwards_compatible(client):
    mapping = unit_definitions({"10": {"metal_cost": 50, "energy_cost": 600, "category": "army"}})
    payload = {"csv": recording_csv({"unit_def_id": "10"}), "unit_map": mapping}
    assert client.put(f"/api/entries/{ID}/recording", json=payload).status_code == 200
    assert client.get("/api/entries").json()[URL]["recorded_build_order"]["unit_map"] == mapping
    payload["unit_map"]["units"]["10"]["metal_cost"] = -1
    assert client.put(f"/api/entries/{ID}/recording", json=payload).status_code == 400


def test_statistics_byte_limit_and_filename_validation(client):
    source = statistics()
    source["padding"] = "x" * (10 * 1024 * 1024)
    payload = {"csv": recording_csv({"building": "Mex"}), "statistics": source}
    assert client.put(f"/api/entries/{ID}/recording", json=payload).status_code == 413
    payload["statistics"] = statistics()
    payload["statistics_filename"] = "bad\nname.json"
    assert client.put(f"/api/entries/{ID}/recording", json=payload).status_code == 400
    assert "recorded_build_order" not in client.get("/api/entries").json()[URL]


def test_statistics_survive_server_restart(tmp_path):
    options = {"database_file": tmp_path / "library.sqlite3", "assets_dir": tmp_path / "assets",
               "fetch_snapshot": lambda replay_id: {"id": replay_id}}
    with TestClient(create_app(**options), base_url="http://127.0.0.1") as client:
        client.post("/api/entries", json={"replay_url": URL})
        assert client.put(f"/api/entries/{ID}/recording", json={
            "csv": recording_csv({"building": "Mex"}), "statistics": statistics(),
        }).status_code == 200
    with TestClient(create_app(**options), base_url="http://127.0.0.1") as client:
        assert client.get("/api/entries").json()[URL]["recorded_build_order"]["statistics"] == statistics()


def test_frontend_and_backend_metric_contracts_match():
    text = (PROJECT_DIR / "frontend/src/lib/recording-statistics-schema.ts").read_text()
    metrics = re.search(r"export const statisticKeys = \[(.*?)\] as const", text, re.S).group(1)
    assert re.findall(r"'(\w+)'", metrics) == list(STATISTIC_KEYS)


@pytest.mark.skipif(not shutil.which("lua"), reason="Lua is not installed")
def test_actual_widget_export_matches_backend_contract():
    # All game APIs and writes are mocked by the Lua smoke test.
    command = '''
local files = dofile("bar_plugins/tests/recorder_export_smoke.lua")
print("STATISTICS_JSON")
print(files["LuaUI/Config/RealBO/realbo_test_statistics.json"])
'''
    result = subprocess.run(["lua", "-e", command], cwd=PROJECT_DIR,
                            check=True, capture_output=True, text=True)
    raw = json.loads(result.stdout.split("STATISTICS_JSON\n")[1])
    parsed = RecordingStatistics.model_validate(raw)
    assert parsed.metrics == list(STATISTIC_KEYS)
    assert len(parsed.teams) == 2
    assert parsed.teams[0].samples[-1].frame == 150
