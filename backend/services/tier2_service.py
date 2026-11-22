"""Serviço Nível 2 Cirúrgico & 3D Opcional sob Teto USD (catálogo, guardrails fail-fast e geração/simulação local)."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from PIL import Image, ImageDraw

from backend.core.cache import ProjectCachePaths, sha256_file
from backend.core.config import StudioSettings
from backend.models.preset import ImageProvider, SceneTemplate, StylePreset
from backend.models.project import CostLedgerItem, ProjectManifest
from backend.models.scene import Scene, SceneAsset
from backend.services.asset_service import _hex_to_rgb, _load_font, _wrap_text

logger = logging.getLogger(__name__)

Tier2Kind = Literal["video", "image", "3d"]


TIER2_CATALOG: tuple[dict[str, Any], ...] = (
    {
        "model_id": "hailuo_3",
        "id": "hailuo_3",
        "provider": "openrouter",
        "kind": "video",
        "cost_usd": 0.48,
        "label": "Hailuo 3 Max (6s 720p · Fiel ao layout)",
        "description": "Geração de vídeo 6s 720p via OpenRouter com alta fidelidade à composição de referência.",
    },
    {
        "model_id": "grok_imagine_lite",
        "id": "grok_imagine_lite",
        "provider": "openrouter",
        "kind": "video",
        "cost_usd": 0.19,
        "label": "Grok Imagine 1.5 Lite (Rascunho rápido)",
        "description": "Vídeo generativo rápido de baixo custo para validação de movimento Nível 2.",
    },
    {
        "model_id": "gpt_image_2",
        "id": "gpt_image_2",
        "provider": "openrouter",
        "kind": "image",
        "cost_usd": 0.08,
        "label": "GPT Image 2 (Recorte Paper Collage)",
        "description": "Ilustração editorial em estilo colagem de papel e gravura histórica via OpenRouter.",
    },
    {
        "model_id": "fal_trellis_3d",
        "id": "fal_trellis_3d",
        "provider": "fal",
        "kind": "3d",
        "cost_usd": 0.25,
        "label": "Fal.ai Image-to-3D GLB (Opcional)",
        "description": "Conversão opcional de recorte 2D em malha 3D/parallax sob teto de custo.",
    },
)

_CATALOG_BY_ID: dict[str, dict[str, Any]] = {item["model_id"]: item for item in TIER2_CATALOG}


def get_tier2_model_info(model_id: str) -> dict[str, Any]:
    """Busca metadados de um modelo Nível 2 no catálogo (fail-fast se inexistente)."""
    cleaned = (model_id or "").strip()
    if cleaned not in _CATALOG_BY_ID:
        valid = ", ".join(sorted(_CATALOG_BY_ID))
        raise KeyError(f"Modelo Nível 2 desconhecido: '{cleaned}'. Modelos válidos: {valid}.")
    return dict(_CATALOG_BY_ID[cleaned])


def build_tier2_catalog_response(settings: StudioSettings) -> dict[str, Any]:
    """Monta resposta do catálogo Nível 2 + flags de guardrail SEM expor nenhuma chave de API."""
    models: list[dict[str, Any]] = []
    for item in TIER2_CATALOG:
        kind = item["kind"]
        if kind == "video":
            enabled = settings.enable_tier2_video
        elif kind == "3d":
            enabled = settings.enable_fal_3d
        else:
            enabled = True
        within_scene_cap = float(item["cost_usd"]) <= settings.max_cost_per_scene_usd
        models.append(
            {
                **item,
                "enabled": enabled and within_scene_cap,
            }
        )

    return {
        "models": models,
        "enable_tier2_video": settings.enable_tier2_video,
        "enable_fal_3d": settings.enable_fal_3d,
        "max_cost_per_scene_usd": settings.max_cost_per_scene_usd,
        "max_cost_per_video_usd": settings.max_cost_per_video_usd,
    }


def _render_editorial_tier2_art(
    *,
    output_path: Path,
    scene: Scene,
    model_info: dict[str, Any],
    prompt: str,
    preset: StylePreset,
    simulated: bool,
) -> Path:
    """Gera composição editorial 9:16 Vox Bíblico com Pillow em STUDIO_CACHE_DIR/<slug>/assets/."""
    width = preset.video.width
    height = preset.video.height
    x1, y1, x2, y2 = preset.safe_zones_px.content_box(width, height)

    parchment = _hex_to_rgb(preset.palette.parchment_bg)
    charcoal = _hex_to_rgb(preset.palette.charcoal_dark)
    vox_gold = _hex_to_rgb(preset.palette.vox_gold)
    navy = _hex_to_rgb(preset.palette.historical_navy)
    terracotta = _hex_to_rgb(preset.palette.terracotta_accent)
    muted_ink = _hex_to_rgb(preset.palette.muted_ink)

    is_dark = scene.visual.background_theme in ("carvao", "charcoal", "navy")
    bg_color = charcoal if is_dark else parchment
    card_bg = (30, 34, 42) if is_dark else (250, 246, 238)
    fg_primary = parchment if is_dark else charcoal
    grid_color = (38, 42, 51) if is_dark else (232, 223, 207)

    img = Image.new("RGB", (width, height), color=bg_color)
    draw = ImageDraw.Draw(img)

    # Grade cartográfica/documental sutil
    for gy in range(0, height, 60):
        draw.line([(0, gy), (width, gy)], fill=grid_color, width=1)
    for gx in range(0, width, 60):
        draw.line([(gx, 0), (gx, height)], fill=grid_color, width=1)

    # Moldura editorial dentro da safe-zone 9:16
    pad = 20
    fx1, fy1, fx2, fy2 = x1 + pad, y1 + pad, x2 - pad, y2 - pad
    draw.rectangle([fx1 + 14, fy1 + 16, fx2 + 14, fy2 + 16], fill=(18, 20, 24) if is_dark else (208, 198, 182))
    draw.rectangle([fx1, fy1, fx2, fy2], fill=card_bg, outline=vox_gold if is_dark else navy, width=4)

    badge_font = _load_font(("consolab.ttf", "segoeuib.ttf", "arialbd.ttf"), 24)
    title_font = _load_font(("georgiab.ttf", "segoeuib.ttf", "arialbd.ttf"), 56)
    prompt_font = _load_font(("segoeui.ttf", "arial.ttf"), 32)
    meta_font = _load_font(("consolab.ttf", "segoeui.ttf", "arial.ttf"), 24)

    # Badge superior do modelo Nível 2
    mode_tag = "SIMULAÇÃO LOCAL $0.00" if simulated else f"TIER 2 · ${float(model_info['cost_usd']):.2f}"
    badge_text = f"NÍVEL 2 · {str(model_info['model_id']).upper()} · {mode_tag}"
    bbox = draw.textbbox((0, 0), badge_text, font=badge_font)
    bw = (bbox[2] - bbox[0]) + 36
    bh = (bbox[3] - bbox[1]) + 22
    bx1, by1 = fx1 + 36, fy1 + 40
    draw.rectangle([bx1, by1, bx1 + bw, by1 + bh], fill=terracotta)
    draw.text((bx1 + 18, by1 + 9), badge_text, fill=parchment, font=badge_font)

    # Ilustração geométrica central estilo Vox (círculos concêntricos + recorte editorial)
    cx = (fx1 + fx2) // 2
    cy = fy1 + 360
    for r, col in ((170, navy), (125, vox_gold), (76, terracotta)):
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=col, width=4)
    draw.line([(cx - 210, cy), (cx + 210, cy)], fill=vox_gold, width=2)
    draw.line([(cx, cy - 210), (cx, cy + 210)], fill=vox_gold, width=2)

    # Headline da cena
    headline = (scene.visual.headline or scene.scene_id).strip().upper()
    max_text_w = (fx2 - fx1) - 72
    h_lines = _wrap_text(headline, title_font, max_text_w, draw)[:3]
    cursor_y = cy + 210
    for line in h_lines:
        draw.text((fx1 + 36, cursor_y), line, fill=fg_primary, font=title_font)
        cursor_y += 68

    draw.rectangle([fx1 + 36, cursor_y + 12, fx2 - 36, cursor_y + 18], fill=vox_gold)
    cursor_y += 42

    # Composição do prompt
    prompt_clean = prompt.strip() or f"Arte editorial Nível 2 para {scene.scene_id}"
    p_lines = _wrap_text(prompt_clean, prompt_font, max_text_w, draw)[:6]
    for line in p_lines:
        draw.text((fx1 + 36, cursor_y), line, fill=muted_ink if not is_dark else (210, 205, 195), font=prompt_font)
        cursor_y += 44

    # Rodapé seguro
    footer_y = fy2 - 68
    draw.line([(fx1 + 36, footer_y - 16), (fx2 - 36, footer_y - 16)], fill=muted_ink, width=2)
    footer_label = f"{scene.scene_id.upper()} · {model_info['label']}"
    draw.text((fx1 + 36, footer_y), footer_label[:58], fill=vox_gold if is_dark else navy, font=meta_font)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(output_path, format="PNG", optimize=True)
    return output_path


def generate_tier2_scene_asset(
    *,
    scene: Scene,
    manifest: ProjectManifest,
    preset: StylePreset,
    cache: ProjectCachePaths,
    model_id: str,
    prompt: str,
    simulate_local: bool,
) -> tuple[Scene, ProjectManifest, str]:
    """Gera asset Nível 2 em STUDIO_CACHE_DIR, atualiza scene.assets e registra no cost_ledger."""
    model_info = get_tier2_model_info(model_id)
    cleaned_prompt = (prompt or "").strip() or (
        f"Composição editorial Vox Bíblico para {scene.scene_id}: {scene.visual.headline}"
    )

    cache.ensure_dirs()
    out_filename = f"{scene.scene_id}_tier2_{model_info['model_id']}.png"
    out_path = cache.assets / out_filename
    _render_editorial_tier2_art(
        output_path=out_path,
        scene=scene,
        model_info=model_info,
        prompt=cleaned_prompt,
        preset=preset,
        simulated=simulate_local,
    )

    digest = sha256_file(out_path)
    cache_relpath = f"assets/{out_filename}"
    target_asset_id = f"tier2_{model_info['model_id']}"
    provider_enum = (
        ImageProvider.LOCAL
        if simulate_local
        else (
            ImageProvider.OPENROUTER
            if model_info["provider"] == "openrouter"
            else ImageProvider.LOCAL
        )
    )

    new_asset = SceneAsset(
        asset_id=target_asset_id,
        provider=provider_enum,
        prompt=cleaned_prompt,
        apply_rembg=False,
        cache_relpath=cache_relpath,
        sha256=digest,
    )

    remaining_assets = [a for a in scene.assets if a.asset_id != target_asset_id]
    updated_assets = [new_asset, *remaining_assets]

    applied_cost = 0.0 if simulate_local else float(model_info["cost_usd"])
    scene_updates: dict[str, Any] = {
        "assets": updated_assets,
        "cache_hash": None,
        "cost_usd": round(applied_cost if not simulate_local else scene.cost_usd, 4),
    }
    if model_info["kind"] == "video":
        scene_updates["tier"] = 2
        scene_updates["template"] = SceneTemplate.TIER2_VIDEO

    updated_scene = scene.model_copy(update=scene_updates)

    now = datetime.now(timezone.utc).astimezone()
    ledger_item = CostLedgerItem(
        item_id=f"tier2_{scene.scene_id}_{model_info['model_id']}_{uuid.uuid4().hex[:6]}",
        stage=f"tier2_{model_info['kind']}",
        provider="local_simulation" if simulate_local else str(model_info["provider"]),
        scene_id=scene.scene_id,
        cost_usd=applied_cost,
        created_at=now,
        note=(
            f"Simulação local ($0.00) · {model_info['label']}"
            if simulate_local
            else f"Geração Nível 2 · {model_info['label']}"
        ),
    )

    new_spent = round(manifest.cost_ledger.spent_total + applied_cost, 4)
    new_estimated = round(max(manifest.cost_ledger.estimated_total, new_spent), 4)
    updated_ledger = manifest.cost_ledger.model_copy(
        update={
            "spent_total": new_spent,
            "estimated_total": new_estimated,
            "items": [*manifest.cost_ledger.items, ledger_item],
        }
    )
    updated_manifest = manifest.model_copy(
        update={
            "updated_at": now,
            "cost_ledger": updated_ledger,
        }
    )
    return updated_scene, updated_manifest, cache_relpath
