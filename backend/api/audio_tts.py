"""Rotas REST + SSE da Fase 3: Capacidades TTS, Amostras de Voz, Preview Bíblico e Síntese Local."""

from __future__ import annotations

import logging
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Body, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict

from backend.api import (
    ensure_project_exists,
    get_app_settings,
    get_app_sse_hub,
    get_app_storage,
    load_storyboard_raw,
)
from backend.core.cache import get_project_cache
from backend.core.config import StudioSettings
from backend.core.storage import ProjectStorage
from backend.services.alignment_service import (
    _probe_audio_metadata,
    align_audio_to_script,
    resolve_scene_timings,
)
from backend.services.sse_hub import SSEHub
from backend.services.tts_local_service import (
    TtsEngineId,
    build_tts_preview,
    delete_voice_sample,
    generate_tts_narration,
    get_audio_capabilities,
    list_voice_samples,
    resolve_voice_sample_path,
    save_uploaded_voice_sample,
    validate_tts_generation_request,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["audio-tts"])


class GenerateTtsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    engine: Literal["pilot_sapi", "xtts_v2", "f5_tts", "voicestudio"] = "pilot_sapi"
    voice_sample_id: str | None = None
    auto_align: bool = True


@router.get("/api/audio/capabilities")
def read_audio_capabilities(request: Request) -> dict[str, Any]:
    """Retorna capacidades de hardware, engines TTS/alinhamento e amostras de voz (0 segredos)."""
    settings = get_app_settings(request)
    return get_audio_capabilities(settings)


@router.get("/api/voice-samples")
def read_voice_samples(request: Request) -> dict[str, Any]:
    """Lista amostras de voz cadastradas em STUDIO_CACHE_DIR/_voice_samples/."""
    settings = get_app_settings(request)
    return {"samples": list_voice_samples(settings)}


@router.post("/api/voice-samples/upload")
async def upload_voice_sample(
    request: Request,
    file: UploadFile = File(...),
    name: str | None = Form(default=None),
) -> dict[str, Any]:
    """Recebe áudio de referência, converte para WAV 24kHz mono fora do OneDrive e mede duração."""
    settings = get_app_settings(request)
    raw_bytes = await file.read()
    try:
        sample = save_uploaded_voice_sample(
            settings,
            file_bytes=raw_bytes,
            filename=file.filename or "amostra.wav",
            custom_name=name,
        )
    except (ValueError, RuntimeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"sample": sample}


