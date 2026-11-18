"""Transactional replay operations; writes update only the fields they own."""

from typing import Any, Callable

from sqlalchemy import Engine, delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Replay
from app.schemas import CreateEntryRequest, NotesRequest, RecordingRequest
from app.services import ApiError, REPLAY_ID_RE


def replay_key(replay_id: str) -> str:
    if not REPLAY_ID_RE.fullmatch(replay_id):
        raise ApiError(404, "Replay not found in the library.")
    return replay_id.lower()


def replay_url(replay_id: str) -> str:
    return f"https://bar-rts.com/replays/{replay_id}"


def entry_dict(row: Replay) -> dict[str, Any]:
    entry = {"bar_api": row.bar_api,
             "remarks": row.remarks, "build_order": row.build_order}
    if row.recorded_build_order is not None:
        entry["recorded_build_order"] = row.recorded_build_order
    return entry


class ReplayLibrary:
    def __init__(self, engine: Engine, fetch_snapshot: Callable[[str], dict[str, Any]]):
        self.engine = engine
        self.fetch_snapshot = fetch_snapshot

    def read_db(self) -> dict[str, Any]:
        with Session(self.engine) as session:
            return {replay_url(row.replay_id): entry_dict(row)
                    for row in session.scalars(select(Replay).order_by(Replay.replay_id))}

    def count(self) -> int:
        with Session(self.engine) as session:
            return session.scalar(select(func.count()).select_from(Replay))

    def get(self, replay_id: str) -> dict[str, Any]:
        with Session(self.engine) as session:
            row = session.get(Replay, replay_key(replay_id))
            if row is None:
                raise ApiError(404, "Replay not found in the library.")
            return entry_dict(row)

    def create(self, payload: CreateEntryRequest) -> dict[str, Any]:
        replay_id = payload.replay_url.rsplit("/", 1)[-1]
        with Session(self.engine) as session:
            if session.get(Replay, replay_id) is not None:
                raise ApiError(409, "This replay is already in your library.")
        # No database transaction is held open during network I/O.
        snapshot = self.fetch_snapshot(replay_id)
        entry = {"bar_api": snapshot, "remarks": payload.remarks, "build_order": payload.build_order}
        try:
            with Session(self.engine) as session, session.begin():
                session.add(Replay(replay_id=replay_id, **entry))
        except IntegrityError as error:
            raise ApiError(409, "This replay is already in your library.") from error
        return {"replay_url": payload.replay_url, "entry": entry}

    def update(self, replay_id: str, payload: NotesRequest) -> dict[str, Any]:
        replay_id = replay_key(replay_id)
        with Session(self.engine) as session, session.begin():
            result = session.execute(update(Replay).where(Replay.replay_id == replay_id).values(**payload.model_dump()))
            if not result.rowcount:
                raise ApiError(404, "Replay not found in the library.")
            entry = entry_dict(session.get(Replay, replay_id))
        return {"replay_url": replay_url(replay_id), "entry": entry}

    def delete(self, replay_id: str) -> dict[str, str]:
        replay_id = replay_key(replay_id)
        with Session(self.engine) as session, session.begin():
            result = session.execute(delete(Replay).where(Replay.replay_id == replay_id))
            if not result.rowcount:
                raise ApiError(404, "Replay not found in the library.")
        return {"deleted": replay_url(replay_id)}

    def set_recording(self, replay_id: str, payload: RecordingRequest | None = None) -> dict[str, Any]:
        replay_id = replay_key(replay_id)
        recording = payload.model_dump(exclude_unset=True) if payload is not None else None
        with Session(self.engine) as session, session.begin():
            result = session.execute(update(Replay).where(Replay.replay_id == replay_id)
                                     .values(recorded_build_order=recording))
            if not result.rowcount:
                raise ApiError(404, "Replay not found in the library.")
        return {"replay_url": replay_url(replay_id), "recording": recording}
