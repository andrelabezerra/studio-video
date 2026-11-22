"""Rotas REST + SSE da Macro-Fase 2: Áudio, Cenas, Assets, Render, Capa e Media segura."""

from __future__ import annotations

import logging
import shutil
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Body, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, ValidationError

from backend.api import (
    build_project_detail,
    compute_pipeline_runtime,
    ensure_project_exists,
    get_app_settings,
    get_app_sse_hub,
    get_app_storage,
    get_presets_dir,
    load_storyboard_raw,
)
from backend.core.cache import get_project_cache
from backend.core.config import StudioSettings, load_preset
from backend.core.storage import ProjectStorage
from backend.models.preset import AudioMode, SceneStatus
from backend.models.scene import Scene
from backend.services.alignment_service import (
    _probe_audio_metadata,
    align_audio_to_script,
    resolve_scene_timings,
)
from backend.services.asset_service import generate_cover_png, process_uploaded_scene_asset
from backend.services.audio_mixer_service import _run_ffmpeg, ensure_pilot_audio
from backend.services.compositor_service import render_project, render_scene_clip
from backend.services.sse_hub import SSEHub

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/projects/{slug}", tags=["production"])

_ALLOWED_AUDIO_EXTENSIONS = frozenset({".wav", ".mp3", ".m4a", ".ogg", ".flac"})


class AlignAudioRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    audio_source: Literal["recorded", "pilot"] | None = None


class RegenerateSceneRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    profile: Literal["preview", "final"] = "preview"
    force: bool = True


class RenderProjectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    profile: Literal["preview", "final"] = "preview"
    force: bool = False


class RunPendingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    profile: Literal["preview", "final"] = "preview"


@router.post("/audio/upload")
async def upload_project_audio(
    slug: str,
    request: Request,
    file: UploadFile = File(...),
) -> dict[str, Any]:
    settings = get_app_settings(request)
    storage = get_app_storage(request)
    ensure_project_exists(storage, slug)

    filename = (file.filename or "audio.wav").strip()
    ext = Path(filename).suffix.lower()
    if ext not in _ALLOWED_AUDIO_EXTENSIONS:
        raise HTTPException(
            status_code=422,
            detail=f"Formato de áudio não suportado ('{ext}'). Use .wav, .mp3 ou .m4a.",
        )

    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=422, detail="Arquivo de áudio vazio.")

    cache = get_project_cache(slug, cache_root=settings.studio_cache_dir, ensure=True)
    uploaded_source = cache.audio / f"uploaded_source{ext}"
    uploaded_source.write_bytes(raw_bytes)
    narration_master = cache.audio / "narration_master.wav"

    try:
        _run_ffmpeg(
            [
                "-i",
                str(uploaded_source),
                "-ar",
                "48000",
                "-ac",
                "1",
                "-c:a",
                "pcm_s16le",
                str(narration_master),
            ],
            context=f"normalize_uploaded_audio_{slug}",
        )
        _, duration_ms = _probe_audio_metadata(narration_master)
    except (RuntimeError, ValueError) as exc:
        uploaded_source.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail=f"Falha ao processar áudio: {exc}") from exc

    if storage.exists(slug, "briefing.json"):
        briefing = storage.load_briefing(slug)
        storage.save_briefing(
            slug,
            briefing.model_copy(update={"audio_mode": AudioMode.RECORDED}),
        )

    manifest = storage.load_manifest(slug)
    if manifest.gates.audio_aligned:
        storage.save_manifest(
            slug,
            manifest.model_copy(
                update={
                    "updated_at": datetime.now(timezone.utc).astimezone(),
                    "gates": manifest.gates.model_copy(update={"audio_aligned": False}),
                }
            ),
        )

    return {
        "audio_url": f"/api/projects/{slug}/media/audio/narration_master.wav",
        "duration_ms": duration_ms,
    }


