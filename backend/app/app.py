"""FastAPI routes with local-only security and bounded JSON request bodies."""

from contextlib import asynccontextmanager
import json
import logging
import os
from pathlib import Path
from typing import Annotated, Any, Callable

from fastapi import FastAPI, Path as ApiPath, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException

from app import services
from app.database import make_engine, upgrade_database
from app.library import ReplayLibrary
from app.schemas import (
    AssetRefreshResponse, AssetStatusResponse, CreateEntryRequest, DeleteResponse,
    EntryResponse, ErrorResponse, NotesRequest, RecordingRequest, RecordingResponse,
    StatusResponse, StoredEntry, StrictModel,
)

ReplayId = Annotated[str, ApiPath(pattern=r"^[a-fA-F0-9]{32}$")]
UnitName = Annotated[str, ApiPath(pattern=r"^[a-z][a-z0-9_]{0,79}$")]
logger = logging.getLogger(__name__)


class LocalRequestMiddleware:
    """Pure ASGI middleware: cap streamed bytes before FastAPI parses JSON."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def secure_send(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.extend((key.lower().encode(), value.encode())
                               for key, value in services.SECURITY_HEADERS.items())
                if not any(key == b"cache-control" for key, _ in headers):
                    headers.append((b"cache-control", b"no-store" if scope["path"].startswith("/api/") else b"no-cache"))
                message = {**message, "headers": headers}
            elif message["type"] == "http.response.body" and scope["method"] == "HEAD":
                message = {**message, "body": b""}
            await send(message)

        async def reject(status, message):
            await JSONResponse({"error": message}, status_code=status)(scope, receive, secure_send)

        request = Request(scope)
        host = request.headers.get("host", "")
        if not services.LOCAL_HOST_RE.fullmatch(host):
            return await reject(403, "Only local browser connections are permitted.")
        if scope["method"] not in ("GET", "HEAD"):
            origin = request.headers.get("origin")
            if origin and origin != f"http://{host}":
                return await reject(403, "Requests from other websites are not allowed.")

        if scope["method"] in ("POST", "PUT", "PATCH"):
            content_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
            if content_type != "application/json":
                return await reject(415, "Send application/json.")
            maximum = (services.MAX_RECORDING_BODY_BYTES if scope["path"].endswith("/recording")
                       else services.MAX_BODY_BYTES)
            claimed = request.headers.get("content-length")
            if claimed is not None and (not claimed.isdigit() or int(claimed) > maximum):
                return await reject(413 if claimed.isdigit() else 400, "Invalid or oversized request length.")
            body = bytearray()
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                body.extend(message.get("body", b""))
                if len(body) > maximum:
                    return await reject(413, "Request is too large.")
                if not message.get("more_body", False):
                    break
            try:
                payload = services.load_json(body.decode("utf-8"))
                if not isinstance(payload, dict):
                    return await reject(400, "Expected a JSON object.")
            except (UnicodeDecodeError, ValueError):
                return await reject(400, "Invalid JSON body.")

            async def replay_body():
                return {"type": "http.request", "body": bytes(body), "more_body": False}

            return await self.app(scope, replay_body, secure_send)
        await self.app(scope, receive, secure_send)


def create_app(*, database_file: Path | None = None, assets_dir: Path = services.DEFAULT_ASSETS_DIR,
               fetch_snapshot: Callable[[str], dict[str, Any]] = services.fetch_replay_snapshot,
               fetch_texture: Callable[[str], bytes] = services.fetch_map_texture,
               fetch_icon: Callable[[str], bytes] = services.fetch_unit_icon) -> FastAPI:
    database_file = Path(database_file or os.environ.get("BAR_DATABASE_FILE", services.DEFAULT_DATABASE_FILE)).expanduser().resolve()
    assets = services.MapAssets(assets_dir, fetch_texture, fetch_icon)

    @asynccontextmanager
    async def lifespan(application: FastAPI):
        engine = make_engine(database_file)
        try:
            upgrade_database(engine)
            application.state.library = ReplayLibrary(engine, fetch_snapshot)
            application.state.engine = engine
            yield
        finally:
            engine.dispose()

    application = FastAPI(title="BAR Build Order Library", version="2.0.0", lifespan=lifespan,
                          docs_url=None, redoc_url=None,
                          responses={400: {"model": ErrorResponse}, 404: {"model": ErrorResponse}})
    application.state.database_file = database_file
    application.state.assets = assets
    application.add_middleware(LocalRequestMiddleware)

    @application.exception_handler(services.ApiError)
    async def api_error(request: Request, error: services.ApiError):
        return JSONResponse({"error": str(error)}, status_code=error.status)

    @application.exception_handler(RequestValidationError)
    async def validation_error(request: Request, error: RequestValidationError):
        first = error.errors()[0]
        if first["loc"][0] == "path":
            return JSONResponse({"error": "Not found."}, status_code=404)
        field = ".".join(str(part) for part in first["loc"][1:])
        return JSONResponse({"error": f"{field}: {first['msg']}".lstrip(": ")}, status_code=400)

    @application.exception_handler(HTTPException)
    async def http_error(request: Request, error: HTTPException):
        return JSONResponse({"error": str(error.detail)}, status_code=error.status_code, headers=error.headers)

    async def storage_error(request: Request, error: Exception):
        logger.error("Local backend operation failed", exc_info=error)
        return JSONResponse({"error": "An unexpected server error occurred."}, status_code=500)

    application.add_exception_handler(SQLAlchemyError, storage_error)
    application.add_exception_handler(OSError, storage_error)
    application.add_exception_handler(ValueError, storage_error)
    application.add_exception_handler(TypeError, storage_error)

    def library() -> ReplayLibrary:
        return application.state.library

    @application.get("/api/status", response_model=StatusResponse)
    def status():
        return {"database_path": str(database_file), "storage": "sqlite", "count": library().count()}

    @application.get("/api/entries", response_model=dict[str, StoredEntry], response_model_exclude_unset=True)
    def entries():
        return library().read_db()

    @application.get("/api/export")
    def export():
        body = json.dumps(library().read_db(), indent=2, ensure_ascii=False, allow_nan=False) + "\n"
        return Response(body, media_type="application/json", headers={
            "Content-Disposition": 'attachment; filename="build_orders.json"',
        })

    @application.post("/api/entries", status_code=201, response_model=EntryResponse, response_model_exclude_unset=True)
    def create_entry(payload: CreateEntryRequest):
        return library().create(payload)

    @application.put("/api/entries/{replay_id}", response_model=EntryResponse, response_model_exclude_unset=True)
    def update_entry(replay_id: ReplayId, payload: NotesRequest):
        return library().update(replay_id, payload)

    @application.delete("/api/entries/{replay_id}", response_model=DeleteResponse)
    def delete_entry(replay_id: ReplayId):
        return library().delete(replay_id)

    @application.put("/api/entries/{replay_id}/recording", response_model=RecordingResponse, response_model_exclude_unset=True)
    def set_recording(replay_id: ReplayId, payload: RecordingRequest):
        return library().set_recording(replay_id, payload)

    @application.delete("/api/entries/{replay_id}/recording", response_model=RecordingResponse, response_model_exclude_unset=True)
    def delete_recording(replay_id: ReplayId):
        return library().set_recording(replay_id)

    @application.get("/api/assets/status", response_model=AssetStatusResponse, response_model_exclude_unset=True)
    def asset_status():
        return assets.status(library().read_db())

    @application.post("/api/assets/refresh", response_model=AssetRefreshResponse, response_model_exclude_unset=True)
    def refresh_assets(payload: StrictModel):
        return assets.refresh(library().read_db())

    @application.get("/api/entries/{replay_id}/map-image")
    @application.head("/api/entries/{replay_id}/map-image", include_in_schema=False)
    def map_image(replay_id: ReplayId):
        return Response(assets.read(library().get(replay_id)), media_type="image/jpeg")

    @application.get("/api/assets/units/{name}")
    @application.head("/api/assets/units/{name}", include_in_schema=False)
    def unit_icon(name: UnitName):
        raw = assets.read_icon(name)
        return Response(raw, media_type=services.icon_type(raw))

    return application
