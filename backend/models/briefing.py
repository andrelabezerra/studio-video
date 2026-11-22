"""Contrato Pydantic para projects/<slug>/briefing.json."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from backend.models.preset import AudioMode, FormatType, HumanSealMode


class RecommendedFormat(BaseModel):
    model_config = ConfigDict(extra="forbid")

    format_type: FormatType
    confidence: float = Field(ge=0.0, le=1.0)
    rationale: str = Field(min_length=1)


class Briefing(BaseModel):
    model_config = ConfigDict(extra="forbid")

    raw_idea: str = Field(min_length=1)
    seed_reference: str | None = None
    bible_translation: str = Field(default="NVI", min_length=1)
    target_duration_sec: int = Field(default=42, ge=10, le=180)
    audio_mode: AudioMode = AudioMode.RECORDED
    human_seal_mode: HumanSealMode = HumanSealMode.PAPER_CUTOUT
    recommended_format: RecommendedFormat | None = None
    selected_format_type: FormatType
    optional_reference_layout: str | None = None
