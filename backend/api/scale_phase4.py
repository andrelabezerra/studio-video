"""Rotas REST da Fase 4: Manifesto de Templates, Fila FIFO, Pins de Revisão, Nível 2 Cirúrgico e Métricas 48h."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from backend.api import (
    ensure_project_exists,
    get_app_settings,
    get_app_sse_hub,
    get_app_storage,
    get_presets_dir,
)
from backend.core.cache import get_project_cache
from backend.core.config import load_preset
from backend.models.preset import FormatType, SceneStatus
from backend.models.project import Metrics48h
from backend.models.scene import ReviewPin
from backend.services.queue_service import ExecutionQueueManager, QueueAction, QueueProfile
from backend.services.tier2_service import (
    build_tier2_catalog_response,
    generate_tier2_scene_asset,
    get_tier2_model_info,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["scale_phase4"])

_FALLBACK_TEMPLATES: tuple[dict[str, Any], ...] = (
    {
        "id": "paper_collage",
        "label": "Paper Collage Editorial",
        "tier": 1,
        "default_cost_usd": 0.0,
        "description": "Recorte paper collage com textura de pergaminho, selo editorial e destaque palavra-por-palavra.",
        "recommended_formats": ["perdido_traducao", "mito_vs_texto", "mapa_contexto"],
        "editable_fields": [
            {"key": "headline", "label": "Headline Principal", "type": "text", "placeholder": "MAKÁRIOS"},
            {"key": "subtext", "label": "Subtexto / Contexto", "type": "text", "placeholder": "Grego · Mateus 5"},
            {"key": "original_term", "label": "Termo Original / Destaque", "type": "text", "placeholder": "μακάριος"},
            {"key": "stamp_text", "label": "Carimbo Editorial", "type": "text", "placeholder": "TEXTO ORIGINAL"},
        ],
    },
    {
        "id": "bible_quote_card",
        "label": "Cartão de Citação Bíblica",
        "tier": 1,
        "default_cost_usd": 0.0,
        "description": "Cartão documental de versículo com referência canônica, tradução e marca-texto sincronizado.",
        "recommended_formats": ["perdido_traducao", "mito_vs_texto", "conexao_at_nt", "mapa_contexto"],
        "editable_fields": [
            {"key": "headline", "label": "Referência / Destaque", "type": "text", "placeholder": "MATEUS 5:3 (NVI)"},
            {"key": "subtext", "label": "Nota Exegética", "type": "text", "placeholder": "Sermão do Monte"},
            {"key": "original_term", "label": "Termo Chave", "type": "text", "placeholder": "Bem-aventurados"},
            {"key": "stamp_text", "label": "Selo de Tradução", "type": "text", "placeholder": "NVI VERIFICADA"},
        ],
    },
    {
        "id": "kinetic_captions",
        "label": "Tipografia Cinética Vox",
        "tier": 1,
        "default_cost_usd": 0.0,
        "description": "Blocos tipográficos de alto impacto (≤6 palavras) com carimbo terracota e contraste editorial.",
        "recommended_formats": ["perdido_traducao", "mito_vs_texto"],
        "editable_fields": [
            {"key": "headline", "label": "Frase de Impacto", "type": "text", "placeholder": "NÃO É SÓ FELICIDADE"},
            {"key": "subtext", "label": "Complemento", "type": "text", "placeholder": "Sentido Original"},
            {"key": "original_term", "label": "Termo em Evidência", "type": "text", "placeholder": "MAKÁRIOS"},
            {"key": "stamp_text", "label": "Carimbo de Contraste", "type": "text", "placeholder": "MITO VS. TEXTO"},
        ],
    },
    {
        "id": "timeline_map",
        "label": "Mapa & Linha do Tempo SVG",
        "tier": 1,
        "default_cost_usd": 0.0,
        "description": "Cartografia histórica com rota SVG animada (stroke-dashoffset) e linha do tempo AT -> NT.",
        "recommended_formats": ["mapa_contexto", "conexao_at_nt"],
        "editable_fields": [
            {"key": "headline", "label": "Título / Marco Principal", "type": "text", "placeholder": "ROTA: GALILEIA → JERUSALÉM"},
            {"key": "subtext", "label": "Coordenadas / Contexto", "type": "text", "placeholder": "120 km · Contexto Histórico"},
            {"key": "original_term", "label": "Origem → Destino (ou Época AT → NT)", "type": "text", "placeholder": "Cafarnaum → Jerusalém"},
            {"key": "stamp_text", "label": "Selo Cartográfico / Carimbo", "type": "text", "placeholder": "ROTA HISTÓRICA"},
        ],
    },
    {
        "id": "tier2_video",
        "label": "Vídeo Generativo Nível 2 (Cirúrgico)",
        "tier": 2,
        "default_cost_usd": 0.19,
        "description": "Cena generativa Nível 2 (OpenRouter Vídeo / Fal.ai 3D ou simulação local $0) com moldura Vox.",
        "recommended_formats": ["mapa_contexto", "conexao_at_nt", "perdido_traducao", "mito_vs_texto"],
        "editable_fields": [
            {"key": "headline", "label": "Legenda Editorial", "type": "text", "placeholder": "JERUSALÉM DO SÉCULO I"},
            {"key": "subtext", "label": "Crédito / Contexto Visual", "type": "text", "placeholder": "Reconstrução Histórica"},
            {"key": "original_term", "label": "Referência Visual", "type": "text", "placeholder": "Templo · Galileia"},
            {"key": "stamp_text", "label": "Selo Nível 2", "type": "text", "placeholder": "NÍVEL 2"},
        ],
    },
)


def _get_queue_manager(request: Request) -> ExecutionQueueManager:
    manager: ExecutionQueueManager | None = getattr(request.app.state, "queue_manager", None)
    if manager is None:
        manager = ExecutionQueueManager(
            settings=get_app_settings(request),
            storage=get_app_storage(request),
            sse_hub=get_app_sse_hub(request),
        )
        request.app.state.queue_manager = manager
    return manager


class EnqueueRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    slug: str = Field(min_length=1)
    action: QueueAction = "run_pending"
    profile: QueueProfile = "preview"


class CreatePinRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x_pct: float = Field(ge=0.0, le=100.0)
    y_pct: float = Field(ge=0.0, le=100.0)
    time_ms: int = Field(ge=0)
    note: str = Field(min_length=1)


class PatchPinRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    resolved: bool | None = None
    note: str | None = None


class Tier2GenerateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model_id: str = Field(min_length=1)
    prompt: str = Field(default="")
    simulate_local: bool = False


class UpdateMetricsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    published_at: datetime | str | None = None
    viewed_vs_swiped_pct: float | None = Field(default=None, ge=0.0, le=100.0)
    avg_retention_pct: float | None = Field(default=None, ge=0.0, le=500.0)
    comments_count: int | None = Field(default=None, ge=0)


# ---------------------------------------------------------------------------
# 1. Manifesto de Templates Plugáveis
# ---------------------------------------------------------------------------
@router.get("/api/templates")
def get_templates_manifest(request: Request) -> dict[str, Any]:
    settings = get_app_settings(request)
    registry_path = settings.workspace_root / "templates_video" / "template_registry.json"
    fallback_by_id = {item["id"]: dict(item) for item in _FALLBACK_TEMPLATES}

    if registry_path.is_file():
        try:
            raw = json.loads(registry_path.read_text(encoding="utf-8"))
            raw_list = raw.get("templates") if isinstance(raw, dict) else None
            if isinstance(raw_list, list) and len(raw_list) > 0:
                merged_templates: list[dict[str, Any]] = []
                seen_ids: set[str] = set()
                for entry in raw_list:
                    if not isinstance(entry, dict) or not entry.get("id"):
                        continue
                    tid = str(entry["id"])
                    base = dict(fallback_by_id.get(tid, {}))
                    base.update(entry)
                    merged_templates.append(base)
                    seen_ids.add(tid)
                for tid, fb in fallback_by_id.items():
                    if tid not in seen_ids:
                        merged_templates.append(fb)
                return {"templates": merged_templates}
        except (OSError, ValueError) as exc:
            logger.warning("Fallback para _FALLBACK_TEMPLATES (erro ao ler template_registry.json: %s)", exc)

    return {"templates": [dict(item) for item in _FALLBACK_TEMPLATES]}


# ---------------------------------------------------------------------------
# 2. Fila de Execução & Histórico (1 vídeo por padrão, lote sob demanda)
# ---------------------------------------------------------------------------
@router.get("/api/queue")
def get_execution_queue(request: Request) -> dict[str, Any]:
    manager = _get_queue_manager(request)
    return manager.snapshot()


@router.post("/api/queue/enqueue")
def enqueue_project_job(
    body: EnqueueRequest,
    request: Request,
) -> dict[str, Any]:
    storage = get_app_storage(request)
    ensure_project_exists(storage, body.slug)
    manifest = storage.load_manifest(body.slug)

    manager = _get_queue_manager(request)
    job_dict, queue_len = manager.enqueue(
        slug=body.slug,
        title=manifest.title,
        action=body.action,
        profile=body.profile,
    )
    return {
        "job": job_dict,
        "queue_length": queue_len,
    }


@router.post("/api/queue/{job_id}/cancel")
def cancel_queue_job(job_id: str, request: Request) -> dict[str, Any]:
    manager = _get_queue_manager(request)
    job_dict = manager.cancel(job_id)
    if job_dict is None:
        raise HTTPException(status_code=404, detail=f"Job não encontrado na fila: '{job_id}'.")
    return {"job": job_dict}


@router.post("/api/queue/clear-history")
def clear_queue_history(request: Request) -> dict[str, Any]:
    manager = _get_queue_manager(request)
    remaining = manager.clear_history()
    return {
        "active_job_id": manager.snapshot()["active_job_id"],
        "jobs": remaining,
    }


# ---------------------------------------------------------------------------
# 3. Pins de Revisão (x_pct, y_pct, time_ms) por Cena
# ---------------------------------------------------------------------------
def _next_pin_id(existing_pins: list[ReviewPin]) -> str:
    existing_ids = {p.pin_id for p in existing_pins}
    max_num = 0
    for pin in existing_pins:
        if pin.pin_id.startswith("pin_"):
            suffix = pin.pin_id.removeprefix("pin_")
            if suffix.isdigit():
                max_num = max(max_num, int(suffix))
    candidate_num = max_num + 1
    while f"pin_{candidate_num:02d}" in existing_ids:
        candidate_num += 1
    return f"pin_{candidate_num:02d}"


@router.post("/api/projects/{slug}/scenes/{scene_id}/pins")
def add_scene_review_pin(
    slug: str,
    scene_id: str,
    body: CreatePinRequest,
    request: Request,
) -> dict[str, Any]:
    storage = get_app_storage(request)
    ensure_project_exists(storage, slug)

    try:
        scene = storage.load_scene(slug, scene_id)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=f"Cena não encontrada: '{scene_id}'.") from exc

    note_clean = body.note.strip()
    if not note_clean:
        raise HTTPException(status_code=422, detail="A nota do pin de revisão não pode ser vazia.")

    pin = ReviewPin(
        pin_id=_next_pin_id(scene.review_pins),
        x_pct=body.x_pct,
        y_pct=body.y_pct,
        time_ms=body.time_ms,
        note=note_clean,
        resolved=False,
    )

    new_status = (
        SceneStatus.NEEDS_REVISION
        if scene.status == SceneStatus.APPROVED
        else scene.status
    )
    # Nota: review_pins e status estão em _VOLATILE_SCENE_FIELDS -> cache_hash é preservado!
    updated_scene = scene.model_copy(
        update={
            "review_pins": [*scene.review_pins, pin],
            "status": new_status,
        }
    )
    storage.save_scene(slug, updated_scene)

    if scene.status == SceneStatus.APPROVED and new_status == SceneStatus.NEEDS_REVISION:
        manifest = storage.load_manifest(slug)
        if manifest.gates.scenes_approved:
            storage.save_manifest(
                slug,
                manifest.model_copy(
                    update={
                        "updated_at": datetime.now(timezone.utc).astimezone(),
                        "gates": manifest.gates.model_copy(update={"scenes_approved": False}),
                    }
                ),
            )

    return {
        "scene": updated_scene.model_dump(mode="json"),
        "pin": pin.model_dump(mode="json"),
    }


@router.patch("/api/projects/{slug}/scenes/{scene_id}/pins/{pin_id}")
def update_scene_review_pin(
    slug: str,
    scene_id: str,
    pin_id: str,
    body: PatchPinRequest,
    request: Request,
) -> dict[str, Any]:
    storage = get_app_storage(request)
    ensure_project_exists(storage, slug)

    try:
        scene = storage.load_scene(slug, scene_id)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=f"Cena não encontrada: '{scene_id}'.") from exc

    updated_pin: ReviewPin | None = None
    new_pins: list[ReviewPin] = []
    for existing in scene.review_pins:
        if existing.pin_id == pin_id:
            patch_data: dict[str, Any] = {}
            if body.resolved is not None:
                patch_data["resolved"] = body.resolved
            if body.note is not None:
                cleaned = body.note.strip()
                if not cleaned:
                    raise HTTPException(status_code=422, detail="A nota do pin não pode ser vazia.")
                patch_data["note"] = cleaned
            updated_pin = existing.model_copy(update=patch_data)
            new_pins.append(updated_pin)
        else:
            new_pins.append(existing)

    if updated_pin is None:
        raise HTTPException(status_code=404, detail=f"Pin de revisão não encontrado: '{pin_id}'.")

    updated_scene = scene.model_copy(update={"review_pins": new_pins})
    storage.save_scene(slug, updated_scene)

    return {
        "scene": updated_scene.model_dump(mode="json"),
        "pin": updated_pin.model_dump(mode="json"),
    }


@router.delete("/api/projects/{slug}/scenes/{scene_id}/pins/{pin_id}")
def delete_scene_review_pin(
    slug: str,
    scene_id: str,
    pin_id: str,
    request: Request,
) -> dict[str, Any]:
    storage = get_app_storage(request)
    ensure_project_exists(storage, slug)

    try:
        scene = storage.load_scene(slug, scene_id)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=f"Cena não encontrada: '{scene_id}'.") from exc

    remaining = [p for p in scene.review_pins if p.pin_id != pin_id]
    if len(remaining) == len(scene.review_pins):
        raise HTTPException(status_code=404, detail=f"Pin de revisão não encontrado: '{pin_id}'.")

    updated_scene = scene.model_copy(update={"review_pins": remaining})
    storage.save_scene(slug, updated_scene)

    return {
        "scene": updated_scene.model_dump(mode="json"),
        "deleted_pin_id": pin_id,
    }


# ---------------------------------------------------------------------------
# 4. Nível 2 Cirúrgico & 3D Opcional sob Teto USD
# ---------------------------------------------------------------------------
@router.get("/api/tier2/catalog")
def get_tier2_catalog(request: Request) -> dict[str, Any]:
    settings = get_app_settings(request)
    return build_tier2_catalog_response(settings)


@router.post("/api/projects/{slug}/scenes/{scene_id}/tier2-generate")
def generate_scene_tier2(
    slug: str,
    scene_id: str,
    body: Tier2GenerateRequest,
    request: Request,
) -> dict[str, Any]:
    settings = get_app_settings(request)
    storage = get_app_storage(request)
    ensure_project_exists(storage, slug)

    try:
        scene = storage.load_scene(slug, scene_id)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=f"Cena não encontrada: '{scene_id}'.") from exc

    try:
        model_info = get_tier2_model_info(body.model_id)
    except KeyError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    manifest = storage.load_manifest(slug)
    model_cost = float(model_info["cost_usd"])
    kind = str(model_info["kind"])

    if not body.simulate_local:
        if (
            model_cost > settings.max_cost_per_scene_usd
            or (manifest.cost_ledger.spent_total + model_cost) > manifest.cost_ledger.cap_usd
        ):
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Custo excede o teto configurado: modelo=${model_cost:.2f}, "
                    f"gasto_atual=${manifest.cost_ledger.spent_total:.2f}, "
                    f"teto_cena=${settings.max_cost_per_scene_usd:.2f}, "
                    f"cap_usd=${manifest.cost_ledger.cap_usd:.2f}."
                ),
            )
        if kind == "video" and not settings.enable_tier2_video:
            raise HTTPException(
                status_code=403,
                detail=(
                    "ENABLE_TIER2_VIDEO=false no .env. Use simulate_local=true ($0.00) "
                    "ou habilite ENABLE_TIER2_VIDEO=true para geração paga."
                ),
            )
        if kind == "3d" and not settings.enable_fal_3d:
            raise HTTPException(
                status_code=403,
                detail=(
                    "ENABLE_FAL_3D=false no .env. Use simulate_local=true ($0.00) "
                    "ou habilite ENABLE_FAL_3D=true para geração 3D paga."
                ),
            )

    preset = load_preset(manifest.preset_id, presets_dir=get_presets_dir(settings))
    cache = get_project_cache(slug, cache_root=settings.studio_cache_dir, ensure=True)

    updated_scene, updated_manifest, cache_relpath = generate_tier2_scene_asset(
        scene=scene,
        manifest=manifest,
        preset=preset,
        cache=cache,
        model_id=body.model_id,
        prompt=body.prompt,
        simulate_local=body.simulate_local,
    )
    storage.save_scene(slug, updated_scene)
    storage.save_manifest(slug, updated_manifest)

    return {
        "scene": updated_scene.model_dump(mode="json"),
        "cost_ledger": updated_manifest.cost_ledger.model_dump(mode="json"),
        "asset_url": f"/api/projects/{slug}/media/{cache_relpath}",
        "simulated": bool(body.simulate_local),
    }


# ---------------------------------------------------------------------------
# 5. Loop de Métricas Pós-Publicação 48h & Resumo por Formato-Série
# ---------------------------------------------------------------------------
@router.put("/api/projects/{slug}/metrics")
def update_project_metrics_48h(
    slug: str,
     request: Request,
    body: UpdateMetricsRequest = Body(...),
) -> dict[str, Any]:
    storage = get_app_storage(request)
    ensure_project_exists(storage, slug)

    manifest = storage.load_manifest(slug)
    current = manifest.metrics_48h.model_dump(mode="json")
    provided = body.model_dump(exclude_unset=True)

    for key, val in provided.items():
        current[key] = val

    has_any_metric = any(
        current.get(k) is not None
        for k in ("viewed_vs_swiped_pct", "avg_retention_pct", "comments_count")
    )
    if current.get("published_at") is None and has_any_metric:
        current["published_at"] = datetime.now(timezone.utc).astimezone().isoformat()

    try:
        validated_metrics = Metrics48h.model_validate(current)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc

    updated_manifest = manifest.model_copy(
        update={
            "updated_at": datetime.now(timezone.utc).astimezone(),
            "metrics_48h": validated_metrics,
        }
    )
    storage.save_manifest(slug, updated_manifest)

    return {
        "manifest": updated_manifest.model_dump(mode="json"),
        "metrics_48h": validated_metrics.model_dump(mode="json"),
    }


@router.get("/api/analytics/series-summary")
def get_series_analytics_summary(request: Request) -> dict[str, Any]:
    settings = get_app_settings(request)
    storage = get_app_storage(request)
    preset = load_preset(settings.default_preset, presets_dir=get_presets_dir(settings))

    format_order: tuple[FormatType, ...] = (
        FormatType.MAPA_CONTEXTO,
        FormatType.PERDIDO_TRADUCAO,
        FormatType.MITO_VS_TEXTO,
        FormatType.CONEXAO_AT_NT,
    )

    buckets: dict[str, dict[str, Any]] = {}
    for fmt in format_order:
        spec = preset.get_format_spec(fmt)
        buckets[fmt.value] = {
            "format_type": fmt.value,
            "label": spec.label,
            "total_episodes": 0,
            "published_episodes": 0,
            "_swiped_vals": [],
            "_retention_vals": [],
            "total_comments": 0,
        }

    for slug in storage.list_projects():
        try:
            manifest = storage.load_manifest(slug)
        except (FileNotFoundError, ValidationError, ValueError):
            continue
        fmt_key = manifest.series.format_type.value
        if fmt_key not in buckets:
            continue
        bucket = buckets[fmt_key]
        bucket["total_episodes"] += 1

        m = manifest.metrics_48h
        is_published = (
            m.published_at is not None
            or m.viewed_vs_swiped_pct is not None
            or m.avg_retention_pct is not None
            or m.comments_count is not None
        )
        if is_published:
            bucket["published_episodes"] += 1
        if m.viewed_vs_swiped_pct is not None:
            bucket["_swiped_vals"].append(float(m.viewed_vs_swiped_pct))
        if m.avg_retention_pct is not None:
            bucket["_retention_vals"].append(float(m.avg_retention_pct))
        if m.comments_count is not None:
            bucket["total_comments"] += int(m.comments_count)

    series_list: list[dict[str, Any]] = []
    best_format: str | None = None
    best_label: str | None = None
    best_score: float = -1.0

    for fmt in format_order:
        b = buckets[fmt.value]
        swiped_vals: list[float] = b.pop("_swiped_vals")
        ret_vals: list[float] = b.pop("_retention_vals")

        avg_swiped = round(sum(swiped_vals) / len(swiped_vals), 1) if swiped_vals else None
        avg_ret = round(sum(ret_vals) / len(ret_vals), 1) if ret_vals else None

        item = {
            "format_type": b["format_type"],
            "label": b["label"],
            "total_episodes": b["total_episodes"],
            "published_episodes": b["published_episodes"],
            "avg_viewed_vs_swiped_pct": avg_swiped,
            "avg_retention_pct": avg_ret,
            "total_comments": b["total_comments"],
        }
        series_list.append(item)

        if avg_swiped is not None or avg_ret is not None:
            score = (
                (avg_swiped or 0.0) * 0.55
                + (avg_ret or 0.0) * 0.45
                + min(b["total_comments"], 200) * 0.05
            )
            if score > best_score:
                best_score = score
                best_format = b["format_type"]
                best_label = b["label"]

    if best_format is None:
        most_eps = max(series_list, key=lambda x: x["total_episodes"], default=None)
        if most_eps and most_eps["total_episodes"] > 0:
            best_format = most_eps["format_type"]
            best_label = most_eps["label"]
            recommendation_note = (
                f"Série mais produzida até agora: {best_label} ({most_eps['total_episodes']} episódio(s)). "
                "Registre as métricas de 48h após publicar para calibrar o próximo lote de @pastorandrebezerra."
            )
        else:
            recommendation_note = (
                "Nenhuma métrica 48h registrada ainda. Publique o episódio piloto e preencha Viewed vs. Swiped e Retenção."
            )
    else:
        winner = next(s for s in series_list if s["format_type"] == best_format)
        sw_txt = (
            f"{winner['avg_viewed_vs_swiped_pct']:.1f}% Viewed vs. Swiped"
            if winner["avg_viewed_vs_swiped_pct"] is not None
            else "sem taxa de swipe"
        )
        ret_txt = (
            f"{winner['avg_retention_pct']:.1f}% retenção média"
            if winner["avg_retention_pct"] is not None
            else "sem retenção"
        )
        recommendation_note = (
            f"Série campeã em 48h: {best_label} ({sw_txt} · {ret_txt} · {winner['total_comments']} comentários). "
            "Recomendação para @pastorandrebezerra: usar 'Novo Episódio deste Estilo' para priorizar esta série no próximo vídeo."
        )

    return {
        "series": series_list,
        "top_performing_format": best_format,
        "recommendation_note": recommendation_note,
    }
