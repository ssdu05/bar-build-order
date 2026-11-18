"""SQLAlchemy models. Schema changes must be accompanied by an Alembic revision."""

from typing import Any

from sqlalchemy import JSON, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Replay(Base):
    __tablename__ = "replays"

    replay_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    bar_api: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    remarks: Mapped[str] = mapped_column(Text, nullable=False)
    build_order: Mapped[str] = mapped_column(Text, nullable=False)
    recorded_build_order: Mapped[dict[str, Any] | None] = mapped_column(JSON(none_as_null=True))