@router.post("/audio/align")
def align_project_audio(
    slug: str,
    request: Request,
    body: AlignAudioRequest | None = Body(default=None),
) -> dict[str, Any]:
    settings = get_app_settings(request)
    storage = get_app_storage(request)
    hub = get_app_sse_hub(request)
    ensure_project_exists(storage, slug)

    if not storage.exists(slug, "script.json"):
        raise HTTPException(status_code=422, detail="Gere o roteiro antes de alinhar o áudio.")

    opts = body or AlignAudioRequest()
    manifest = storage.load_manifest(slug)
    briefing = storage.load_briefing(slug)
    script = storage.load_script(slug)
    cache = get_project_cache(slug, cache_root=settings.studio_cache_dir, ensure=True)
    narration_wav = cache.audio / "narration_master.wav"

    hub.publish(
        slug,
        "progress",
        {"stage": "audio_align", "progress_pct": 25, "message": "Preparando áudio e executando forced alignment..."},
    )

    if opts.audio_source == "pilot" or not narration_wav.is_file():
        narration_wav, audio_mode = ensure_pilot_audio(
            script=script,
            cache_dir=cache.root,
            input_audio_path=None,
            target_duration_sec=float(briefing.target_duration_sec),
        )
    else:
        audio_mode = AudioMode.RECORDED

    alignment = align_audio_to_script(
        narration_wav,
        script,
        audio_source=audio_mode,
        audio_cache_relpath="audio/narration_master.wav",
        engine="auto",
    )
    storage.save_audio_alignment(slug, alignment)

    sb_raw = load_storyboard_raw(storage, slug)
    if sb_raw is not None and sb_raw.get("scene_ids"):
        storyboard = storage.load_storyboard(slug)
        scenes = storage.load_all_scenes(slug, storyboard=storyboard)
        try:
            resolved_scenes = resolve_scene_timings(scenes, alignment)
            for scene in resolved_scenes:
                storage.save_scene(slug, scene)
        except (KeyError, ValueError) as exc:
            raise HTTPException(
                status_code=422,
                detail=f"Incompatibilidade entre cenas e word_id do roteiro: {exc}",
            ) from exc

    updated_manifest = manifest.model_copy(
        update={
            "updated_at": datetime.now(timezone.utc).astimezone(),
            "gates": manifest.gates.model_copy(update={"audio_aligned": True}),
        }
    )
    storage.save_manifest(slug, updated_manifest)

    hub.publish(
        slug,
        "progress",
        {
            "stage": "audio_align",
            "progress_pct": 100,
            "message": f"Alinhamento concluído ({len(alignment.words)} palavras · {alignment.duration_ms / 1000:.1f}s).",
        },
    )

    return build_project_detail(slug, settings, storage)


