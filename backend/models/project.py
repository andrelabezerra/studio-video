"""Contrato Pydantic para projects/<slug>/manifest.json."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from backend.models.preset import FormatType


class SeriesMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid")

    series_id: str = Field(min_length=1)
    format_type: FormatType
    episode_number: int = Field(ge=1)
    batch_id: str | None = None


class ProjectGates(BaseModel):
    model_config = ConfigDict(extra="forbid")

    briefing_approved: bool = False
    scripture_verified: bool = False
    script_gate_1_approved: bool = False
    audio_aligned: bool = False
    scenes_approved: bool = False
    qa_passed: bool = False


class CostLedgerItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_id: str = Field(min_length=1)
    stage: str = Field(min_length=1)
    provider: str = Field(min_length=1)
    scene_id: str | None = None
    cost_usd: float = Field(ge=0.0)
    created_at: datetime | None = None
    note: str | None = None


class CostLedger(BaseModel):
    model_config = ConfigDict(extra="forbid")

    currency: str = "USD"
    estimated_total: float = Field(default=0.0, ge=0.0)
    spent_total: float = Field(default=0.0, ge=0.0)
    cap_usd: float = Field(default=2.5, ge=0.0)
    items: list[CostLedgerItem] = Field(default_factory=list)


class Metrics48h(BaseModel):
    model_config = ConfigDict(extra="forbid")

    published_at: datetime | None = None
    viewed_vs_swiped_pct: float | None = Field(default=None, ge=0.0, le=100.0)
    avg_retention_pct: float | None = Field(default=None, ge=0.0, le=500.0)
    comments_count: int | None = Field(default=None, ge=0)


class ProjectManifest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: str = "1.0.0"
    slug: str = Field(min_length=1, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    title: str = Field(min_length=1)
    created_at: datetime
    updated_at: datetime
    preset_id: str = Field(default="pastor-andre-biblico", min_length=1)
    series: SeriesMetadata
    gates: ProjectGates = Field(default_factory=ProjectGates)
    cost_ledger: CostLedger = Field(default_factory=CostLedger)
    metrics_48h: Metrics48h = Field(default_factory=Metrics48h)
