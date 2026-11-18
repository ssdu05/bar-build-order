"""Recording validation, bounded BAR downloads, and local artwork caches."""

from __future__ import annotations

import csv
from concurrent.futures import ThreadPoolExecutor
import hashlib
from html.parser import HTMLParser
import io
import json
import os
from pathlib import Path
import re
import tempfile
import threading
from typing import Any, Callable
from urllib.parse import quote, urlsplit
import httpx

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_DIR = BACKEND_DIR.parent
DEFAULT_DATABASE_FILE = PROJECT_DIR / "build_orders.sqlite3"
DEFAULT_ASSETS_DIR = PROJECT_DIR / "assets"
DEFAULT_PORT = 4173
MAX_BODY_BYTES = 1024 * 1024
MAX_API_BYTES = 5 * 1024 * 1024
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_RECORDING_BYTES = 10 * 1024 * 1024
MAX_RECORDING_BODY_BYTES = 40 * 1024 * 1024
MAX_RECORDING_ROWS = 50_000
REALBO_COLUMNS = (
    "start_time", "finish_time", "removed_time", "status", "player", "team_id",
    "building", "unit_name", "unit_def_id", "unit_id", "builder_id", "builder_name",
    "x", "y", "z", "facing", "start_seconds", "finish_seconds", "removed_seconds",
    "start_frame", "finish_frame", "removed_frame", "owner_at_end", "map", "replay_file", "unit_kind",
)
MAX_TEXT_LENGTH = 200_000
REPLAY_ID_RE = re.compile(r"^[a-f0-9]{32}$", re.IGNORECASE)
REPLAY_URL_RE = re.compile(
    r"^https?://(?:www\.)?bar-rts\.com/replays/([a-f0-9]{32})/?$", re.IGNORECASE
)
LOCAL_HOST_RE = re.compile(r"^(?:127\.0\.0\.1|localhost)(?::\d{1,5})?$", re.IGNORECASE)
MAP_FILE_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_. -]{0,199}$")
UNIT_NAME_RE = re.compile(r"^[a-z][a-z0-9_]{0,79}$")
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Content-Security-Policy": (
        "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
    ),
}


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def canonical_replay_url(raw: Any) -> str:
    if not isinstance(raw, str):
        raise ApiError(400, "Please enter a BAR replay URL.")
    match = REPLAY_URL_RE.fullmatch(raw.strip())
    if not match:
        raise ApiError(400, "Use a URL like https://bar-rts.com/replays/<32-character replay ID>.")
    return f"https://bar-rts.com/replays/{match.group(1).lower()}"


def load_json(text: str) -> Any:
    # Python's JSON decoder would otherwise allow nonstandard NaN/Infinity literals.
    def reject_constant(value: str) -> None:
        raise ValueError(f"Invalid JSON constant: {value}")

    return json.loads(text, parse_constant=reject_constant)


def validate_recording_summary(summary: Any) -> dict[str, Any]:
    if not isinstance(summary, dict) or summary.get("format") != "realbo_summary" or type(summary.get("schema_version")) is not int or summary["schema_version"] != 1:
        raise ApiError(400, "Choose a RealBO _summary.json file (schema version 1).")
    if len(json.dumps(summary, ensure_ascii=False).encode("utf-8")) > 1024 * 1024:
        raise ApiError(413, "Summary JSON must be at most 1 MiB.")
    for key in ("replay_file", "map", "game_version", "export_time"):
        if not isinstance(summary.get(key), str) or len(summary[key]) > 1024:
            raise ApiError(400, f"Invalid summary {key}.")
    for key in ("game_over", "full_replay_captured", "skipped_frames", "rewind_detected"):
        if type(summary.get(key)) is not bool:
            raise ApiError(400, f"Invalid summary {key}: expected a boolean.")
    for key in ("started_frame", "export_frame"):
        if type(summary.get(key)) is not int or not 0 <= summary[key] <= 2**53 - 1:
            raise ApiError(400, f"Invalid summary {key}: expected a nonnegative integer.")
    counts = summary.get("counts")
    for key in ("started", "buildings", "units", "completed", "removed_before_completion", "unfinished"):
        if not isinstance(counts, dict) or type(counts.get(key)) is not int or not 0 <= counts[key] <= 2**53 - 1:
            raise ApiError(400, f"Invalid summary count: {key}.")
    if counts["started"] != counts["buildings"] + counts["units"] or counts["started"] != counts["completed"] + counts["removed_before_completion"] + counts["unfinished"]:
        raise ApiError(400, "Summary counts do not add up.")
    return summary