@router.put("/scenes/{scene_id}")
def update_scene(
    slug: str,
    scene_id: str,
    payload: dict[str, Any],
    request: Request,
) -> dict[str, Any]:
    settings = get_app_settings(request)
    storage = get_app_storage(request)
    ensure_project_exists(storage, slug)

    try:
        existing_scene = storage.load_scene(slug, scene_id)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=f"Cena não encontrada: '{scene_id}'.") from exc

    manifest = storage.load_manifest(slug)
    patch = dict(payload)
    allow_tier2_override = bool(patch.pop("allow_tier2_override", False))

    readonly_ignored = {"scene_id", "order", "template_version", "timing", "cache_hash"}
    for ro_key in readonly_ignored:
        patch.pop(ro_key, None)

    allowed_fields = {
        "status",
        "tier",
        "template",
        "visual",
        "assets",
        "sfx_cues",
        "review_pins",
        "cost_usd",
    }
    unknown = set(patch.keys()) - allowed_fields
    if unknown:
        raise HTTPException(
            status_code=422,
            detail=f"Campos não permitidos na atualização de cena: {sorted(unknown)}.",
        )

    merged = existing_scene.model_dump(mode="json")
    if "visual" in patch and isinstance(patch["visual"], dict):
        merged["visual"] = {**merged["visual"], **patch["visual"]}
    for key in ("status", "tier", "template", "assets", "sfx_cues", "review_pins", "cost_usd"):
        if key in patch:
            merged[key] = patch[key]

    # Guardrail Nível 2 (AGENTS.md Regra 4)
    target_tier = merged.get("tier", 1)
    target_template = merged.get("template")
    if (target_tier == 2 or target_template == "tier2_video") and not settings.enable_tier2_video and not allow_tier2_override:
        raise HTTPException(
            status_code=403,
            detail=(
                "Nível 2 (vídeo generativo) está desabilitado por padrão (ENABLE_TIER2_VIDEO=false). "
                "Envie allow_tier2_override=true ou habilite ENABLE_TIER2_VIDEO no .env."
            ),
        )

    try:
        candidate = Scene.model_validate(merged)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc

    # Guardrail de custo por cena e por vídeo
    if candidate.cost_usd > settings.max_cost_per_scene_usd:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Custo da cena (${candidate.cost_usd:.2f}) excede o teto "
                f"MAX_COST_PER_SCENE_USD (${settings.max_cost_per_scene_usd:.2f})."
            ),
        )

    all_scenes = storage.load_all_scenes(slug)
    other_cost = sum(s.cost_usd for s in all_scenes if s.scene_id != scene_id)
    total_estimated = round(other_cost + candidate.cost_usd, 4)
    if total_estimated > manifest.cost_ledger.cap_usd:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Custo total estimado (${total_estimated:.2f}) excede o teto do projeto "
                f"(${manifest.cost_ledger.cap_usd:.2f})."
            ),
        )

    # Invalida cache_hash apenas se campos de composição mudaram
    render_mutated = any(k in patch for k in ("tier", "template", "visual", "assets", "sfx_cues"))
    if render_mutated:
        candidate = candidate.model_copy(update={"cache_hash": None})

    storage.save_scene(slug, candidate)

    updated_scenes = [candidate if s.scene_id == scene_id else s for s in all_scenes]
    all_approved = bool(updated_scenes) and all(
        s.status in (SceneStatus.APPROVED, SceneStatus.RENDERED) for s in updated_scenes
    )
    updated_manifest = manifest.model_copy(
        update={
            "updated_at": datetime.now(timezone.utc).astimezone(),
            "gates": manifest.gates.model_copy(update={"scenes_approved": all_approved}),
            "cost_ledger": manifest.cost_ledger.model_copy(
                update={"estimated_total": total_estimated}
            ),
        }
    )
    storage.save_manifest(slug, updated_manifest)

    return {
        "scene": candidate.model_dump(mode="json"),
        "manifest": updated_manifest.model_dump(mode="json"),
    }


