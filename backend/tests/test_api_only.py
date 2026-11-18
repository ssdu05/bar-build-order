"""The backend never serves the frontend build, source, caches or database."""

from pathlib import Path

from fastapi.testclient import TestClient
import pytest

from app import services
from app.app import create_app
from app.database import migration_config


@pytest.fixture
def client(tmp_path, monkeypatch):
    # A build on disk must not turn the API into a frontend/static server.
    frontend = tmp_path / "frontend" / "dist"
    (frontend / "assets").mkdir(parents=True)
    (frontend / "index.html").write_text('<div id="root"></div>', encoding="utf-8")
    (frontend / "assets" / "index-123.js").write_text("export {};", encoding="utf-8")
    monkeypatch.chdir(tmp_path)
    app = create_app(database_file=tmp_path / "library.sqlite3", assets_dir=tmp_path / "assets")
    with TestClient(app, base_url="http://127.0.0.1") as client:
        yield client


@pytest.mark.parametrize("method", ["GET", "HEAD"])
@pytest.mark.parametrize("path", [
    "/", "/index.html", "/favicon.svg", "/unit-placeholder.svg",
    "/assets/index-123.js", "/assets/index-123.css", "/assets/source.js.map",
    "/frontend/dist/index.html", "/src/App.tsx", "/private.json",
    "/assets/%2e%2e%2fprivate.json", "/assets/%2e%2e%5cprivate.json",
    "/build_orders.sqlite3", "/server.py",
])
def test_non_api_files_are_not_served(client, method, path):
    response = client.request(method, path)
    assert response.status_code == 404
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    if method == "GET":
        assert response.json() == {"error": "Not Found"}
    else:
        assert response.content == b""


def test_api_works_without_a_frontend_build(tmp_path):
    app = create_app(database_file=tmp_path / "library.sqlite3", assets_dir=tmp_path / "assets")
    with TestClient(app, base_url="http://127.0.0.1") as client:
        assert client.get("/api/entries").json() == {}
        assert client.get("/api/status").json()["storage"] == "sqlite"
        assert client.get("/").status_code == 404


def test_api_security_headers(client):
    response = client.get("/api/status")
    assert response.headers["Cache-Control"] == "no-store"
    csp = response.headers["Content-Security-Policy"]
    assert "default-src 'none';" in csp
    assert "frame-ancestors 'none';" in csp
    assert "unsafe-inline" not in csp


def test_default_storage_and_migrations_ignore_working_directory(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    backend = Path(__file__).resolve().parents[1]
    project = backend.parent
    assert services.DEFAULT_DATABASE_FILE == project / "build_orders.sqlite3"
    assert services.DEFAULT_ASSETS_DIR == project / "assets"
    config = migration_config()
    assert Path(config.config_file_name) == backend / "alembic.ini"
    assert Path(config.get_main_option("script_location")) == backend / "migrations"