def validate_recording(payload: Any) -> dict[str, Any]:
    """Keep CSV, optional unit definitions, and capture summary, not executable HTML."""
    permitted = {"csv", "filename", "unit_map", "unit_map_filename", "summary", "summary_filename", "statistics", "statistics_filename"}
    if not isinstance(payload, dict) or set(payload) - permitted:
        raise ApiError(400, "Expected recording CSV, filename, optional unit mapping and summary only.")
    text = payload.get("csv")
    if not isinstance(text, str) or not text.strip():
        raise ApiError(400, "Choose a RealBO _all_units_buildings.csv file.")
    if len(text.encode("utf-8")) > MAX_RECORDING_BYTES:
        raise ApiError(413, "Recording CSV must be at most 10 MiB.")
    try:
        rows = csv.reader(io.StringIO(text.lstrip("\ufeff"), newline=""), strict=True)
        headers = next(rows)
        if tuple(headers) != REALBO_COLUMNS:
            raise ApiError(400, "Expected the current RealBO _all_units_buildings.csv columns, including unit_kind.")
        count = 0
        for row in rows:
            if not row or not any(row):
                continue
            if len(row) != len(headers):
                raise ApiError(400, f"CSV data row {count + 1} has {len(row)} columns; expected {len(headers)}.")
            if row[-1] not in ("building", "unit"):
                raise ApiError(400, f"CSV data row {count + 1} must have unit_kind building or unit.")
            count += 1
            if count > MAX_RECORDING_ROWS:
                raise ApiError(413, "Recording CSV has too many records (max 50,000).")
    except (csv.Error, StopIteration):
        raise ApiError(400, "Invalid recording CSV.") from None
    mapping = payload.get("unit_map")
    if mapping is not None:
        if not isinstance(mapping, dict):
            raise ApiError(400, "Unit mapping must be a JSON object.")
        if len(json.dumps(mapping, ensure_ascii=False).encode("utf-8")) > 5 * 1024 * 1024:
            raise ApiError(413, "Unit mapping must be at most 5 MiB.")
    result = {"csv": text, "unit_map": mapping}
    filename_fields = [("filename", "recording.csv"), ("unit_map_filename", "")]
    if "statistics" in payload or "statistics_filename" in payload:
        statistics = payload.get("statistics")
        if statistics is not None:
            if not isinstance(statistics, dict):
                raise ApiError(400, "Statistics must be a JSON object.")
            if len(json.dumps(statistics, ensure_ascii=False).encode("utf-8")) > 10 * 1024 * 1024:
                raise ApiError(413, "Statistics JSON must be at most 10 MiB.")
        result["statistics"] = statistics
        filename_fields.append(("statistics_filename", ""))
    if "summary" in payload or "summary_filename" in payload:
        summary = payload.get("summary")
        result["summary"] = validate_recording_summary(summary) if summary is not None else None
        filename_fields.append(("summary_filename", ""))
    for field, default in filename_fields:
        name = payload.get(field, default)
        if not isinstance(name, str) or len(name) > 255 or any(ord(char) < 32 for char in name):
            raise ApiError(400, "Recording filenames must be short, printable text.")
        # Names are display metadata only; never use a supplied path for file I/O.
        result[field] = name.replace("\\", "/").rsplit("/", 1)[-1]
    return result