@router.post("/scenes/{scene_id}/asset")
async def upload_scene_asset(
    slug: str,
    scene_id: str,
    request: Request,
    file: UploadFile = File(...),
    asset_id: str | None = Form(default=None),
    apply_rembg: bool = Form(default=False),
) -> dict[str, Any]:
    settings = get_app_settings(request)
    storage = get_app_storage(request)
    ensure_project_exists(storage, slug)

    try:
        scene = storage.load_scene(slug, scene_id)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=f"Cena não encontrada: '{scene_id}'.") from exc

    raw_bytes = await file.read()
    cache = get_project_cache(slug, cache_root=settings.studio_cache_dir, ensure=True)

    try:
        updated_scene, _, cache_relpath = process_uploaded_scene_asset(
            file_bytes=raw_bytes,
            filename=file.filename or "asset.png",
            scene=scene,
            cache=cache,
            asset_id=asset_id,
            apply_rembg=apply_rembg,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    storage.save_scene(slug, updated_scene)
    return {
        "scene": updated_scene.model_dump(mode="json"),
        "asset_url": f"/api/projects/{slug}/media/{cache_relpath}",
    }


@router.post("/scenes/{scene_id}/regenerate")
def regenerate_single_scene(
    slug: str,
    scene_id: str,
    request: Request,
    body: RegenerateSceneRequest | None = Body(default=None),
) -> dict[str, Any]:
    settings = get_app_settings(request)
    storage = get_app_storage(request)
    hub = get_app_sse_hub(request)
    ensure_project_exists(storage, slug)

    opts = body or RegenerateSceneRequest()
    try:
        scene = storage.load_scene(slug, scene_id)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=f"Cena não encontrada: '{scene_id}'.") from exc

    manifest = storage.load_manifest(slug)
    briefing = storage.load_briefing(slug)
    script = storage.load_script(slug)
    preset = load_preset(manifest.preset_id, presets_dir=get_presets_dir(settings))
    cache = get_project_cache(slug, cache_root=settings.studio_cache_dir, ensure=True)

    # Garante alinhamento e timings resolvidos antes de renderizar a cena isoladamente
    if storage.exists(slug, "audio_alignment.json"):
        alignment = storage.load_audio_alignment(slug)
    else:
        narration_wav = cache.audio / "narration_master.wav"
        if not narration_wav.is_file():
            narration_wav, audio_mode = ensure_pilot_audio(
                script=script,
                cache_dir=cache.root,
                target_duration_sec=float(briefing.target_duration_sec),
            )
        else:
            audio_mode = AudioMode.RECORDED
        alignment = align_audio_to_script(
            narration_wav,
            script,
            audio_source=audio_mode,
            audio_cache_relpath="audio/narration_master.wav",
            engine="auto",
        )
        storage.save_audio_alignment(slug, alignment)

    if scene.timing.resolved_start_ms is None or scene.timing.resolved_end_ms is None:
        storyboard = storage.load_storyboard(slug) if storage.exists(slug, "storyboard.json") else None
        all_scenes = storage.load_all_scenes(slug, storyboard=storyboard)
        resolved_all = resolve_scene_timings(all_scenes, alignment)
        for item in resolved_all:
            storage.save_scene(slug, item)
            if item.scene_id == scene_id:
                scene = item

    hub.publish(
        slug,
        "progress",
        {
            "stage": "scene_regenerate",
            "scene_id": scene_id,
            "progress_pct": 20,
            "message": f"Renderizando cena {scene_id} ({opts.profile})...",
        },
    )

    sb_raw = load_storyboard_raw(storage, slug)
    captions_enabled = bool(sb_raw.get("captions_enabled", True)) if sb_raw is not None else True

    try:
        clip_path, cache_hash, cache_hit = render_scene_clip(
            scene=scene,
            alignment=alignment,
            script=script,
            preset=preset,
            cache=cache,
            profile=opts.profile,
            templates_dir=settings.workspace_root / "templates_video",
            force=opts.force,
            format_type=manifest.series.format_type.value,
            captions_enabled=captions_enabled,
        )
    except (RuntimeError, ValueError, FileNotFoundError) as exc:
        hub.publish(
            slug,
            "error",
            {
                "stage": "scene_regenerate",
                "scene_id": scene_id,
                "message": str(exc),
                "error": str(exc),
            },
        )
        raise HTTPException(status_code=500, detail=f"Falha ao regenerar '{scene_id}': {exc}") from exc

    updated_scene = scene.model_copy(
        update={
            "cache_hash": cache_hash,
            "status": SceneStatus.RENDERED,
        }
    )
    storage.save_scene(slug, updated_scene)

    rel_clip = clip_path.resolve().relative_to(cache.root.resolve()).as_posix()
    clip_url = f"/api/projects/{slug}/media/{rel_clip}"
    thumb_path = cache.scene_thumb_path(scene_id, cache_hash)
    thumbnail_url = (
        f"/api/projects/{slug}/media/thumbs/{thumb_path.name}"
        if thumb_path.is_file() and thumb_path.stat().st_size > 0
        else None
    )
    hub.publish(
        slug,
        "progress",
        {
            "stage": "scene_regenerate",
            "scene_id": scene_id,
            "progress_pct": 100,
            "cache_hit": cache_hit,
            "clip_url": clip_url,
            "thumbnail_url": thumbnail_url,
            "message": f"Cena {scene_id} pronta ({'cache hit' if cache_hit else 'renderizada'}).",
        },
    )

    return {
        "scene": updated_scene.model_dump(mode="json"),
        "clip_url": clip_url,
        "thumbnail_url": thumbnail_url,
        "cache_hit": cache_hit,
    }


def _find_uploaded_audio_for_render(cache_audio_dir: Path) -> Path | None:
    """Retorna cópia segura da gravação enviada pelo usuário para evitar sobrescrita in-place no FFmpeg."""
    for ext in _ALLOWED_AUDIO_EXTENSIONS:
        candidate = cache_audio_dir / f"uploaded_source{ext}"
        if candidate.is_file() and candidate.stat().st_size > 0:
            return candidate
    narration = cache_audio_dir / "narration_master.wav"
    if narration.is_file() and narration.stat().st_size > 0:
        copy_path = cache_audio_dir / "_render_input_copy.wav"
        shutil.copy2(narration, copy_path)
        return copy_path
    return None