@router.get("/api/voice-samples/{sample_id}/audio")
def serve_voice_sample_audio(sample_id: str, request: Request) -> FileResponse:
    """Serve o arquivo WAV de uma amostra de voz com proteção contra path traversal."""
    settings = get_app_settings(request)
    try:
        sample_path = resolve_voice_sample_path(settings, sample_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if sample_path is None:
        raise HTTPException(status_code=404, detail=f"Amostra de voz não encontrada: '{sample_id}'.")
    return FileResponse(sample_path, media_type="audio/wav", filename=sample_path.name)


@router.delete("/api/voice-samples/{sample_id}")
def remove_voice_sample(sample_id: str, request: Request) -> dict[str, Any]:
    """Remove amostra de voz salva em STUDIO_CACHE_DIR/_voice_samples/."""
    settings = get_app_settings(request)
    try:
        removed = delete_voice_sample(settings, sample_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not removed:
        raise HTTPException(status_code=404, detail=f"Amostra de voz não encontrada: '{sample_id}'.")
    return {"deleted": True, "sample_id": sample_id}


@router.post("/api/projects/{slug}/audio/preview-tts")
def preview_project_tts_text(slug: str, request: Request) -> dict[str, Any]:
    """Lê script.json e aplica normalize_biblical_text + split_tts_chunks em cada segmento."""
    storage = get_app_storage(request)
    ensure_project_exists(storage, slug)
    if not storage.exists(slug, "script.json"):
        raise HTTPException(
            status_code=422,
            detail="Gere o roteiro (script.json) antes de visualizar o texto normalizado pré-TTS.",
        )
    script = storage.load_script(slug)
    return build_tts_preview(script)


def _run_tts_generation_background(
    *,
    job_id: str,
    slug: str,
    engine: TtsEngineId,
    voice_sample_id: str | None,
    auto_align: bool,
    settings: StudioSettings,
    storage: ProjectStorage,
    hub: SSEHub,
) -> None:
    cache = get_project_cache(slug, cache_root=settings.studio_cache_dir, ensure=True)
    try:
        manifest = storage.load_manifest(slug)
        briefing = storage.load_briefing(slug) if storage.exists(slug, "briefing.json") else None
        script = storage.load_script(slug)
        target_dur = float(briefing.target_duration_sec) if briefing is not None else 40.0

        hub.publish(
            slug,
            "progress",
            {
                "job_id": job_id,
                "stage": "tts_generate",
                "progress_pct": 5,
                "engine": engine,
                "message": f"Preparando síntese de narração ({engine})...",
            },
        )

        def _on_tts_progress(pct: int, msg: str) -> None:
            mapped = int(round(pct * (0.72 if auto_align else 0.94)))
            hub.publish(
                slug,
                "progress",
                {
                    "job_id": job_id,
                    "stage": "tts_generate",
                    "progress_pct": max(5, min(95, mapped)),
                    "engine": engine,
                    "message": msg,
                },
            )

        narration_wav, audio_mode = generate_tts_narration(
            settings=settings,
            script=script,
            cache=cache,
            engine=engine,
            voice_sample_id=voice_sample_id,
            target_duration_sec=target_dur,
            on_progress=_on_tts_progress,
        )
        _, duration_ms = _probe_audio_metadata(narration_wav)

        if briefing is not None:
            storage.save_briefing(
                slug,
                briefing.model_copy(update={"audio_mode": audio_mode}),
            )

        alignment_engine_used: str | None = None
        words_count = 0

        if auto_align:
            hub.publish(
                slug,
                "progress",
                {
                    "job_id": job_id,
                    "stage": "audio_align",
                    "progress_pct": 80,
                    "engine": engine,
                    "message": "Executando forced alignment palavra-por-palavra (word_id)...",
                },
            )
            alignment = align_audio_to_script(
                narration_wav,
                script,
                audio_source=audio_mode,
                audio_cache_relpath="audio/narration_master.wav",
                engine="auto",
                tts_venv_python=settings.tts_venv_python,
                whisper_model=settings.whisper_model,
                whisper_device=settings.whisper_device,
            )
            storage.save_audio_alignment(slug, alignment)
            alignment_engine_used = alignment.alignment_engine
            words_count = len(alignment.words)
            duration_ms = alignment.duration_ms

            sb_raw = load_storyboard_raw(storage, slug)
            if sb_raw is not None and sb_raw.get("scene_ids"):
                storyboard = storage.load_storyboard(slug)
                scenes = storage.load_all_scenes(slug, storyboard=storyboard)
                resolved_scenes = resolve_scene_timings(scenes, alignment)
                for scene in resolved_scenes:
                    storage.save_scene(slug, scene)

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
                    "job_id": job_id,
                    "stage": "audio_align",
                    "progress_pct": 96,
                    "engine": engine,
                    "message": f"Alinhamento concluído ({words_count} palavras · {duration_ms / 1000:.1f}s).",
                },
            )
        else:
            updated_manifest = manifest.model_copy(
                update={
                    "updated_at": datetime.now(timezone.utc).astimezone(),
                    "gates": manifest.gates.model_copy(update={"audio_aligned": False}),
                }
            )
            storage.save_manifest(slug, updated_manifest)

        hub.publish(
            slug,
            "done",
            {
                "job_id": job_id,
                "stage": "tts_generate",
                "done": True,
                "progress_pct": 100,
                "audio_url": f"/api/projects/{slug}/media/audio/narration_master.wav",
                "duration_ms": duration_ms,
                "engine": engine,
                "alignment_engine": alignment_engine_used,
                "words_count": words_count,
                "message": (
                    f"Narração gerada via {engine} e alinhada ({words_count} palavras)."
                    if auto_align
                    else f"Narração gerada via {engine}."
                ),
            },
        )
    except Exception as exc:  # noqa: BLE001 - thread em background precisa reportar erro via SSE
        logger.exception("Erro na geração TTS do projeto '%s' (job=%s)", slug, job_id)
        hub.publish(
            slug,
            "error",
            {
                "job_id": job_id,
                "stage": "tts_generate",
                "done": False,
                "progress_pct": 0,
                "engine": engine,
                "error": str(exc),
                "message": f"Falha ao gerar narração TTS: {exc}",
            },
        )


@router.post("/api/projects/{slug}/audio/generate-tts")
def start_project_tts_generation(
    slug: str,
    request: Request,
    body: GenerateTtsRequest | None = Body(default=None),
) -> dict[str, Any]:
    """Valida requisitos fail-fast e dispara geração de narração TTS + alinhamento em background."""
    settings = get_app_settings(request)
    storage = get_app_storage(request)
    hub = get_app_sse_hub(request)
    ensure_project_exists(storage, slug)

    if not storage.exists(slug, "script.json"):
        raise HTTPException(
            status_code=422,
            detail="Gere o roteiro (script.json) antes de sintetizar a narração TTS.",
        )

    opts = body or GenerateTtsRequest()
    try:
        validate_tts_generation_request(settings, opts.engine, opts.voice_sample_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    job_id = uuid.uuid4().hex[:12]
    worker = threading.Thread(
        target=_run_tts_generation_background,
        kwargs={
            "job_id": job_id,
            "slug": slug,
            "engine": opts.engine,
            "voice_sample_id": opts.voice_sample_id,
            "auto_align": opts.auto_align,
            "settings": settings,
            "storage": storage,
            "hub": hub,
        },
        name=f"tts-{slug}-{job_id}",
        daemon=True,
    )
    worker.start()

    return {
        "job_id": job_id,
        "status": "started",
        "engine": opts.engine,
        "auto_align": opts.auto_align,
    }