def download(url: str, *, accept: str, maximum: int, label: str) -> tuple[bytes, httpx.Headers]:
    """Stream decoded bytes with a hard limit; redirects are never followed."""
    try:
        with httpx.Client(timeout=18, follow_redirects=False, trust_env=False) as client:
            with client.stream("GET", url, headers={"Accept": accept}) as response:
                if not 200 <= response.status_code < 300:
                    raise ApiError(502, f"{label} returned HTTP {response.status_code}.")
                claimed = response.headers.get("Content-Length", "")
                if claimed.isdigit() and int(claimed) > maximum:
                    raise ApiError(502, f"{label} response is unexpectedly large.")
                raw = bytearray()
                for chunk in response.iter_bytes(chunk_size=64 * 1024):
                    raw.extend(chunk)
                    if len(raw) > maximum:
                        raise ApiError(502, f"{label} response is unexpectedly large.")
                return bytes(raw), response.headers
    except (httpx.HTTPError, OSError) as error:
        raise ApiError(502, f"Could not reach {label}: {error}") from error


def fetch_replay_snapshot(replay_id: str) -> dict[str, Any]:
    """Fetch the complete upstream JSON once. No untrusted URLs are requested."""
    endpoint = f"https://api.bar-rts.com/replays/{replay_id}"
    raw, _ = download(endpoint, accept="application/json", maximum=MAX_API_BYTES, label="BAR replay API")
    try:
        result = load_json(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise ApiError(502, "BAR API did not return valid JSON.") from None
    if (not isinstance(result, dict)
            or not isinstance(result.get("id"), str)
            or result["id"].lower() != replay_id):
        raise ApiError(502, "BAR API did not return a matching replay.")
    return result


def map_file_for(entry: Any) -> str:
    api = entry.get("bar_api") if isinstance(entry, dict) else None
    metadata = api.get("Map") if isinstance(api, dict) else None
    name = metadata.get("fileName") if isinstance(metadata, dict) else None
    if not isinstance(name, str) or not MAP_FILE_RE.fullmatch(name):
        raise ApiError(404, "This replay has no usable map asset filename in its saved snapshot.")
    return name


def fetch_map_texture(map_file: str) -> bytes:
    """Only fetch a bounded JPEG from the official map endpoint, without redirects."""
    if not MAP_FILE_RE.fullmatch(map_file):
        raise ApiError(400, "Invalid map asset filename.")
    endpoint = f"https://api.bar-rts.com/maps/{quote(map_file, safe='')}/texture-mq.jpg"
    raw, headers = download(endpoint, accept="image/jpeg", maximum=MAX_IMAGE_BYTES, label="BAR map API")
    if headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "image/jpeg":
        raise ApiError(502, "BAR did not return a JPEG map image.")
    if not raw.startswith(b"\xff\xd8\xff") or not raw.endswith(b"\xff\xd9"):
        raise ApiError(502, "BAR returned an invalid JPEG map image.")
    return raw


def icon_type(raw: bytes) -> str:
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if raw.startswith(b"\xff\xd8\xff") and raw.endswith(b"\xff\xd9"):
        return "image/jpeg"
    if raw.startswith(b"RIFF") and raw[8:12] == b"WEBP":
        return "image/webp"
    raise ApiError(502, "BAR returned an unsupported unit image.")


def fetch_unit_icon(name: str) -> bytes:
    """Resolve official unit-page artwork; never follow user-supplied URLs."""
    if not UNIT_NAME_RE.fullmatch(name):
        raise ApiError(400, "Invalid internal unit name.")

    class ImageParser(HTMLParser):
        image = ""

        def handle_starttag(self, tag, attrs):
            values = dict(attrs)
            if tag == "meta" and values.get("property") == "og:image":
                self.image = values.get("content", "")

    try:
        html, _ = download(f"https://www.beyondallreason.info/unit/{name}", accept="text/html",
                           maximum=MAX_API_BYTES, label="BAR unit page")
        parser = ImageParser()
        parser.feed(html.decode("utf-8"))
        image = urlsplit(parser.image)
        if (image.scheme != "https" or image.netloc != "cdn.prod.website-files.com"
                or not re.fullmatch(r"/[a-f0-9]{24}/[a-zA-Z0-9_.%()-]+", image.path)
                or image.query or image.fragment):
            raise ApiError(502, "No supported official artwork found for this unit.")
        raw, _ = download(parser.image, accept="image/webp,image/png,image/jpeg",
                          maximum=MAX_IMAGE_BYTES, label="BAR unit image")
        icon_type(raw)
        return raw
    except UnicodeDecodeError as error:
        raise ApiError(502, f"Could not download BAR unit artwork: {error}") from error


def recording_unit_names(entry: Any) -> set[str]:
    recording = entry.get("recorded_build_order") if isinstance(entry, dict) else None
    if not isinstance(recording, dict) or not isinstance(recording.get("csv"), str):
        return set()
    mapping = recording.get("unit_map") or {}
    source = mapping.get("units", {})
    result = set()
    try:
        for row in csv.DictReader(io.StringIO(recording["csv"].lstrip("\ufeff"), newline="")):
            unit = source.get(str(row.get("unit_def_id", "")), {}) if isinstance(source, dict) else {}
            name = row.get("unit_name") or (unit.get("internal_name", "") if isinstance(unit, dict) else "")
            if isinstance(name, str) and UNIT_NAME_RE.fullmatch(name.strip().lower()):
                result.add(name.strip().lower())
    except csv.Error:
        pass  # A manually edited invalid recording must not prevent map refreshes.
    return result


class MapAssets:
    """Shared map/unit image caches; replay snapshots are never modified."""

    def __init__(self, assets_dir: Path,
                 fetch_texture: Callable[[str], bytes] = fetch_map_texture,
                 fetch_icon: Callable[[str], bytes] = fetch_unit_icon):
        self.maps_dir = Path(assets_dir).expanduser().resolve() / "maps"
        self.units_dir = self.maps_dir.parent / "units"
        self.fetch_texture = fetch_texture
        self.fetch_icon = fetch_icon
        self.refresh_lock = threading.Lock()
        self.failures_path = self.maps_dir.parent / "refresh-failures.json"
        try:
            failures = json.loads(self.failures_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            failures = {}
        self.failures = {
            kind: {name: error for name, error in source.items() if isinstance(error, str)}
            for kind in ("maps", "units")
            for source in [failures.get(kind, {}) if isinstance(failures, dict) else {}]
            if isinstance(source, dict)
        }

    def status(self, entries: dict[str, Any]) -> dict[str, Any]:
        """Check each unique local file once; never download or read image bytes."""
        maps, units, references = {}, {}, {}
        failures = self.failures

        def state(path: Path, kind: str, name: str) -> dict[str, str]:
            error = failures.get(kind, {}).get(name)
            try:
                cached = path.is_file() and path.stat().st_size > 0
            except OSError:
                cached = False
            result = {"state": "cached" if cached else "failed" if error else "missing"}
            if error:
                result["error"] = error
            return result

        for url, entry in entries.items():
            map_name = None
            try:
                map_name = map_file_for(entry)
                if map_name not in maps:
                    maps[map_name] = state(self.path_for(map_name), "maps", map_name)
            except ApiError:
                pass  # Missing metadata cannot be fixed by an asset download.
            unit_names = sorted(recording_unit_names(entry))
            for name in unit_names:
                if name not in units:
                    units[name] = state(self.icon_path(name), "units", name)
            references[url] = {"map": map_name, "units": unit_names}
        return {"maps": maps, "units": units, "entries": references}

    def save_failures(self, result: dict[str, Any]) -> None:
        # Keep failure history separate from the user's library and artwork.
        self.failures = {
            "maps": {item["map"]: item["error"] for item in result["failed"]},
            "units": {item["unit"]: item["error"] for item in result.get("units_failed", [])},
        }
        if not any(self.failures.values()) and not self.failures_path.exists():
            return
        temporary_path = None
        try:
            self.failures_path.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.failures_path.parent,
                                             prefix=".asset-status-", suffix=".tmp", delete=False) as temporary:
                temporary_path = Path(temporary.name)
                json.dump(self.failures, temporary, ensure_ascii=False)
                temporary.flush()
                os.fsync(temporary.fileno())
            os.replace(temporary_path, self.failures_path)
        except OSError:
            result["status_warning"] = "Failure history could not be saved; unavailable assets may be marked missing after restarting the server."
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)

    def path_for(self, map_file: str) -> Path:
        # Hashes avoid traversal, reserved Windows names, and filename collisions.
        key = hashlib.sha256(map_file.encode("utf-8")).hexdigest()
        return self.maps_dir / f"{key}.jpg"

    def read(self, entry: Any) -> bytes:
        try:
            return self.path_for(map_file_for(entry)).read_bytes()
        except FileNotFoundError:
            raise ApiError(404, "Map image is not cached. Click Refresh assets to download it.") from None

    def icon_path(self, name: str) -> Path:
        if not UNIT_NAME_RE.fullmatch(name):
            raise ApiError(400, "Invalid internal unit name.")
        return self.units_dir / f"{hashlib.sha256(name.encode('utf-8')).hexdigest()}.img"

    def read_icon(self, name: str) -> bytes:
        try:
            return self.icon_path(name).read_bytes()
        except FileNotFoundError:
            raise ApiError(404, "Unit icon is not cached. Click Refresh assets.") from None

    def refresh_icon(self, name: str) -> dict[str, str]:
        temporary_path = None
        try:
            raw = self.fetch_icon(name)
            icon_type(raw)
            self.units_dir.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(mode="wb", dir=self.units_dir,
                                             prefix=".unit-", suffix=".tmp", delete=False) as temporary:
                temporary_path = Path(temporary.name)
                temporary.write(raw)
                temporary.flush()
                os.fsync(temporary.fileno())
            os.replace(temporary_path, self.icon_path(name))
            return {"unit": name}
        except (ApiError, OSError) as error:
            return {"unit": name, "error": str(error)}
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)

    def refresh(self, entries: dict[str, Any]) -> dict[str, Any]:
        if not self.refresh_lock.acquire(blocking=False):
            raise ApiError(409, "An asset refresh is already running.")
        try:
            names = set()
            failed = []
            refreshed = []
            for url, entry in entries.items():
                try:
                    names.add(map_file_for(entry))
                except ApiError as error:
                    failed.append({"map": url, "error": str(error)})
            for name in sorted(names):
                temporary_path = None
                try:
                    raw = self.fetch_texture(name)
                    self.maps_dir.mkdir(parents=True, exist_ok=True)
                    with tempfile.NamedTemporaryFile(mode="wb", dir=self.maps_dir,
                                                     prefix=".map-", suffix=".tmp", delete=False) as temporary:
                        temporary_path = Path(temporary.name)
                        temporary.write(raw)
                        temporary.flush()
                        os.fsync(temporary.fileno())
                    os.replace(temporary_path, self.path_for(name))
                    refreshed.append(name)
                except (ApiError, OSError) as error:
                    failed.append({"map": name, "error": str(error)})
                finally:
                    if temporary_path is not None:
                        temporary_path.unlink(missing_ok=True)
            result = {"refreshed": refreshed, "failed": failed}
            units = set().union(*(recording_unit_names(entry) for entry in entries.values()))
            if units:
                with ThreadPoolExecutor(max_workers=6) as executor:
                    outcomes = list(executor.map(self.refresh_icon, sorted(units)))
                result["units_refreshed"] = [item["unit"] for item in outcomes if "error" not in item]
                result["units_failed"] = [item for item in outcomes if "error" in item]
            self.save_failures(result)
            return result
        finally:
            self.refresh_lock.release()