def _run_background_render(
    *,
    job_id: str,
    slug: str,
    profile: Literal["preview", "final"],
    force: bool,
    settings: StudioSettings,
    storage: ProjectStorage,
    hub: SSEHub,
) -> None:
    cache = get_project_cache(slug, cache_root=settings.studio_cache_dir, ensure=True)
    temp_audio_copy: Path | None = None
    try:
        hub.publish(
            slug,
            "progress",
            {
                "job_id": job_id,
                "stage": "preparing",
                "scene_id": None,
                "progress_pct": 10,
                "message": f"Iniciando render {profile} (áudio + alinhamento word_id)...",
            },
        )
        briefing = storage.load_briefing(slug)
        input_audio: Path | None = None
        if briefing.audio_mode == AudioMode.RECORDED:
            input_audio = _find_uploaded_audio_for_render(cache.audio)
            if input_audio is not None and input_audio.name == "_render_input_copy.wav":
                temp_audio_copy = input_audio

        hub.publish(
            slug,
            "progress",
            {
                "job_id": job_id,
                "stage": "rendering",
                "scene_id": None,
                "progress_pct": 40,
                "message": f"Renderizando cenas Nível 1 ({profile}) e mixando áudio -14 LUFS...",
            },
        )

        result = render_project(
            slug=slug,
            profile=profile,
            input_audio_path=input_audio,
            force=force,
            settings=settings,
            storage=storage,
            templates_dir=settings.workspace_root / "templates_video",
        )

        hub.publish(
            slug,
            "progress",
            {
                "job_id": job_id,
                "stage": "qa",
                "scene_id": None,
                "progress_pct": 92,
                "message": "Contact sheet e métricas ffprobe concluídas.",
            },
        )

        final_rel = result.final_mp4.resolve().relative_to(cache.root.resolve()).as_posix()
        sheet_rel = result.contact_sheet_jpg.resolve().relative_to(cache.root.resolve()).as_posix()
        hub.publish(
            slug,
            "done",
            {
                "job_id": job_id,
                "stage": "done",
                "scene_id": None,
                "progress_pct": 100,
                "profile": profile,
                "done": True,
                "video_url": f"/api/projects/{slug}/media/{final_rel}",
                "contact_sheet_url": f"/api/projects/{slug}/media/{sheet_rel}",
                "cache_hits": result.cache_hits,
                "cache_misses": result.cache_misses,
                "ffprobe_metrics": result.ffprobe_metrics,
                "message": f"Render {profile} concluído com sucesso!",
            },
        )
    except Exception as exc:  # noqa: BLE001 - thread de background precisa reportar erro via SSE
        logger.exception("Erro no background render do projeto '%s' (job=%s)", slug, job_id)
        hub.publish(
            slug,
            "error",
            {
                "job_id": job_id,
                "stage": "error",
                "scene_id": None,
                "progress_pct": 0,
                "done": False,
                "error": str(exc),
                "message": f"Falha no render: {exc}",
            },
        )
    finally:
        if temp_audio_copy is not None:
            temp_audio_copy.unlink(missing_ok=True)


@router.post("/render")
def start_project_render(
    slug: str,
    request: Request,
    body: RenderProjectRequest | None = Body(default=None),
) -> dict[str, Any]:
    settings = get_app_settings(request)
    storage = get_app_storage(request)
    hub = get_app_sse_hub(request)
    ensure_project_exists(storage, slug)

    if not storage.exists(slug, "script.json"):
        raise HTTPException(status_code=422, detail="Roteiro ausente para iniciar render.")
    sb_raw = load_storyboard_raw(storage, slug)
    if sb_raw is None or not sb_raw.get("scene_ids"):
        raise HTTPException(status_code=422, detail="Aprove o Gate 1 para gerar as cenas antes de renderizar.")

    script = storage.load_script(slug)
    if not script.all_scripture_verified():
        raise HTTPException(
            status_code=422,
            detail="Checkpoint de Rigor Bíblico pendente: confirme todas as referências antes de renderizar.",
        )

    opts = body or RenderProjectRequest()
    job_id = uuid.uuid4().hex[:12]

    worker = threading.Thread(
        target=_run_background_render,
        kwargs={
            "job_id": job_id,
            "slug": slug,
            "profile": opts.profile,
            "force": opts.force,
            "settings": settings,
            "storage": storage,
            "hub": hub,
        },
        name=f"render-{slug}-{job_id}",
        daemon=True,
    )
    worker.start()

    return {"job_id": job_id, "status": "started"}


