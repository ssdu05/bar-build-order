"""Additional FastAPI validation, streaming limits and database error contracts."""

from concurrent.futures import ThreadPoolExecutor
import threading

from fastapi.testclient import TestClient
import pytest
from sqlalchemy.exc import OperationalError

from app import services
from app.app import create_app
from tests.recording_data import recording_csv, unit_definitions

ID = "a" * 32
URL = f"https://bar-rts.com/replays/{ID}"


@pytest.fixture
def client(tmp_path):
    app = create_app(database_file=tmp_path / "library.sqlite3", assets_dir=tmp_path / "assets",
                     fetch_snapshot=lambda replay_id: {"id": replay_id})
    with TestClient(app, base_url="http://127.0.0.1") as client:
        yield client


@pytest.mark.parametrize("body", [b"", b"{", b"[]", b"null", b'{"remarks":NaN}', b'{"remarks":Infinity}', b"\xff"])
def test_invalid_json_envelope(client, body):
    response = client.post("/api/entries", content=body, headers={"Content-Type": "application/json"})
    assert response.status_code == 400
    assert isinstance(response.json()["error"], str)
    assert response.headers["X-Content-Type-Options"] == "nosniff"


def test_chunked_body_is_limited_before_validation(client, monkeypatch):
    monkeypatch.setattr(services, "MAX_BODY_BYTES", 10)
    response = client.post("/api/entries", content=iter([b'{"replay_url":', b'"too large"}']),
                           headers={"Content-Type": "application/json"})
    assert response.status_code == 413
    assert client.get("/api/entries").json() == {}


def test_sqlite_errors_keep_json_contract(client, monkeypatch):
    def fail():
        raise OperationalError("SELECT", {}, Exception("private database details"))

    monkeypatch.setattr(client.app.state.library, "read_db", fail)
    response = client.get("/api/entries")
    assert response.status_code == 500
    assert response.json() == {"error": "An unexpected server error occurred."}
    assert response.headers["Cache-Control"] == "no-store"


def test_concurrent_duplicate_create_is_one_insert(tmp_path):
    barrier = threading.Barrier(2)

    def fetch(replay_id):
        barrier.wait(timeout=5)
        return {"id": replay_id}

    app = create_app(database_file=tmp_path / "db.sqlite3", assets_dir=tmp_path / "assets", fetch_snapshot=fetch)
    with TestClient(app, base_url="http://localhost") as client:
        with ThreadPoolExecutor(max_workers=2) as executor:
            responses = list(executor.map(lambda _: client.post("/api/entries", json={"replay_url": URL}), range(2)))
        assert sorted(response.status_code for response in responses) == [201, 409]
        assert client.get("/api/status").json()["count"] == 1


def test_openapi_has_explicit_schemas(client):
    schema = client.get("/openapi.json").json()
    assert {"CreateEntryRequest", "NotesRequest", "RecordingRequest", "StoredEntry", "StatusResponse"} <= schema["components"]["schemas"].keys()


@pytest.mark.parametrize("payload", [{"remarks": None}, {"build_order": None}, {"unknown": "value"}])
def test_notes_accept_only_declared_text_fields(client, payload):
    assert client.post("/api/entries", json={"replay_url": URL}).status_code == 201
    assert client.put(f"/api/entries/{ID}", json=payload).status_code == 400


@pytest.mark.parametrize("mapping", [
    {"10": "Extractor"},
    {"units": {"10": "Extractor"}},
    unit_definitions({"10": {"display_name": "Extractor", "humanName": "alias"}}),
    unit_definitions({"0": {"display_name": "Extractor"}}),
])
def test_unit_definitions_require_the_current_schema(client, mapping):
    assert client.post("/api/entries", json={"replay_url": URL}).status_code == 201
    payload = {"csv": recording_csv({"start_time": "00:01", "building": "Mex"}), "unit_map": mapping}
    assert client.put(f"/api/entries/{ID}/recording", json=payload).status_code == 400
    assert "recorded_build_order" not in client.get("/api/entries").json()[URL]


@pytest.mark.parametrize("kind", ["", "structure", "unknown"])
def test_csv_requires_explicit_unit_kind(client, kind):
    assert client.post("/api/entries", json={"replay_url": URL}).status_code == 201
    payload = {"csv": recording_csv({"start_time": "00:01", "building": "Mex", "unit_kind": kind})}
    assert client.put(f"/api/entries/{ID}/recording", json=payload).status_code == 400
