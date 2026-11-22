"""Schemas Pydantic para o Style Preset editorial e enums canônicos."""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class FormatType(StrEnum):
    MAPA_CONTEXTO = "mapa_contexto"
    PERDIDO_TRADUCAO = "perdido_traducao"
    MITO_VS_TEXTO = "mito_vs_texto"
    CONEXAO_AT_NT = "conexao_at_nt"


class HookType(StrEnum):
    TRADUCAO = "traducao"
    PARADOXO = "paradoxo"
    MITO = "mito"
    MAPA = "mapa"


class AudioMode(StrEnum):
    RECORDED = "recorded"
    XTTS_V2 = "xtts_v2"
    F5_TTS = "f5_tts"
    VOICESTUDIO = "voicestudio"


class HumanSealMode(StrEnum):
    NONE = "none"
    PAPER_CUTOUT = "paper_cutout"
    REAL_CLIP_3S = "real_clip_3s"


class ImageProvider(StrEnum):
    GEMINI_HYBRID = "gemini_hybrid"
    GEMINI_API = "gemini_api"
    OPENROUTER = "openrouter"
    LOCAL = "local"


class SceneStatus(StrEnum):
    DRAFT = "draft"
    APPROVED = "approved"
    NEEDS_REVISION = "needs_revision"
    RENDERED = "rendered"
    DISCARDED = "discarded"


class SceneTemplate(StrEnum):
    PAPER_COLLAGE = "paper_collage"
    BIBLE_QUOTE_CARD = "bible_quote_card"
    KINETIC_CAPTIONS = "kinetic_captions"
    TIMELINE_MAP = "timeline_map"
    EDITORIAL_MOTION = "editorial_motion"
    TIER2_VIDEO = "tier2_video"


class TransitionIn(StrEnum):
    CUT = "cut"
    PAPER_TEAR = "paper_tear"
    WHIP_PAN = "whip_pan"
    STAMP_DROP = "stamp_drop"
    FADE_IN = "fade_in"
    SLIDE_UP = "slide_up"
    SLIDE_LEFT = "slide_left"
    ZOOM_PUNCH = "zoom_punch"
    IRIS_REVEAL = "iris_reveal"
    EDITORIAL_WIPE = "editorial_wipe"
    CROSS_MOTION = "cross_motion"
    ZOOM_THROUGH = "zoom_through"
    INK_WASH = "ink_wash"


class DurationRange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    min: float = Field(gt=0)
    ideal: float = Field(gt=0)
    max: float = Field(gt=0)

    @model_validator(mode="after")
    def _validate_bounds(self) -> DurationRange:
        if not (self.min <= self.ideal <= self.max):
            raise ValueError(
                f"target_duration_sec inválido: min ({self.min}) <= ideal ({self.ideal}) <= max ({self.max}) não satisfeito."
            )
        return self


class PacingRange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    min: float = Field(gt=0)
    max: float = Field(gt=0)

    @model_validator(mode="after")
    def _validate_bounds(self) -> PacingRange:
        if self.min > self.max:
            raise ValueError(
                f"scene_pacing_sec inválido: min ({self.min}) > max ({self.max})."
            )
        return self


class VideoPreset(BaseModel):
    model_config = ConfigDict(extra="forbid")

    aspect_ratio: str = Field(min_length=1)
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    fps: int = Field(gt=0, le=120)
    preview_width: int = Field(gt=0)
    preview_height: int = Field(gt=0)
    preview_fps: int = Field(gt=0, le=120)
    target_duration_sec: DurationRange
    scene_pacing_sec: PacingRange


class SafeZonesPx(BaseModel):
    model_config = ConfigDict(extra="forbid")

    top: int = Field(ge=0)
    bottom: int = Field(ge=0)
    right: int = Field(ge=0)
    left: int = Field(ge=0)

    def content_box(self, width: int, height: int) -> tuple[int, int, int, int]:
        """Retorna (x1, y1, x2, y2) da área útil segura."""
        x1 = self.left
        y1 = self.top
        x2 = width - self.right
        y2 = height - self.bottom
        if x1 >= x2 or y1 >= y2:
            raise ValueError(
                f"Safe-zones inválidas para {width}x{height}: box=({x1}, {y1}, {x2}, {y2})."
            )
        return (x1, y1, x2, y2)


class PalettePreset(BaseModel):
    model_config = ConfigDict(extra="forbid")

    parchment_bg: str = Field(min_length=1)
    charcoal_dark: str = Field(min_length=1)
    vox_gold: str = Field(min_length=1)
    historical_navy: str = Field(min_length=1)
    terracotta_accent: str = Field(min_length=1)
    muted_ink: str = Field(min_length=1)
    paper_shadow: str = Field(min_length=1)


class TypographyPreset(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_font: str = Field(min_length=1)
    body_font: str = Field(min_length=1)
    mono_font: str = Field(min_length=1)
    max_words_per_kinetic_block: int = Field(ge=1, le=20)
    caption_style: str = Field(min_length=1)


class DuckingPreset(BaseModel):
    model_config = ConfigDict(extra="forbid")

    threshold: float = Field(gt=0.0, le=1.0)
    ratio: float = Field(ge=1.0, le=20.0)
    attack_ms: int = Field(ge=1)
    release_ms: int = Field(ge=1)


class AudioMixPreset(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_lufs: float = Field(ge=-40.0, le=0.0)
    true_peak_dbtp: float = Field(ge=-10.0, le=0.0)
    music_base_gain_db: float = Field(ge=-60.0, le=12.0)
    ducking: DuckingPreset
    default_sfx_gain_db: float = Field(ge=-60.0, le=12.0)


class FormatSeriesSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    format_type: FormatType
    label: str = Field(min_length=1)
    description: str = Field(min_length=1)
    default_templates: list[SceneTemplate] = Field(min_length=1)
    hook_types: list[HookType] = Field(min_length=1)


class CostGuardrails(BaseModel):
    model_config = ConfigDict(extra="forbid")

    default_tier: Literal[1, 2] = 1
    default_image_provider: ImageProvider = ImageProvider.GEMINI_HYBRID
    tier2_video_enabled_by_default: bool = False
    fal_3d_enabled_by_default: bool = False
    max_cost_per_scene_usd: float = Field(ge=0.0)
    max_cost_per_video_usd: float = Field(ge=0.0)

    @model_validator(mode="after")
    def _validate_caps(self) -> CostGuardrails:
        if self.max_cost_per_scene_usd > self.max_cost_per_video_usd:
            raise ValueError(
                "max_cost_per_scene_usd não pode exceder max_cost_per_video_usd."
            )
        return self


class StylePreset(BaseModel):
    model_config = ConfigDict(extra="forbid")

    preset_id: str = Field(min_length=1, pattern=r"^[a-z0-9][a-z0-9_-]*$")
    name: str = Field(min_length=1)
    channel_url: str = Field(min_length=1)
    channel_handle: str = Field(min_length=1)
    default_bible_translation: str = Field(min_length=1)
    video: VideoPreset
    safe_zones_px: SafeZonesPx
    palette: PalettePreset
    typography: TypographyPreset
    audio_mix: AudioMixPreset
    formats_series: list[FormatSeriesSpec] = Field(min_length=1)
    cost_guardrails: CostGuardrails

    def get_format_spec(self, format_type: FormatType) -> FormatSeriesSpec:
        for spec in self.formats_series:
            if spec.format_type == format_type:
                return spec
        raise KeyError(f"Formato-série não encontrado no preset: {format_type}")