def _load_project_scenes(storage: ProjectStorage, slug: str) -> tuple[dict[str, Any] | None, list[Scene]]:
    sb_raw = load_storyboard_raw(storage, slug)
    if sb_raw is not None:
        if sb_raw.get("scene_ids"):
            return sb_raw, storage.load_all_scenes(slug, storyboard=storage.load_storyboard(slug))
        return sb_raw, []
    if storage.scenes_dir(slug).is_dir():
        return None, storage.load_all_scenes(slug)
    return None, []


def _run_pending_background(
    *,
    job_id: str,
    slug: str,
    profile: Literal["preview", "final"],
    settings: StudioSettings,
    storage: ProjectStorage,
    hub: SSEHub,
) -> None:
    cache = get_project_cache(slug, cache_root=settings.studio_cache_dir, ensure=True)
    templates_dir = settings.workspace_root / "templates_video"
    regenerated_scenes: list[str] = []
    audio_realigned = False
    video_url: str | None = None
    contact_sheet_url: str | None = None

    try:
        manifest = storage.load_manifest(slug)
        briefing = storage.load_briefing(slug) if storage.exists(slug, "briefing.json") else None
        script = storage.load_script(slug) if storage.exists(slug, "script.json") else None
        alignment = (
            storage.load_audio_alignment(slug)
            if storage.exists(slug, "audio_alignment.json")
            else None
        )
        sb_raw, scenes = _load_project_scenes(storage, slug)
        preset = load_preset(manifest.preset_id, presets_dir=get_presets_dir(settings))
        captions_enabled = bool(sb_raw.get("captions_enabled", True)) if sb_raw is not None else True

        pipeline_status, _ = compute_pipeline_runtime(
            slug=slug,
            manifest=manifest,
            script=script,
            audio_alignment=alignment,
            scenes=scenes,
            preset=preset,
            cache=cache,
            templates_dir=templates_dir,
            ensure_thumbs=False,
        )

        hub.publish(
            slug,
            "progress",
            {
                "job_id": job_id,
                "stage": "preparing",
                "scene_id": None,
                "progress_pct": 5,
                "message": f"Executando pendências ({pipeline_status['pending_count']} etapa(s))...",
            },
        )

        # 1) Alinhamento de áudio se audio_stale
        if pipeline_status["audio_stale"] and script is not None:
            hub.publish(
                slug,
                "progress",
                {
                    "job_id": job_id,
                    "stage": "audio_align",
                    "scene_id": None,
                    "progress_pct": 15,
                    "message": "Alinhando áudio ao roteiro (word_id)...",
                },
            )
            narration_wav = cache.audio / "narration_master.wav"
            if narration_wav.is_file() and narration_wav.stat().st_size > 0:
                audio_mode = (
                    briefing.audio_mode if briefing is not None else AudioMode.RECORDED
                )
            else:
                target_sec = (
                    float(briefing.target_duration_sec)
                    if briefing is not None
                    else float(preset.video.target_duration_sec.ideal)
                )
                narration_wav, audio_mode = ensure_pilot_audio(
                    script=script,
                    cache_dir=cache.root,
                    input_audio_path=None,
                    target_duration_sec=target_sec,
                )

            alignment = align_audio_to_script(
                narration_wav,
                script,
                audio_source=audio_mode,
                audio_cache_relpath="audio/narration_master.wav",
                engine="auto",
            )
            storage.save_audio_alignment(slug, alignment)

            if scenes:
                scenes = resolve_scene_timings(scenes, alignment)
                for scene in scenes:
                    storage.save_scene(slug, scene)

            manifest = manifest.model_copy(
                update={
                    "updated_at": datetime.now(timezone.utc).astimezone(),
                    "gates": manifest.gates.model_copy(update={"audio_aligned": True}),
                }
            )
            storage.save_manifest(slug, manifest)
            audio_realigned = True

            hub.publish(
                slug,
                "progress",
                {
                    "job_id": job_id,
                    "stage": "audio_align",
                    "scene_id": None,
                    "progress_pct": 30,
                    "message": f"Áudio alinhado ({len(alignment.words)} palavras).",
                },
            )

        # 2) Recalcula stale_scene_ids após alinhamento e renderiza APENAS cenas desatualizadas
        pipeline_status, _ = compute_pipeline_runtime(
            slug=slug,
            manifest=manifest,
            script=script,
            audio_alignment=alignment,
            scenes=scenes,
            preset=preset,
            cache=cache,
            templates_dir=templates_dir,
            ensure_thumbs=False,
        )
        stale_scene_ids: list[str] = list(pipeline_status["stale_scene_ids"])

        if stale_scene_ids and script is not None and alignment is not None:
            total_stale = len(stale_scene_ids)
            for idx, sid in enumerate(stale_scene_ids, start=1):
                scene = storage.load_scene(slug, sid)
                pct = 30 + int(((idx - 1) / total_stale) * 40)
                hub.publish(
                    slug,
                    "progress",
                    {
                        "job_id": job_id,
                        "stage": "scene_render",
                        "scene_id": sid,
                        "progress_pct": pct,
                        "message": f"Renderizando cena pendente {sid} ({idx}/{total_stale})...",
                    },
                )
                _, cache_hash, _ = render_scene_clip(
                    scene=scene,
                    alignment=alignment,
                    script=script,
                    preset=preset,
                    cache=cache,
                    profile=profile,
                    templates_dir=templates_dir,
                    force=False,
                    format_type=manifest.series.format_type.value,
                    captions_enabled=captions_enabled,
                )
                updated_scene = scene.model_copy(
                    update={"cache_hash": cache_hash, "status": SceneStatus.RENDERED}
                )
                storage.save_scene(slug, updated_scene)
                regenerated_scenes.append(sid)

        # 3) Concatenação -c copy + mixagem + contact sheet se render_stale ou houve cena re-renderizada
        if scenes and (pipeline_status["render_stale"] or regenerated_scenes):
            hub.publish(
                slug,
                "progress",
                {
                    "job_id": job_id,
                    "stage": "rendering",
                    "scene_id": None,
                    "progress_pct": 78,
                    "message": f"Consolidando vídeo ({profile}, concat -c copy + mixagem -14 LUFS)...",
                },
            )
            result = render_project(
                slug=slug,
                profile=profile,
                input_audio_path=None,
                force=False,
                settings=settings,
                storage=storage,
                templates_dir=templates_dir,
            )
            final_rel = result.final_mp4.resolve().relative_to(cache.root.resolve()).as_posix()
            sheet_rel = result.contact_sheet_jpg.resolve().relative_to(cache.root.resolve()).as_posix()
            video_url = f"/api/projects/{slug}/media/{final_rel}"
            contact_sheet_url = f"/api/projects/{slug}/media/{sheet_rel}"

        # 4) Evento SSE done com resumo completo
        hub.publish(
            slug,
            "done",
            {
                "job_id": job_id,
                "stage": "done",
                "scene_id": None,
                "progress_pct": 100,
                "done": True,
                "profile": profile,
                "regenerated_scenes": regenerated_scenes,
                "audio_realigned": audio_realigned,
                "video_url": video_url,
                "contact_sheet_url": contact_sheet_url,
                "message": (
                    f"Pendências concluídas ({len(regenerated_scenes)} cena(s) atualizada(s))."
                ),
            },
        )
    except Exception as exc:  # noqa: BLE001 - thread de background precisa reportar erro via SSE
        logger.exception("Erro em run-pending do projeto '%s' (job=%s)", slug, job_id)
        hub.publish(
            slug,
            "error",
            {
                "job_id": job_id,
                "stage": "error",
                "scene_id": None,
                "progress_pct": 0,
                "done": False,
                "error": str(exc),
                "message": f"Falha ao executar pendências: {exc}",
            },
        )


