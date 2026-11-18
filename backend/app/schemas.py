"""Explicit request, response, and persisted entry schemas."""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.services import MAX_TEXT_LENGTH, canonical_replay_url, validate_recording
from app.statistics import RecordingStatistics

Note = Annotated[str, Field(max_length=MAX_TEXT_LENGTH)]
Count = Annotated[int, Field(ge=0, le=2**53 - 1)]
UnitDefId = Annotated[str, Field(pattern=r"^[1-9][0-9]{0,9}$")]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class NotesRequest(StrictModel):
    remarks: Note = ""
    build_order: Note = ""


class CreateEntryRequest(NotesRequest):
    replay_url: str

    @field_validator("replay_url")
    @classmethod
    def canonical_url(cls, value: str) -> str:
        return canonical_replay_url(value)


class SummaryCounts(StrictModel):
    started: Count
    buildings: Count
    units: Count
    completed: Count
    removed_before_completion: Count
    unfinished: Count


class CaptureSummary(StrictModel):
    format: Literal["realbo_summary"]
    schema_version: Literal[1]
    replay_file: str
    map: str
    game_version: str
    export_time: str
    game_over: bool
    full_replay_captured: bool
    skipped_frames: bool
    rewind_detected: bool
    started_frame: Count
    export_frame: Count
    counts: SummaryCounts


class UnitDefinition(StrictModel):
    display_name: Annotated[str, Field(min_length=1)]
    internal_name: str
    is_building: bool
    is_factory: bool
    metal_cost: Annotated[float, Field(ge=0, allow_inf_nan=False)] | None = None
    energy_cost: Annotated[float, Field(ge=0, allow_inf_nan=False)] | None = None
    category: Literal["army", "air", "sea", "defense", "strategic", "factories", "builders", "economy", "utility"] | None = None


class UnitDefinitions(StrictModel):
    game: str
    game_version: str
    map: str
    replay_file: str
    units: Annotated[dict[UnitDefId, UnitDefinition], Field(min_length=1)]


class RecordingRequest(StrictModel):
    csv: str
    filename: str = "recording.csv"
    unit_map: UnitDefinitions | None = None
    unit_map_filename: str = ""
    summary: CaptureSummary | None = None
    summary_filename: str = ""
    statistics: RecordingStatistics | None = None
    statistics_filename: str = ""

    @model_validator(mode="before")
    @classmethod
    def validate_archive(cls, value: Any) -> Any:
        # Current CSV format, byte limits, metadata and safe filenames.
        return validate_recording(value)


class StoredEntry(StrictModel):
    bar_api: dict[str, Any]
    remarks: str = ""
    build_order: str = ""
    recorded_build_order: RecordingRequest | None = None


class EntryResponse(StrictModel):
    replay_url: str
    entry: StoredEntry


class RecordingResponse(StrictModel):
    replay_url: str
    recording: RecordingRequest | None


class DeleteResponse(StrictModel):
    deleted: str


class StatusResponse(StrictModel):
    database_path: str
    storage: Literal["sqlite"] = "sqlite"
    count: int


class ErrorResponse(StrictModel):
    error: str


class AssetState(StrictModel):
    state: Literal["cached", "missing", "failed"]
    error: str | None = None


class AssetReferences(StrictModel):
    map: str | None
    units: list[str]


class AssetStatusResponse(StrictModel):
    maps: dict[str, AssetState]
    units: dict[str, AssetState]
    entries: dict[str, AssetReferences]


class MapFailure(StrictModel):
    map: str
    error: str


class UnitFailure(StrictModel):
    unit: str
    error: str


class AssetRefreshResponse(StrictModel):
    refreshed: list[str]
    failed: list[MapFailure]
    units_refreshed: list[str] = Field(default_factory=list)
    units_failed: list[UnitFailure] = Field(default_factory=list)
    status_warning: str | None = None
