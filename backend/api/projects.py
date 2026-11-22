"""Rotas REST de saúde, presets e CRUD inicial de projetos (/api/health, /api/presets, /api/projects)."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from backend.api import (
    build_project_detail,
    ensure_project_exists,
    get_app_settings,
    get_app_storage,
    get_presets_dir,
    load_storyboard_raw,
)
from backend.core.cache import get_project_cache
from backend.core.config import load_preset
from backend.core.storage import atomic_write_text
from backend.models.briefing import Briefing
from backend.models.preset import HumanSealMode
from backend.models.project import CostLedger, ProjectGates, ProjectManifest, SeriesMetadata
from backend.services.cocreation_service import recommend_format, slugify_title

router = APIRouter(prefix="/api", tags=["projects"])


class CreateProjectRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=160)
    raw_idea: str = Field(min_length=1, max_length=2000)
    seed_reference: str | None = Field(default=None, max_length=120)
    bible_translation: str | None = Field(default=None, max_length=20)


@router.get("/health")
def health_check(request: Request) -> dict[str, Any]:
    settings = get_app_settings(request)
    return {
        "status": "ok",
        "cache_dir": str(settings.studio_cache_dir),
        "default_preset": settings.default_preset,
    }


@router.get("/presets")
def list_presets(request: Request) -> dict[str, Any]:
    settings = get_app_settings(request)
    presets_dir = get_presets_dir(settings)
    presets = []
    if presets_dir.is_dir():
        for path in sorted(presets_dir.glob("*.json")):
            preset = load_preset(path.stem, presets_dir=presets_dir)
            presets.append(preset.model_dump(mode="json"))
    return {"presets": presets}


@router.get("/projects")
def list_projects(request: Request) -> dict[str, Any]:
    settings = get_app_settings(request)
    storage = get_app_storage(request)

    items: list[dict[str, Any]] = []
    for slug in storage.list_projects():
        manifest = storage.load_manifest(slug)
        sb_raw = load_storyboard_raw(storage, slug)
        if sb_raw is not None:
            scene_count = len(sb_raw.get("scene_ids") or [])
        elif storage.scenes_dir(slug).is_dir():
            scene_count = len(list(storage.scenes_dir(slug).glob("*.json")))
        else:
            scene_count = 0

        cache = get_project_cache(slug, cache_root=settings.studio_cache_dir, ensure=False)
        final_mp4 = cache.final_video_path(profile="final")
        has_final_mp4 = final_mp4.is_file() and final_mp4.stat().st_size > 0

        items.append(
            {
                "slug": manifest.slug,
                "title": manifest.title,
                "updated_at": manifest.updated_at.isoformat(),
                "format_type": manifest.series.format_type.value,
                "gates": manifest.gates.model_dump(mode="json"),
                "scene_count": scene_count,
                "has_final_mp4": has_final_mp4,
                "cost_spent_usd": manifest.cost_ledger.spent_total,
            }
        )

    items.sort(key=lambda item: item["updated_at"], reverse=True)
    return {"projects": items}


@router.post("/projects")
def create_project(body: CreateProjectRequest, request: Request) -> dict[str, Any]:
    settings = get_app_settings(request)
    storage = get_app_storage(request)
    preset = load_preset(settings.default_preset, presets_dir=get_presets_dir(settings))

    base_slug = slugify_title(body.title)
    slug = base_slug
    suffix = 2
    while storage.exists(slug, "manifest.json"):
        slug = f"{base_slug}-{suffix}"
        suffix += 1

    seed_ref = body.seed_reference.strip() if body.seed_reference and body.seed_reference.strip() else None
    translation = (
        body.bible_translation.strip()
        if body.bible_translation and body.bible_translation.strip()
        else settings.default_bible_translation or preset.default_bible_translation
    )

    recommended = recommend_format(body.raw_idea, seed_ref, preset)
    now = datetime.now(timezone.utc).astimezone()

    existing_in_series = 0
    for existing_slug in storage.list_projects():
        existing_manifest = storage.load_manifest(existing_slug)
        if existing_manifest.series.format_type == recommended.format_type:
            existing_in_series += 1

    manifest = ProjectManifest(
        slug=slug,
        title=body.title.strip(),
        created_at=now,
        updated_at=now,
        preset_id=preset.preset_id,
        series=SeriesMetadata(
            series_id=recommended.format_type.value,
            format_type=recommended.format_type,
            episode_number=existing_in_series + 1,
            batch_id="retomada-lote-01",
        ),
        cost_ledger=CostLedger(
            currency="USD",
            estimated_total=0.0,
            spent_total=0.0,
            cap_usd=settings.max_cost_per_video_usd,
            items=[],
        ),
    )

    briefing = Briefing(
        raw_idea=body.raw_idea.strip(),
        seed_reference=seed_ref,
        bible_translation=translation,
        target_duration_sec=int(round(preset.video.target_duration_sec.ideal)),
        audio_mode=settings.tts_provider,
        human_seal_mode=HumanSealMode.PAPER_CUTOUT,
        recommended_format=recommended,
        selected_format_type=recommended.format_type,
        optional_reference_layout=None,
    )

    storage.save_manifest(slug, manifest)
    storage.save_briefing(slug, briefing)
    return build_project_detail(slug, settings, storage)


@router.get("/projects/{slug}")
def get_project(slug: str, request: Request) -> dict[str, Any]:
    settings = get_app_settings(request)
    storage = get_app_storage(request)
    try:
        return build_project_detail(slug, settings, storage)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/projects/{slug}/clone-workflow")
def clone_project_workflow(
    slug: str,
    body: CreateProjectRequest,
    request: Request,
) -> dict[str, Any]:
    """Cria 1 único novo projeto herdando estilo, série, tradução e preferências de montagem de {slug}."""
    settings = get_app_settings(request)
    storage = get_app_storage(request)
    ensure_project_exists(storage, slug)

    source_manifest = storage.load_manifest(slug)
    source_briefing = storage.load_briefing(slug) if storage.exists(slug, "briefing.json") else None
    source_storyboard = load_storyboard_raw(storage, slug)
    preset = load_preset(source_manifest.preset_id, presets_dir=get_presets_dir(settings))

    base_slug = slugify_title(body.title)
    new_slug = base_slug
    suffix = 2
    while storage.exists(new_slug, "manifest.json"):
        new_slug = f"{base_slug}-{suffix}"
        suffix += 1

    seed_ref = body.seed_reference.strip() if body.seed_reference and body.seed_reference.strip() else None
    if body.bible_translation and body.bible_translation.strip():
        translation = body.bible_translation.strip()
    elif source_briefing is not None:
        translation = source_briefing.bible_translation
    else:
        translation = settings.default_bible_translation or preset.default_bible_translation

    recommended = recommend_format(body.raw_idea, seed_ref, preset)
    now = datetime.now(timezone.utc).astimezone()

    max_episode = source_manifest.series.episode_number
    for existing_slug in storage.list_projects():
        existing_manifest = storage.load_manifest(existing_slug)
        if (
            existing_manifest.series.series_id == source_manifest.series.series_id
            or existing_manifest.series.format_type == source_manifest.series.format_type
        ):
            if existing_manifest.series.episode_number > max_episode:
                max_episode = existing_manifest.series.episode_number

    new_manifest = ProjectManifest(
        slug=new_slug,
        title=body.title.strip(),
        created_at=now,
        updated_at=now,
        preset_id=source_manifest.preset_id,
        series=SeriesMetadata(
            series_id=source_manifest.series.series_id,
            format_type=source_manifest.series.format_type,
            episode_number=max_episode + 1,
            batch_id=source_manifest.series.batch_id,
        ),
        gates=ProjectGates(),
        cost_ledger=CostLedger(
            currency=source_manifest.cost_ledger.currency,
            estimated_total=0.0,
            spent_total=0.0,
            cap_usd=source_manifest.cost_ledger.cap_usd,
            items=[],
        ),
    )

    new_briefing = Briefing(
        raw_idea=body.raw_idea.strip(),
        seed_reference=seed_ref,
        bible_translation=translation,
        target_duration_sec=(
            source_briefing.target_duration_sec
            if source_briefing is not None
            else int(round(preset.video.target_duration_sec.ideal))
        ),
        audio_mode=(
            source_briefing.audio_mode
            if source_briefing is not None
            else settings.tts_provider
        ),
        human_seal_mode=(
            source_briefing.human_seal_mode
            if source_briefing is not None
            else HumanSealMode.PAPER_CUTOUT
        ),
        recommended_format=recommended,
        selected_format_type=(
            source_briefing.selected_format_type
            if source_briefing is not None
            else source_manifest.series.format_type
        ),
        optional_reference_layout=(
            source_briefing.optional_reference_layout
            if source_briefing is not None
            else None
        ),
    )

    storage.save_manifest(new_slug, new_manifest)
    storage.save_briefing(new_slug, new_briefing)

    if source_storyboard is not None:
        cloned_storyboard = {
            "fps": int(source_storyboard.get("fps", preset.video.fps)),
            "width": int(source_storyboard.get("width", preset.video.width)),
            "height": int(source_storyboard.get("height", preset.video.height)),
            "music_track": source_storyboard.get("music_track"),
            "music_enabled": bool(source_storyboard.get("music_enabled", True)),
            "captions_enabled": bool(source_storyboard.get("captions_enabled", True)),
            "scene_ids": [],
        }
        atomic_write_text(
            storage.project_dir(new_slug) / "storyboard.json",
            json.dumps(cloned_storyboard, indent=2, ensure_ascii=False) + "\n",
        )

    return build_project_detail(new_slug, settings, storage)