@router.post("/run-pending")
def run_project_pending(
    slug: str,
    request: Request,
    body: RunPendingRequest | None = Body(default=None),
) -> dict[str, Any]:
    """Executa seletivamente via SSE apenas as etapas pendentes/desatualizadas de 1 vídeo ativo."""
    settings = get_app_settings(request)
    storage = get_app_storage(request)
    hub = get_app_sse_hub(request)
    ensure_project_exists(storage, slug)

    opts = body or RunPendingRequest()
    manifest = storage.load_manifest(slug)
    script = storage.load_script(slug) if storage.exists(slug, "script.json") else None
    alignment = (
        storage.load_audio_alignment(slug)
        if storage.exists(slug, "audio_alignment.json")
        else None
    )
    _, scenes = _load_project_scenes(storage, slug)
    preset = load_preset(manifest.preset_id, presets_dir=get_presets_dir(settings))
    cache = get_project_cache(slug, cache_root=settings.studio_cache_dir, ensure=False)

    pipeline_status, _ = compute_pipeline_runtime(
        slug=slug,
        manifest=manifest,
        script=script,
        audio_alignment=alignment,
        scenes=scenes,
        preset=preset,
        cache=cache,
        templates_dir=settings.workspace_root / "templates_video",
        ensure_thumbs=False,
    )

    if pipeline_status["pending_count"] == 0:
        return {
            "job_id": None,
            "status": "noop",
            "pending_count": 0,
            "stale_scene_ids": [],
            "message": "Projeto já está atualizado.",
        }

    if script is not None and not script.all_scripture_verified():
        raise HTTPException(
            status_code=422,
            detail="Checkpoint de Rigor Bíblico pendente: confirme todas as referências antes de executar pendências.",
        )

    job_id = uuid.uuid4().hex[:12]
    worker = threading.Thread(
        target=_run_pending_background,
        kwargs={
            "job_id": job_id,
            "slug": slug,
            "profile": opts.profile,
            "settings": settings,
            "storage": storage,
            "hub": hub,
        },
        name=f"run-pending-{slug}-{job_id}",
        daemon=True,
    )
    worker.start()

    return {
        "job_id": job_id,
        "status": "started",
        "pending_count": pipeline_status["pending_count"],
        "stale_scene_ids": list(pipeline_status["stale_scene_ids"]),
    }


