"""CLI determinística da Fase 1 (align e render) para o Studio Video Pipeline."""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Sequence

from backend.core.cache import get_project_cache
from backend.core.config import get_settings, load_preset
from backend.core.storage import ProjectStorage
from backend.services.alignment_service import align_audio_to_script, resolve_scene_timings
from backend.services.audio_mixer_service import ensure_pilot_audio
from backend.services.compositor_service import render_project
from backend.services.qa_service import validate_project_timing


def _cmd_align(args: argparse.Namespace) -> int:
    settings = get_settings()
    storage = ProjectStorage(settings.workspace_root / "projects")
    cache = get_project_cache(args.project, cache_root=settings.studio_cache_dir, ensure=True)

    manifest = storage.load_manifest(args.project)
    briefing = storage.load_briefing(args.project)
    script = storage.load_script(args.project)
    storyboard = storage.load_storyboard(args.project)
    preset = load_preset(
        manifest.preset_id,
        presets_dir=settings.workspace_root / "config" / "style_presets",
    )

    if not script.all_scripture_verified():
        raise ValueError(
            "Checkpoint de Rigor Bíblico reprovado: verifique todas as referências em scripture_refs[]."
        )

    input_audio = Path(args.input_audio).resolve() if args.input_audio else None
    narration_wav, audio_mode = ensure_pilot_audio(
        script=script,
        cache_dir=cache.root,
        input_audio_path=input_audio,
        target_duration_sec=float(briefing.target_duration_sec),
    )

    alignment = align_audio_to_script(
        narration_wav,
        script,
        audio_source=audio_mode,
        audio_cache_relpath="audio/narration_master.wav",
        engine=args.engine,
    )
    storage.save_audio_alignment(args.project, alignment)

    scenes = storage.load_all_scenes(args.project, storyboard=storyboard)
    resolved_scenes = resolve_scene_timings(scenes, alignment)
    for scene in resolved_scenes:
        storage.save_scene(args.project, scene)

    report = validate_project_timing(resolved_scenes, alignment, preset)
    updated_manifest = manifest.model_copy(
        update={
            "updated_at": datetime.now(timezone.utc).astimezone(),
            "gates": manifest.gates.model_copy(update={"audio_aligned": True}),
        }
    )
    storage.save_manifest(args.project, updated_manifest)

    summary = {
        "project": args.project,
        "audio_wav": str(narration_wav),
        "alignment_engine": alignment.alignment_engine,
        "duration_ms": alignment.duration_ms,
        "words_count": len(alignment.words),
        "scenes_count": len(resolved_scenes),
        "timing_ok": report.ok,
        "timing_errors": report.errors,
        "timing_warnings": report.warnings,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if report.ok else 1


def _cmd_render(args: argparse.Namespace) -> int:
    input_audio = Path(args.input_audio).resolve() if args.input_audio else None
    result = render_project(
        slug=args.project,
        profile=args.profile,
        input_audio_path=input_audio,
        force=bool(args.force),
    )
    summary = {
        "project": result.slug,
        "profile": result.profile,
        "final_mp4": str(result.final_mp4),
        "contact_sheet_jpg": str(result.contact_sheet_jpg),
        "mixed_audio_wav": str(result.mixed_audio_wav),
        "cache_hits": len(result.cache_hits),
        "cache_misses": len(result.cache_misses),
        "ffprobe": result.ffprobe_metrics,
        "timing_warnings": result.timing_report.warnings if result.timing_report else [],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m backend.cli",
        description="Studio Video Pipeline — CLI determinística (align & render)",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_align = sub.add_parser("align", help="Gera/normaliza áudio no cache e resolve timings por word_id.")
    p_align.add_argument("--project", required=True, help="Slug do projeto em projects/<slug>/.")
    p_align.add_argument("--input-audio", default=None, help="Caminho opcional de gravação WAV/MP3 real.")
    p_align.add_argument("--engine", default="auto", help="Engine de alinhamento (auto|deterministic|whisperx).")
    p_align.set_defaults(func=_cmd_align)

    p_render = sub.add_parser("render", help="Renderiza vídeo 9:16 + áudio mixado + contact_sheet no cache.")
    p_render.add_argument("--project", required=True, help="Slug do projeto em projects/<slug>/.")
    p_render.add_argument(
        "--profile",
        choices=("preview", "final"),
        default="final",
        help="Perfil de saída: preview (540x960@15fps) ou final (1080x1920@30fps).",
    )
    p_render.add_argument("--input-audio", default=None, help="Caminho opcional de gravação WAV/MP3 real.")
    p_render.add_argument("--force", action="store_true", help="Ignora cache SHA-256 e re-renderiza cenas.")
    p_render.set_defaults(func=_cmd_render)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
