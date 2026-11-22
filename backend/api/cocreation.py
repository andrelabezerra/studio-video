"""Rotas REST da Macro-Fase 1: Co-criação Guiada (Briefing, Roteiro, Refino e Gate 1)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Body, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from backend.api import (
    build_project_detail,
    ensure_project_exists,
    get_app_settings,
    get_app_storage,
    get_presets_dir,
    load_storyboard_raw,
)
from backend.core.config import load_preset
from backend.models.briefing import Briefing
from backend.models.script import Script
from backend.models.validation import collect_placeholder_errors
from backend.services.cocreation_service import (
    generate_script,
    generate_storyboard_and_scenes,
    recommend_format,
    refine_script,
)

router = APIRouter(prefix="/api/projects/{slug}", tags=["cocreation"])


class RecommendBriefingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    raw_idea: str = Field(min_length=1, max_length=15000)
    seed_reference: str | None = Field(default=None, max_length=120)


class GenerateScriptRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    use_llm: bool = True


class RefineScriptRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    instruction: str = Field(min_length=1, max_length=1000)
    target: Literal["hooks", "segments", "distribution"]
    use_llm: bool = True


@router.post("/briefing/recommend")
def recommend_briefing_format(
    slug: str,
    body: RecommendBriefingRequest,
    request: Request,
) -> dict[str, Any]:
    settings = get_app_settings(request)
    storage = get_app_storage(request)
    ensure_project_exists(storage, slug)

    manifest = storage.load_manifest(slug)
    briefing = storage.load_briefing(slug)
    preset = load_preset(manifest.preset_id, presets_dir=get_presets_dir(settings))

    seed_ref = (
        body.seed_reference.strip()
        if body.seed_reference is not None and body.seed_reference.strip()
        else (None if body.seed_reference is not None else briefing.seed_reference)
    )
    recommended = recommend_format(body.raw_idea, seed_ref, preset)

    updated_briefing = briefing.model_copy(
        update={
            "raw_idea": body.raw_idea.strip(),
            "seed_reference": seed_ref,
            "recommended_format": recommended,
            "selected_format_type": recommended.format_type,
        }
    )
    updated_manifest = manifest.model_copy(
        update={
            "updated_at": datetime.now(timezone.utc).astimezone(),
            "series": manifest.series.model_copy(
                update={
                    "format_type": recommended.format_type,
                    "series_id": recommended.format_type.value,
                }
            ),
        }
    )

    storage.save_briefing(slug, updated_briefing)
    storage.save_manifest(slug, updated_manifest)
    return {
        "recommended_format": recommended.model_dump(mode="json"),
        "briefing": updated_briefing.model_dump(mode="json"),
    }


@router.put("/briefing")
def update_briefing(
    slug: str,
    payload: dict[str, Any],
    request: Request,
) -> dict[str, Any]:
    storage = get_app_storage(request)
    ensure_project_exists(storage, slug)

    manifest = storage.load_manifest(slug)
    existing = storage.load_briefing(slug).model_dump(mode="json")
    merged = {**existing, **payload}

    try:
        updated_briefing = Briefing.model_validate(merged)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors(include_context=False)) from exc

    updated_manifest = manifest.model_copy(
        update={
            "updated_at": datetime.now(timezone.utc).astimezone(),
            "series": manifest.series.model_copy(
                update={
                    "format_type": updated_briefing.selected_format_type,
                    "series_id": updated_briefing.selected_format_type.value,
                }
            ),
        }
    )

    storage.save_briefing(slug, updated_briefing)
    storage.save_manifest(slug, updated_manifest)
    return {
        "briefing": updated_briefing.model_dump(mode="json"),
        "manifest": updated_manifest.model_dump(mode="json"),
    }


@router.post("/script/generate")
def generate_project_script(
    slug: str,
    request: Request,
    body: GenerateScriptRequest | None = Body(default=None),
) -> dict[str, Any]:
    settings = get_app_settings(request)
    storage = get_app_storage(request)
    ensure_project_exists(storage, slug)

    opts = body or GenerateScriptRequest()
    manifest = storage.load_manifest(slug)
    briefing = storage.load_briefing(slug)
    preset = load_preset(manifest.preset_id, presets_dir=get_presets_dir(settings))

    script, mode = generate_script(
        briefing=briefing,
        preset=preset,
        settings=settings,
        use_llm=opts.use_llm,
    )
    storage.save_script(slug, script)

    updated_manifest = manifest.model_copy(
        update={
            "updated_at": datetime.now(timezone.utc).astimezone(),
            "gates": manifest.gates.model_copy(
                update={
                    "briefing_approved": True,
                    "scripture_verified": False,
                    "script_gate_1_approved": False,
                }
            ),
        }
    )
    storage.save_manifest(slug, updated_manifest)

    return {
        "script": script.model_dump(mode="json"),
        "mode": mode,
    }


@router.post("/script/refine")
def refine_project_script(
    slug: str,
    body: RefineScriptRequest,
    request: Request,
) -> dict[str, Any]:
    settings = get_app_settings(request)
    storage = get_app_storage(request)
    ensure_project_exists(storage, slug)

    if not storage.exists(slug, "script.json"):
        raise HTTPException(
            status_code=404,
            detail=f"Roteiro ainda não gerado para o projeto '{slug}'.",
        )

    manifest = storage.load_manifest(slug)
    briefing = storage.load_briefing(slug)
    script = storage.load_script(slug)
    preset = load_preset(manifest.preset_id, presets_dir=get_presets_dir(settings))

    try:
        refined, mode = refine_script(
            script=script,
            briefing=briefing,
            preset=preset,
            target=body.target,
            instruction=body.instruction,
            settings=settings,
            use_llm=body.use_llm,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    storage.save_script(slug, refined)
    updated_manifest = manifest.model_copy(
        update={"updated_at": datetime.now(timezone.utc).astimezone()}
    )
    storage.save_manifest(slug, updated_manifest)

    return {
        "script": refined.model_dump(mode="json"),
        "mode": mode,
    }


@router.put("/script")
def update_project_script(
    slug: str,
    payload: dict[str, Any],
    request: Request,
) -> dict[str, Any]:
    storage = get_app_storage(request)
    ensure_project_exists(storage, slug)

    manifest = storage.load_manifest(slug)
    base: dict[str, Any] = (
        storage.load_script(slug).model_dump(mode="json")
        if storage.exists(slug, "script.json")
        else {}
    )
    merged = {**base, **payload}

    try:
        updated_script = Script.model_validate(merged)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors(include_context=False)) from exc

    storage.save_script(slug, updated_script)
    scripture_ok = bool(updated_script.scripture_refs) and updated_script.all_scripture_verified()
    updated_manifest = manifest.model_copy(
        update={
            "updated_at": datetime.now(timezone.utc).astimezone(),
            "gates": manifest.gates.model_copy(
                update={
                    "scripture_verified": scripture_ok,
                    "script_gate_1_approved": manifest.gates.script_gate_1_approved and scripture_ok,
                }
            ),
        }
    )
    storage.save_manifest(slug, updated_manifest)

    return {
        "script": updated_script.model_dump(mode="json"),
        "manifest": updated_manifest.model_dump(mode="json"),
    }


@router.post("/script/approve")
def approve_script_gate_1(slug: str, request: Request) -> dict[str, Any]:
    """Gate 1 + Checkpoint de Rigor Bíblico -> gera storyboard.json + scenes/*.json."""
    settings = get_app_settings(request)
    storage = get_app_storage(request)
    ensure_project_exists(storage, slug)

    if not storage.exists(slug, "script.json"):
        raise HTTPException(
            status_code=422,
            detail="Gere o roteiro antes de aprovar o Gate 1.",
        )

    manifest = storage.load_manifest(slug)
    briefing = storage.load_briefing(slug)
    script = storage.load_script(slug)
    preset = load_preset(manifest.preset_id, presets_dir=get_presets_dir(settings))

    # Checkpoint de Rigor Bíblico (AGENTS.md Regra 8)
    if not script.scripture_refs:
        raise HTTPException(
            status_code=422,
            detail=(
                "Checkpoint de Rigor Bíblico bloqueado: o roteiro precisa conter ao menos "
                "uma referência em scripture_refs[] validada por humano antes do Gate 1."
            ),
        )

    unverified = [ref.citation for ref in script.scripture_refs if not ref.verified_by_human]
    if unverified:
        raise HTTPException(
            status_code=422,
            detail=(
                "Checkpoint de Rigor Bíblico pendente: marque 'verified_by_human=true' "
                f"após conferir o texto exato de: {', '.join(unverified)}."
            ),
        )

    placeholder_errors: list[str] = []
    for ref in script.scripture_refs:
        placeholder_errors.extend(
            collect_placeholder_errors(
                ref.exact_text,
                field_path=f"scripture_refs[{ref.ref_id}].exact_text",
            )
        )
    for seg in script.narration_segments:
        placeholder_errors.extend(
            collect_placeholder_errors(
                seg.display_text,
                field_path=f"narration_segments[{seg.segment_id}].display_text",
            )
        )
    if placeholder_errors:
        raise HTTPException(
            status_code=422,
            detail=(
                "Checkpoint de Rigor Bíblico bloqueado (placeholder proibido): "
                + "; ".join(placeholder_errors)
            ),
        )

    existing_storyboard = load_storyboard_raw(storage, slug)
    storyboard, scenes = generate_storyboard_and_scenes(
        manifest=manifest,
        briefing=briefing,
        script=script,
        preset=preset,
    )
    if existing_storyboard is not None:
        storyboard = storyboard.model_copy(
            update={
                "fps": int(existing_storyboard.get("fps", storyboard.fps)),
                "width": int(existing_storyboard.get("width", storyboard.width)),
                "height": int(existing_storyboard.get("height", storyboard.height)),
                "music_track": existing_storyboard.get("music_track", storyboard.music_track),
                "music_enabled": bool(
                    existing_storyboard.get("music_enabled", storyboard.music_enabled)
                ),
                "captions_enabled": bool(
                    existing_storyboard.get("captions_enabled", storyboard.captions_enabled)
                ),
            }
        )

    # Remove cenas antigas que não pertencem mais ao novo storyboard
    sdir = storage.scenes_dir(slug)
    if sdir.is_dir():
        valid_names = {f"{sid}.json" for sid in storyboard.scene_ids}
        for existing_file in sdir.glob("*.json"):
            if existing_file.name not in valid_names:
                existing_file.unlink()

    for scene in scenes:
        storage.save_scene(slug, scene)
    storage.save_storyboard(slug, storyboard)

    updated_manifest = manifest.model_copy(
        update={
            "updated_at": datetime.now(timezone.utc).astimezone(),
            "gates": manifest.gates.model_copy(
                update={
                    "briefing_approved": True,
                    "scripture_verified": True,
                    "script_gate_1_approved": True,
                    "audio_aligned": False,
                    "scenes_approved": False,
                    "qa_passed": False,
                }
            ),
        }
    )
    storage.save_manifest(slug, updated_manifest)

    return build_project_detail(slug, settings, storage)
