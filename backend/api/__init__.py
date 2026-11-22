"""Helpers compartilhados das rotas FastAPI (injeção de estado, detecção stale e serialização de projeto)."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from fastapi import HTTPException, Request
from pydantic import ValidationError

from backend.core.cache import ProjectCachePaths, get_project_cache, sha256_file, sha256_json
from backend.core.config import StudioSettings, load_preset
from backend.core.storage import ProjectStorage
from backend.models.audio import AudioAlignment
from backend.models.preset import StylePreset
from backend.models.project import ProjectManifest
from backend.models.scene import Scene
from backend.models.script import Script
from backend.services.alignment_service import tokenize_display_text
from backend.services.compositor_service import compute_expected_scene_hash
from backend.services.qa_service import ensure_scene_thumbnail
from backend.services.sse_hub import SSEHub

logger = logging.getLogger(__name__)


def get_app_settings(request: Request) -> StudioSettings:
    return request.app.state.settings


def get_app_storage(request: Request) -> ProjectStorage:
    return request.app.state.storage


def get_app_sse_hub(request: Request) -> SSEHub:
    return request.app.state.sse_hub


def get_presets_dir(settings: StudioSettings) -> Path:
    return settings.workspace_root / "config" / "style_presets"


def ensure_project_exists(storage: ProjectStorage, slug: str) -> None:
    try:
        exists = storage.exists(slug, "manifest.json")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not exists:
        raise HTTPException(status_code=404, detail=f"Projeto não encontrado: '{slug}'.")


def build_artifacts_summary(slug: str, cache: ProjectCachePaths) -> dict[str, Any]:
    """Monta mapa de artefatos binários existentes no STUDIO_CACHE_DIR (nunca no OneDrive)."""
    final_mp4 = cache.final_video_path(profile="final")
    preview_mp4 = cache.final_video_path(profile="preview")
    contact_final = cache.contact_sheet_path(profile="final")
    contact_preview = cache.contact_sheet_path(profile="preview")
    audio_wav = cache.audio / "narration_master.wav"
    cover_png = cache.qa / "cover.png"

    has_final = final_mp4.is_file() and final_mp4.stat().st_size > 0
    has_preview = preview_mp4.is_file() and preview_mp4.stat().st_size > 0

    contact_rel: str | None = None
    if contact_final.is_file() and contact_final.stat().st_size > 0:
        contact_rel = f"qa/{contact_final.name}"
    elif contact_preview.is_file() and contact_preview.stat().st_size > 0:
        contact_rel = f"qa/{contact_preview.name}"

    has_audio = audio_wav.is_file() and audio_wav.stat().st_size > 0
    has_cover = cover_png.is_file() and cover_png.stat().st_size > 0

    media_prefix = f"/api/projects/{slug}/media"
    return {
        "has_final_mp4": has_final,
        "final_mp4_url": f"{media_prefix}/renders/{final_mp4.name}" if has_final else None,
        "has_preview_mp4": has_preview,
        "preview_mp4_url": f"{media_prefix}/renders/{preview_mp4.name}" if has_preview else None,
        "has_contact_sheet": contact_rel is not None,
        "contact_sheet_url": f"{media_prefix}/{contact_rel}" if contact_rel else None,
        "has_audio": has_audio,
        "audio_url": f"{media_prefix}/audio/narration_master.wav" if has_audio else None,
        "has_cover": has_cover,
        "cover_url": f"{media_prefix}/qa/cover.png" if has_cover else None,
    }


def load_storyboard_raw(storage: ProjectStorage, slug: str) -> dict[str, Any] | None:
    """Lê storyboard.json aceitando tanto contratos completos quanto rascunhos clonados com scene_ids=[]."""
    path = storage.project_dir(slug) / "storyboard.json"
    if not path.is_file():
        return None
    try:
        return storage.load_storyboard(slug).model_dump(mode="json")
    except ValidationError:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(raw, dict) and raw.get("scene_ids") == []:
            return raw
        raise


def _is_audio_stale(
    manifest: ProjectManifest,
    script: Script | None,
    audio_alignment: AudioAlignment | None,
    cache: ProjectCachePaths,
) -> bool:
    """Determina em runtime se o alinhamento de áudio está ausente ou desatualizado frente ao script."""
    if script is None:
        return False
    if audio_alignment is None or not manifest.gates.audio_aligned:
        return True

    try:
        audio_master = cache.resolve_relpath(audio_alignment.audio_cache_relpath)
    except ValueError:
        return True
    if not (audio_master.is_file() and audio_master.stat().st_size > 0):
        return True
    if sha256_file(audio_master) != audio_alignment.audio_sha256:
        return True

    expected_pairs = [
        (seg.segment_id, tok)
        for seg in script.narration_segments
        for tok in tokenize_display_text(seg.display_text)
    ]
    actual_pairs = [(w.segment_id, w.text) for w in audio_alignment.words]
    return expected_pairs != actual_pairs


def compute_pipeline_runtime(
    *,
    slug: str,
    manifest: ProjectManifest,
    script: Script | None,
    audio_alignment: AudioAlignment | None,
    scenes: list[Scene],
    preset: StylePreset,
    cache: ProjectCachePaths,
    templates_dir: Path,
    ensure_thumbs: bool = True,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Calcula pipeline_status e scene_runtime em memória (Seção 8 de docs/CONTRATOS_JSON.md)."""
    audio_stale = _is_audio_stale(manifest, script, audio_alignment, cache)

    final_mp4 = cache.final_video_path(profile="final")
    preview_mp4 = cache.final_video_path(profile="preview")
    has_final_mp4 = final_mp4.is_file() and final_mp4.stat().st_size > 0
    has_preview_mp4 = preview_mp4.is_file() and preview_mp4.stat().st_size > 0
    render_mtimes = [
        p.stat().st_mtime
        for p, exists in ((final_mp4, has_final_mp4), (preview_mp4, has_preview_mp4))
        if exists
    ]

    preset_hash = sha256_json(preset)
    template_fingerprints: dict[str, str] = {}
    scene_runtime: dict[str, Any] = {}
    stale_scene_ids: list[str] = []
    active_clip_mtimes: list[float] = []
    media_prefix = f"/api/projects/{slug}/media"

    for scene in scenes:
        expected_final: str | None = None
        expected_preview: str | None = None
        if script is not None and audio_alignment is not None:
            try:
                expected_final = compute_expected_scene_hash(
                    scene=scene,
                    alignment=audio_alignment,
                    script=script,
                    preset=preset,
                    cache=cache,
                    profile="final",
                    templates_dir=templates_dir,
                    preset_hash=preset_hash,
                    template_fingerprints=template_fingerprints,
                )
                expected_preview = compute_expected_scene_hash(
                    scene=scene,
                    alignment=audio_alignment,
                    script=script,
                    preset=preset,
                    cache=cache,
                    profile="preview",
                    templates_dir=templates_dir,
                    preset_hash=preset_hash,
                    template_fingerprints=template_fingerprints,
                )
            except (KeyError, ValueError):
                expected_final = None
                expected_preview = None

        clip_final = (
            cache.scene_video_path(scene.scene_id, profile="final", cache_hash=expected_final)
            if expected_final is not None
            else None
        )
        has_final_clip = (
            clip_final is not None and clip_final.is_file() and clip_final.stat().st_size > 0
        )
        clip_preview = (
            cache.scene_video_path(scene.scene_id, profile="preview", cache_hash=expected_preview)
            if expected_preview is not None
            else None
        )
        has_preview_clip = (
            clip_preview is not None and clip_preview.is_file() and clip_preview.stat().st_size > 0
        )

        expected_hash: str | None
        clip_path: Path | None
        if expected_final is not None and scene.cache_hash == expected_final:
            expected_hash = expected_final
            clip_path = clip_final if has_final_clip else None
        elif expected_preview is not None and scene.cache_hash == expected_preview:
            expected_hash = expected_preview
            clip_path = clip_preview if has_preview_clip else None
        elif has_final_clip:
            expected_hash = expected_final
            clip_path = clip_final
        elif has_preview_clip:
            expected_hash = expected_preview
            clip_path = clip_preview
        else:
            expected_hash = expected_final if has_final_mp4 else expected_preview
            clip_path = None

        has_clip = clip_path is not None
        is_stale = (
            audio_stale
            or expected_hash is None
            or scene.cache_hash != expected_hash
            or not has_clip
        )

        thumbnail_url: str | None = None
        if has_clip and clip_path is not None and expected_hash is not None:
            active_clip_mtimes.append(clip_path.stat().st_mtime)
            thumb_path = cache.scene_thumb_path(scene.scene_id, expected_hash)
            if ensure_thumbs and not (thumb_path.is_file() and thumb_path.stat().st_size > 0):
                try:
                    ensure_scene_thumbnail(clip_path, thumb_path)
                except (RuntimeError, OSError, ValueError) as exc:
                    logger.warning(
                        "Não foi possível gerar miniatura on-demand para %s/%s: %s",
                        slug,
                        scene.scene_id,
                        exc,
                    )
            if thumb_path.is_file() and thumb_path.stat().st_size > 0:
                thumbnail_url = f"{media_prefix}/thumbs/{thumb_path.name}"

        if is_stale:
            stale_scene_ids.append(scene.scene_id)

        scene_runtime[scene.scene_id] = {
            "is_stale": is_stale,
            "expected_hash": expected_hash,
            "has_clip": has_clip,
            "thumbnail_url": thumbnail_url,
        }

    if not scenes:
        render_stale = False
    elif audio_stale or len(stale_scene_ids) > 0 or not render_mtimes:
        render_stale = True
    else:
        latest_render_mtime = max(render_mtimes)
        render_stale = any(clip_mtime > latest_render_mtime for clip_mtime in active_clip_mtimes)

    pending_count = (
        (1 if audio_stale else 0)
        + len(stale_scene_ids)
        + (1 if (render_stale and len(scenes) > 0) else 0)
    )
    pipeline_status = {
        "audio_stale": audio_stale,
        "stale_scene_ids": stale_scene_ids,
        "render_stale": render_stale,
        "pending_count": pending_count,
    }
    return pipeline_status, scene_runtime


