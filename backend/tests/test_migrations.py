"""Real SQLite/Alembic tests, using disposable databases and no network."""

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import inspect
from sqlalchemy.exc import DatabaseError, IntegrityError
from sqlalchemy.orm import Session

from app.app import create_app
from app.database import make_engine, migration_config, upgrade_database
from app.models import Base, Replay
from tests.recording_data import recording_csv

ID = "a" * 32
URL = f"https://bar-rts.com/replays/{ID}"


@pytest.fixture
def engine(tmp_path):
    engine = make_engine(tmp_path / "library.sqlite3")
    yield engine
    engine.dispose()


def test_upgrade_matches_models_and_is_repeatable(engine):
    upgrade_database(engine)
    upgrade_database(engine)
    with engine.connect() as connection:
        assert connection.exec_driver_sql("SELECT version_num FROM alembic_version").scalar_one() == "0001"
        assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []
        assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1
    assert set(inspect(engine).get_table_names()) == {"replays", "alembic_version"}


def test_downgrade_and_upgrade(engine):
    upgrade_database(engine)
    config = migration_config()
    with engine.begin() as connection:
        config.attributes["connection"] = connection
        command.downgrade(config, "base")
    assert "replays" not in inspect(engine).get_table_names()
    upgrade_database(engine)
    assert "replays" in inspect(engine).get_table_names()


def test_persistence_export_and_restart(tmp_path):
    database = tmp_path / "library.sqlite3"
    snapshot = {"id": ID, "arbitrary": {"nested": [1, None, "é"]}}

    def app():
        return create_app(database_file=database, assets_dir=tmp_path / "assets",
                          fetch_snapshot=lambda replay_id: snapshot)

    recording = {"csv": recording_csv({"start_time": "00:01", "building": "Mex"})}
    with TestClient(app(), base_url="http://localhost") as client:
        assert client.get("/api/entries").json() == {}
        assert client.post("/api/entries", json={"replay_url": URL, "remarks": "notes"}).status_code == 201
        assert client.put(f"/api/entries/{ID}/recording", json=recording).status_code == 200
        saved = client.get("/api/export").json()
        assert saved[URL]["bar_api"] == snapshot
        assert client.get("/api/status").json() == {"database_path": str(database), "storage": "sqlite", "count": 1}

    with TestClient(app(), base_url="http://localhost") as client:
        assert client.get("/api/entries").json() == saved
        assert client.put(f"/api/entries/{ID}", json={"remarks": "updated"}).status_code == 200
        entry = client.get("/api/entries").json()[URL]
        assert entry["bar_api"] == snapshot
        assert entry["recorded_build_order"] == saved[URL]["recorded_build_order"]
        assert client.delete(f"/api/entries/{ID}").status_code == 200

    with TestClient(app(), base_url="http://localhost") as client:
        assert client.get("/api/entries").json() == {}


def test_database_constraint_prevents_duplicate_replays(engine):
    upgrade_database(engine)
    with Session(engine) as session, session.begin():
        session.add(Replay(replay_id=ID, bar_api={}, remarks="", build_order=""))
    with pytest.raises(IntegrityError):
        with Session(engine) as session, session.begin():
            session.add(Replay(replay_id=ID, bar_api={}, remarks="", build_order=""))


def test_invalid_database_is_not_overwritten(tmp_path):
    database = tmp_path / "broken.sqlite3"
    database.write_bytes(b"not a SQLite database")
    engine = make_engine(database)
    try:
        with pytest.raises(DatabaseError):
            upgrade_database(engine)
        assert database.read_bytes() == b"not a SQLite database"
    finally:
        engine.dispose()
