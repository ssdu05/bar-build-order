"""Versioned, bounded replay-statistics archive (no executable content)."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

STATISTIC_KEYS = (
    "metalIncome", "metalExpense", "metalCurrent", "metalStorage",
    "energyIncome", "energyExpense", "energyCurrent", "energyStorage",
    "metalProduced", "metalUsed", "metalExcess", "metalSent", "metalReceived",
    "energyProduced", "energyUsed", "energyExcess", "energySent", "energyReceived",
    "metalReclaimed", "energyReclaimed", "metalReclaimIncome", "energyReclaimIncome",
    "damageDealt", "damageReceived", "unitsProduced", "unitsKilled", "unitsDied",
    "unitValue", "valueArmy", "valueAir", "valueSea", "valueDefense",
    "valueStrategic", "valueFactories", "valueBuilders", "valueEconomy", "valueUtility",
    "killedValue", "lostValue", "buildPower", "buildPowerActive", "buildPowerIdle",
    "convUse", "convCapacity", "idleCons", "cons", "idleLabs", "labs",
    "metalSpots", "geoSpots", "incomeMex", "incomeConverters",
    "incomeWind", "incomeSolar", "incomeTidal", "incomeGeo", "incomeFusion",
)
Count = Annotated[int, Field(ge=0, le=2**53 - 1)]
Finite = Annotated[float, Field(allow_inf_nan=False)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class StatisticsSample(StrictModel):
    frame: Count
    values: Annotated[list[Finite | None], Field(max_length=len(STATISTIC_KEYS))]


class StatisticsTeam(StrictModel):
    team_id: Count
    ally_team_id: Count | None
    player: Annotated[str, Field(min_length=1, max_length=1024)]
    samples: Annotated[list[StatisticsSample], Field(max_length=100_000)]


class RecordingStatistics(StrictModel):
    format: Literal["realbo_statistics"]
    schema_version: Literal[1]
    replay_file: Annotated[str, Field(max_length=1024)]
    map: Annotated[str, Field(max_length=1024)]
    game_version: Annotated[str, Field(max_length=1024)]
    game_speed: Annotated[Finite, Field(gt=0, le=1000)]
    sample_period_frames: Annotated[Count, Field(gt=0)]
    started_frame: Count
    export_frame: Count
    game_over: bool
    full_replay_captured: bool
    truncated: bool
    metrics: Annotated[list[str], Field(min_length=1, max_length=len(STATISTIC_KEYS))]
    teams: Annotated[list[StatisticsTeam], Field(max_length=256)]

    @model_validator(mode="after")
    def consistent_samples(self):
        if self.started_frame > self.export_frame:
            raise ValueError("Statistics frame range is invalid.")
        if len(set(self.metrics)) != len(self.metrics) or set(self.metrics) - set(STATISTIC_KEYS):
            raise ValueError("Unknown or duplicate statistics metrics.")
        if len({team.team_id for team in self.teams}) != len(self.teams):
            raise ValueError("Duplicate statistics teams.")
        count = 0
        for team in self.teams:
            previous = -1
            for sample in team.samples:
                count += 1
                if not self.started_frame <= sample.frame <= self.export_frame or sample.frame <= previous:
                    raise ValueError("Statistics samples must be ordered, unique, and within the capture.")
                if len(sample.values) != len(self.metrics):
                    raise ValueError("Statistics sample width does not match metrics.")
                previous = sample.frame
        if count > 100_000:
            raise ValueError("Too many statistics samples (max 100,000).")
        return self