@router.get("/events")
async def project_events(slug: str, request: Request) -> StreamingResponse:
    storage = get_app_storage(request)
    hub = get_app_sse_hub(request)
    ensure_project_exists(storage, slug)

    return StreamingResponse(
        hub.subscribe(slug),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/cover")
def create_project_cover(slug: str, request: Request) -> dict[str, Any]:
    settings = get_app_settings(request)
    storage = get_app_storage(request)
    ensure_project_exists(storage, slug)

    if not storage.exists(slug, "script.json"):
        raise HTTPException(status_code=422, detail="Gere o roteiro (cover_spec) antes de gerar a capa PNG.")

    manifest = storage.load_manifest(slug)
    script = storage.load_script(slug)
    preset = load_preset(manifest.preset_id, presets_dir=get_presets_dir(settings))
    cache = get_project_cache(slug, cache_root=settings.studio_cache_dir, ensure=True)

    generate_cover_png(script=script, manifest=manifest, preset=preset, cache=cache)
    return {"cover_url": f"/api/projects/{slug}/media/qa/cover.png"}


@router.get("/media/{subpath:path}")
def serve_project_media(slug: str, subpath: str, request: Request) -> FileResponse:
    settings = get_app_settings(request)
    storage = get_app_storage(request)
    ensure_project_exists(storage, slug)

    # Proteção estrita contra path traversal (rejeita '..', caminhos absolutos ou fuga do cache)
    normalized = subpath.replace("\\", "/").strip()
    if not normalized or normalized.startswith("/") or ".." in Path(normalized).parts:
        raise HTTPException(status_code=403, detail="Acesso negado: caminho de mídia inválido.")

    cache = get_project_cache(slug, cache_root=settings.studio_cache_dir, ensure=False)
    cache_root = cache.root.resolve()
    candidate = (cache_root / normalized).resolve()

    if not candidate.is_relative_to(cache_root):
        raise HTTPException(status_code=403, detail="Acesso negado: tentativa de path traversal.")
    if not candidate.is_file():
        raise HTTPException(status_code=404, detail=f"Arquivo de mídia não encontrado: '{normalized}'.")

    return FileResponse(candidate)
