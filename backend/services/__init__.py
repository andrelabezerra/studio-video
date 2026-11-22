"""Serviços determinísticos da Fase 2 (alinhamento, áudio, compositor e QA)."""

from backend.services.alignment_service import (
    align_audio_to_script,
    normalize_biblical_text,
    resolve_scene_timings,
    tokenize_display_text,
)
from backend.services.audio_mixer_service import (
    ResolvedSfxCue,
    ensure_default_sfx_and_track,
    ensure_pilot_audio,
    mix_audio_single_pass,
)
from backend.services.compositor_service import (
    RenderResult,
    render_project,
    render_scene_clip,
)
from backend.services.qa_service import (
    TimingValidationReport,
    generate_contact_sheet,
    inspect_video_ffprobe,
    validate_project_timing,
)

__all__ = [
    "RenderResult",
    "ResolvedSfxCue",
    "TimingValidationReport",
    "align_audio_to_script",
    "ensure_default_sfx_and_track",
    "ensure_pilot_audio",
    "generate_contact_sheet",
    "inspect_video_ffprobe",
    "mix_audio_single_pass",
    "normalize_biblical_text",
    "render_project",
    "render_scene_clip",
    "resolve_scene_timings",
    "tokenize_display_text",
    "validate_project_timing",
]
