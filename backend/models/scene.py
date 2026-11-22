"""Contrato Pydantic para projects/<slug>/scenes/scene_XX.json."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.models.preset import ImageProvider, SceneStatus, SceneTemplate, TransitionIn


class SceneTiming(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start_word_id: str = Field(min_length=1)
    end_word_id: str = Field(min_length=1)
    resolved_start_ms: int | None = Field(default=None, ge=0)
    resolved_end_ms: int | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def _validate_resolved_bounds(self) -> SceneTiming:
        has_start = self.resolved_start_ms is not None
        has_end = self.resolved_end_ms is not None
        if has_start != has_end:
            raise ValueError(
                "resolved_start_ms e resolved_end_ms devem ser ambos preenchidos ou ambos nulos."
            )
        if (
            self.resolved_start_ms is not None
            and self.resolved_end_ms is not None
            and self.resolved_start_ms > self.resolved_end_ms
        ):
            raise ValueError(
                f"SceneTiming inválido: resolved_start_ms ({self.resolved_start_ms}) > "
                f"resolved_end_ms ({self.resolved_end_ms})."
            )
        return self

    @property
    def duration_ms(self) -> int | None:
        if self.resolved_start_ms is None or self.resolved_end_ms is None:
            return None
        return self.resolved_end_ms - self.resolved_start_ms


class SceneVisual(BaseModel):
    model_config = ConfigDict(extra="forbid")

    background_theme: str = Field(default="pergaminho", min_length=1)
    headline: str = ""
    subtext: str = ""
    highlight_word_ids: list[str] = Field(default_factory=list)
    transition_in: TransitionIn = TransitionIn.CUT
    camera_motion: str = "subtle_zoom_in"
    reference_layout_asset: str | None = None
    scripture_ref_id: str | None = None
    original_term: str | None = None
    stamp_text: str | None = None
    series_label: str | None = None


class SceneAsset(BaseModel):
    model_config = ConfigDict(extra="forbid")

    asset_id: str = Field(min_length=1)
    provider: ImageProvider = ImageProvider.GEMINI_HYBRID
    prompt: str = ""
    apply_rembg: bool = False
    cache_relpath: str | None = None
    sha256: str | None = None


class SfxCue(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sfx_id: str = Field(min_length=1)
    anchor_word_id: str = Field(min_length=1)
    offset_ms: int = 0
    gain_db: float = Field(default=-6.0, ge=-60.0, le=12.0)


class ReviewPin(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pin_id: str = Field(min_length=1)
    x_pct: float = Field(ge=0.0, le=100.0)
    y_pct: float = Field(ge=0.0, le=100.0)
    time_ms: int = Field(ge=0)
    note: str = Field(min_length=1)
    resolved: bool = False


class Scene(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scene_id: str = Field(min_length=1, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    order: int = Field(ge=1)
    status: SceneStatus = SceneStatus.DRAFT
    tier: Literal[1, 2] = 1
    template: SceneTemplate
    template_version: str = Field(default="1.0.0", min_length=1)
    timing: SceneTiming
    visual: SceneVisual
    assets: list[SceneAsset] = Field(default_factory=list)
    sfx_cues: list[SfxCue] = Field(default_factory=list)
    review_pins: list[ReviewPin] = Field(default_factory=list)
    cache_hash: str | None = None
    cost_usd: float = Field(default=0.0, ge=0.0)

    @model_validator(mode="after")
    def _validate_tier_template(self) -> Scene:
        if self.tier == 1 and self.template == SceneTemplate.TIER2_VIDEO:
            raise ValueError(
                f"Cena '{self.scene_id}' usa template 'tier2_video' mas está com tier=1."
            )
        asset_ids = [a.asset_id for a in self.assets]
        if len(asset_ids) != len(set(asset_ids)):
            raise ValueError(f"asset_id duplicado na cena '{self.scene_id}'.")
        pin_ids = [p.pin_id for p in self.review_pins]
        if len(pin_ids) != len(set(pin_ids)):
            raise ValueError(f"pin_id duplicado na cena '{self.scene_id}'.")
        return self
