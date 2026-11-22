"""Contrato Pydantic para projects/<slug>/scenes/scene_XX.json."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from backend.models.preset import ImageProvider, SceneStatus, SceneTemplate, TransitionIn
from backend.models.validation import assert_no_placeholders, is_forbidden_bureaucratic_stamp


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


class SceneBeat(BaseModel):
    """Sub-evento visual ancorado em word_id (ou progress 0..1) dentro de uma cena fluida multi-beat."""

    model_config = ConfigDict(extra="forbid")

    beat_id: str = Field(min_length=1)
    anchor_word_id: str | None = None
    progress: float | None = Field(default=None, ge=0.0, le=1.0)
    headline: str | None = None
    subtext: str | None = None
    emphasis: Literal["gold", "terracotta", "navy", "light"] = "gold"
    visual_action: str | None = None
    camera_shift: Literal[
        "none",
        "push_in",
        "pull_out",
        "pan_left",
        "pan_right",
        "tilt_drama",
        "settle",
    ] = "none"

    @model_validator(mode="after")
    def _validate_beat(self) -> SceneBeat:
        if self.anchor_word_id is not None and not self.anchor_word_id.strip():
            raise ValueError(f"Beat '{self.beat_id}': anchor_word_id não pode ser vazio.")
        if self.anchor_word_id is None and self.progress is None:
            raise ValueError(
                f"Beat '{self.beat_id}': informe anchor_word_id ou progress (0.0 a 1.0)."
            )
        if self.headline is not None:
            assert_no_placeholders(self.headline, field_path=f"beats[{self.beat_id}].headline")
        if self.subtext is not None:
            assert_no_placeholders(self.subtext, field_path=f"beats[{self.beat_id}].subtext")
        return self


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
    # Controles amplos de imagem e animação por cena (100% opcionais e retrocompatíveis)
    image_layout: Literal[
        "auto",
        "card",
        "background",
        "background_blur",
        "cutout_overlay",
        "none",
    ] = "auto"
    image_fit: Literal["cover", "contain"] = "cover"
    image_scale: float = Field(default=1.0, ge=0.4, le=2.5)
    image_offset_x: float = Field(default=0.0, ge=-60.0, le=60.0)
    image_offset_y: float = Field(default=0.0, ge=-60.0, le=60.0)
    image_opacity: float = Field(default=1.0, ge=0.1, le=1.0)
    image_animation: Literal[
        "ken_burns_in",
        "ken_burns_out",
        "pan_left",
        "pan_right",
        "float",
        "pulse",
        "tilt",
        "static",
    ] = "ken_burns_in"
    illustration_variant: Literal[
        "auto",
        "greek_papyrus",
        "compass_map",
        "editorial_loupe",
        "ancient_arch",
        "prison_bars",
    ] = "auto"
    element_animation: Literal[
        "vox_editorial",
        "pop_bounce",
        "slide_reveal",
        "type_fade",
        "dramatic_rise",
        "minimal",
    ] = "vox_editorial"
    animation_speed: float = Field(default=1.0, ge=0.4, le=2.5)
    motion_intensity: float = Field(default=1.0, ge=0.0, le=2.0)
    show_stamp: bool | None = None
    # Extensões cinematográficas v2 (multi-beat, atmosfera viva e composições SVG livres)
    composition: Literal[
        "auto",
        "debt_scale",
        "forgiveness_seal",
        "dramatic_split",
        "rhetorical_question",
        "grace_illumination",
        "narrative_arc",
        "counter_impact",
        "scripture_spotlight",
    ] = "auto"
    atmosphere: Literal[
        "auto",
        "warm_paper",
        "dramatic_spotlight",
        "grace_glow",
        "ink_vignette",
    ] = "auto"
    beats: list[SceneBeat] = Field(default_factory=list)
    motion_data: dict[str, Any] = Field(default_factory=dict)

    @field_validator("headline", "subtext", mode="before")
    @classmethod
    def _coerce_none_to_empty_str(cls, value: Any) -> Any:
        if value is None:
            return ""
        return value

    @model_validator(mode="after")
    def _validate_visual_integrity(self) -> SceneVisual:
        beat_ids = [b.beat_id for b in self.beats]
        if len(beat_ids) != len(set(beat_ids)):
            raise ValueError("beat_id duplicado encontrado em visual.beats[].")

        for field_name in ("headline", "subtext", "original_term", "stamp_text", "series_label"):
            val = getattr(self, field_name)
            if val:
                assert_no_placeholders(val, field_path=f"visual.{field_name}")

        if self.stamp_text and is_forbidden_bureaucratic_stamp(self.stamp_text):
            raise ValueError(
                f"Selo burocrático proibido em visual.stamp_text: '{self.stamp_text}'. "
                "Remova o selo 'TEXTO VERIFICADO' e use composição editorial limpa."
            )

        if self.motion_data:
            assert_no_placeholders(self.motion_data, field_path="visual.motion_data")
        return self


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