def build_project_detail(
    slug: str,
    settings: StudioSettings,
    storage: ProjectStorage,
) -> dict[str, Any]:
    """Carrega o estado completo de um projeto conforme o contrato GET /api/projects/{slug}."""
    ensure_project_exists(storage, slug)

    manifest = storage.load_manifest(slug)
    briefing = storage.load_briefing(slug) if storage.exists(slug, "briefing.json") else None
    script = storage.load_script(slug) if storage.exists(slug, "script.json") else None
    audio_alignment = (
        storage.load_audio_alignment(slug)
        if storage.exists(slug, "audio_alignment.json")
        else None
    )
    storyboard_raw = load_storyboard_raw(storage, slug)

    scenes: list[Scene] = []
    if storyboard_raw is not None:
        if storyboard_raw.get("scene_ids"):
            storyboard_model = storage.load_storyboard(slug)
            scenes = storage.load_all_scenes(slug, storyboard=storyboard_model)
    elif storage.scenes_dir(slug).is_dir():
        scenes = storage.load_all_scenes(slug)

    preset = load_preset(manifest.preset_id, presets_dir=get_presets_dir(settings))
    cache = get_project_cache(slug, cache_root=settings.studio_cache_dir, ensure=False)
    pipeline_status, scene_runtime = compute_pipeline_runtime(
        slug=slug,
        manifest=manifest,
        script=script,
        audio_alignment=audio_alignment,
        scenes=scenes,
        preset=preset,
        cache=cache,
        templates_dir=settings.workspace_root / "templates_video",
        ensure_thumbs=True,
    )

    return {
        "manifest": manifest.model_dump(mode="json"),
        "briefing": briefing.model_dump(mode="json") if briefing is not None else None,
        "script": script.model_dump(mode="json") if script is not None else None,
        "audio_alignment": (
            audio_alignment.model_dump(mode="json") if audio_alignment is not None else None
        ),
        "storyboard": storyboard_raw,
        "scenes": [s.model_dump(mode="json") for s in scenes],
        "preset": preset.model_dump(mode="json"),
        "artifacts": build_artifacts_summary(slug, cache),
        "pipeline_status": pipeline_status,
        "scene_runtime": scene_runtime,
    }
