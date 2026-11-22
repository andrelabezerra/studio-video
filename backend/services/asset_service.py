"""Gestão de assets visuais (dropzone Gemini PRO + smart resize + capa 9:16 Vox Bíblico)."""

from __future__ import annotations

import io
import logging
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, UnidentifiedImageError

from backend.core.cache import ProjectCachePaths, sha256_file
from backend.models.preset import ImageProvider, StylePreset
from backend.models.project import ProjectManifest
from backend.models.scene import Scene, SceneAsset
from backend.models.script import Script

logger = logging.getLogger(__name__)

_ALLOWED_IMAGE_FORMATS = frozenset({"PNG", "JPEG", "WEBP"})
_SAFE_ASSET_ID_RE = re.compile(r"[^a-z0-9_-]+")


def _sanitize_asset_id(raw: str | None, fallback: str) -> str:
    if not raw or not raw.strip():
        return fallback
    cleaned = _SAFE_ASSET_ID_RE.sub("_", raw.strip().lower()).strip("_-")
    return cleaned or fallback


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    cleaned = hex_color.strip().lstrip("#")
    if len(cleaned) != 6:
        raise ValueError(f"Cor hexadecimal inválida no preset: '{hex_color}'.")
    return (int(cleaned[0:2], 16), int(cleaned[2:4], 16), int(cleaned[4:6], 16))


def _load_font(candidates: tuple[str, ...], size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for name in candidates:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _wrap_text(
    text: str,
    font: ImageFont.FreeTypeFont | ImageFont.ImageFont,
    max_width: int,
    draw: ImageDraw.ImageDraw,
) -> list[str]:
    words = text.split()
    if not words:
        return []
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        candidate = f"{current} {word}"
        bbox = draw.textbbox((0, 0), candidate, font=font)
        if (bbox[2] - bbox[0]) <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def _try_apply_rembg(img: Image.Image) -> Image.Image:
    """Tenta aplicar remoção de fundo via rembg local; degrada com segurança se não instalado."""
    try:
        from rembg import remove  # type: ignore[import-not-found]
    except ImportError:
        logger.info("rembg não instalado no ambiente; mantendo imagem original sem recorte automático.")
        return img

    buf = io.BytesIO()
    img.convert("RGBA").save(buf, format="PNG")
    removed_bytes = remove(buf.getvalue())
    return Image.open(io.BytesIO(removed_bytes)).convert("RGBA")


def process_uploaded_scene_asset(
    *,
    file_bytes: bytes,
    filename: str,
    scene: Scene,
    cache: ProjectCachePaths,
    asset_id: str | None = None,
    apply_rembg: bool = False,
    max_width: int = 1080,
    max_height: int = 1920,
) -> tuple[Scene, Path, str]:
    """Valida imagem enviada via dropzone, aplica smart resize 9:16 e salva no STUDIO_CACHE_DIR."""
    if not file_bytes:
        raise ValueError("Arquivo de imagem vazio.")

    try:
        with Image.open(io.BytesIO(file_bytes)) as opened:
            fmt = (opened.format or "").upper()
            if fmt not in _ALLOWED_IMAGE_FORMATS:
                raise ValueError(
                    f"Formato de imagem não suportado ('{fmt or filename}'). Use PNG, JPG ou WEBP."
                )
            img = opened.convert("RGBA") if fmt in ("PNG", "WEBP") or apply_rembg else opened.convert("RGB")
    except UnidentifiedImageError as exc:
        raise ValueError(f"Arquivo inválido ou imagem corrompida: '{filename}'.") from exc

    # Smart resize proporcional dentro do limite 1080x1920
    if img.width > max_width or img.height > max_height:
        img.thumbnail((max_width, max_height), Image.Resampling.LANCZOS)

    if apply_rembg:
        img = _try_apply_rembg(img)

    # Resolve qual asset_id atualizar/criar
    target_asset_id: str
    if asset_id and asset_id.strip():
        target_asset_id = _sanitize_asset_id(asset_id, fallback=f"img_{scene.scene_id}")
    elif scene.assets:
        target_asset_id = scene.assets[0].asset_id
    else:
        target_asset_id = f"img_{scene.scene_id}"

    cache.ensure_dirs()
    out_filename = f"{scene.scene_id}_{target_asset_id}.png"
    out_path = cache.assets / out_filename
    img.save(out_path, format="PNG", optimize=True)

    digest = sha256_file(out_path)
    cache_relpath = f"assets/{out_filename}"

    new_assets: list[SceneAsset] = []
    updated_existing = False
    for existing in scene.assets:
        if existing.asset_id == target_asset_id:
            new_assets.append(
                existing.model_copy(
                    update={
                        "cache_relpath": cache_relpath,
                        "sha256": digest,
                        "apply_rembg": apply_rembg,
                    }
                )
            )
            updated_existing = True
        else:
            new_assets.append(existing)

    if not updated_existing:
        new_assets.append(
            SceneAsset(
                asset_id=target_asset_id,
                provider=ImageProvider.GEMINI_HYBRID,
                prompt=f"Asset editorial enviado para {scene.scene_id}",
                apply_rembg=apply_rembg,
                cache_relpath=cache_relpath,
                sha256=digest,
            )
        )

    updated_scene = scene.model_copy(
        update={
            "assets": new_assets,
            "cache_hash": None,
        }
    )
    return updated_scene, out_path, cache_relpath


def generate_cover_png(
    *,
    script: Script,
    manifest: ProjectManifest,
    preset: StylePreset,
    cache: ProjectCachePaths,
) -> Path:
    """Gera capa editorial limpa 1080x1920 PNG no centro seguro respeitando safe-zones do preset."""
    width = preset.video.width
    height = preset.video.height
    x1, y1, x2, y2 = preset.safe_zones_px.content_box(width, height)
    safe_w = x2 - x1
    safe_h = y2 - y1

    parchment = _hex_to_rgb(preset.palette.parchment_bg)
    charcoal = _hex_to_rgb(preset.palette.charcoal_dark)
    vox_gold = _hex_to_rgb(preset.palette.vox_gold)
    navy = _hex_to_rgb(preset.palette.historical_navy)
    terracotta = _hex_to_rgb(preset.palette.terracotta_accent)
    muted_ink = _hex_to_rgb(preset.palette.muted_ink)

    img = Image.new("RGB", (width, height), color=parchment)
    draw = ImageDraw.Draw(img)

    # Textura editorial sutil de papel pautado/grade documental
    grid_color = (232, 223, 207)
    for gy in range(0, height, 64):
        draw.line([(0, gy), (width, gy)], fill=grid_color, width=1)
    for gx in range(0, width, 64):
        draw.line([(gx, 0), (gx, height)], fill=grid_color, width=1)

    # Faixa superior e inferior fora da área nobre para profundidade visual
    draw.rectangle([0, 0, width, 96], fill=charcoal)
    draw.rectangle([0, 96, width, 104], fill=vox_gold)
    draw.rectangle([0, height - 120, width, height], fill=charcoal)

    # Moldura editorial dentro da safe-zone
    frame_pad = 16
    fx1, fy1, fx2, fy2 = x1 + frame_pad, y1 + frame_pad, x2 - frame_pad, y2 - frame_pad
    # Sombra deslocada do cartão principal (paper collage feel)
    draw.rectangle([fx1 + 14, fy1 + 16, fx2 + 14, fy2 + 16], fill=(208, 198, 182))
    draw.rectangle([fx1, fy1, fx2, fy2], fill=(250, 246, 238), outline=navy, width=4)

    # Barra de cabeçalho da série dentro do cartão seguro
    series_spec = preset.get_format_spec(manifest.series.format_type)
    badge_text = f"{series_spec.label.upper()}  ·  EP. {manifest.series.episode_number:02d}"
    badge_font = _load_font(("segoeuib.ttf", "arialbd.ttf", "consolab.ttf"), 28)
    title_font = _load_font(("georgiab.ttf", "segoeuib.ttf", "arialbd.ttf"), 84)
    sub_font = _load_font(("segoeuib.ttf", "arialbd.ttf"), 38)
    handle_font = _load_font(("consolab.ttf", "segoeui.ttf", "arial.ttf"), 28)

    badge_box = draw.textbbox((0, 0), badge_text, font=badge_font)
    badge_w = (badge_box[2] - badge_box[0]) + 44
    badge_h = (badge_box[3] - badge_box[1]) + 26
    bx1 = fx1 + 40
    by1 = fy1 + 48
    draw.rectangle([bx1, by1, bx1 + badge_w, by1 + badge_h], fill=navy)
    draw.text((bx1 + 22, by1 + 11), badge_text, fill=parchment, font=badge_font)

    # Linha divisória dourada
    draw.rectangle([fx1 + 40, by1 + badge_h + 28, fx2 - 40, by1 + badge_h + 34], fill=vox_gold)

    # Headline editorial centralizada na área segura com marca-texto Vox no highlight_word
    cover = script.distribution_pack.cover_spec
    headline_text = cover.headline.strip().upper()
    highlight_upper = (cover.highlight_word or "").strip().upper()
    max_text_w = (fx2 - fx1) - 88
    headline_lines = _wrap_text(headline_text, title_font, max_text_w, draw)
    if len(headline_lines) > 4:
        title_font = _load_font(("georgiab.ttf", "segoeuib.ttf", "arialbd.ttf"), 66)
        headline_lines = _wrap_text(headline_text, title_font, max_text_w, draw)[:5]

    line_height = 104 if len(headline_lines) <= 4 else 82
    block_h = len(headline_lines) * line_height
    cursor_y = fy1 + max(180, (safe_h - block_h) // 2 - 90)

    for line in headline_lines:
        l_box = draw.textbbox((0, 0), line, font=title_font)
        l_w = l_box[2] - l_box[0]
        l_h = l_box[3] - l_box[1]
        tx = fx1 + 44

        if highlight_upper and highlight_upper in line:
            # Pinta marca-texto dourado Vox atrás da linha/palavra destacada
            idx = line.find(highlight_upper)
            prefix = line[:idx]
            prefix_w = draw.textbbox((0, 0), prefix, font=title_font)[2] if prefix else 0
            hl_w = draw.textbbox((0, 0), highlight_upper, font=title_font)[2]
            draw.rectangle(
                [tx + prefix_w - 8, cursor_y + 8, tx + prefix_w + hl_w + 10, cursor_y + l_h + 22],
                fill=vox_gold,
            )

        draw.text((tx, cursor_y), line, fill=charcoal, font=title_font)
        cursor_y += line_height

    # Subheadline em bloco de contraste terracota/carvão
    sub_text = cover.subheadline.strip().upper() or manifest.title.upper()[:42]
    sub_lines = _wrap_text(sub_text, sub_font, max_text_w - 24, draw)[:2]
    sub_y = min(fy2 - 220, cursor_y + 42)
    draw.rectangle([fx1 + 44, sub_y - 16, fx1 + 54, sub_y + len(sub_lines) * 48 + 8], fill=terracotta)
    for idx, sline in enumerate(sub_lines):
        draw.text((fx1 + 74, sub_y + idx * 48), sline, fill=navy, font=sub_font)

    # Rodapé editorial seguro com assinatura discreta do canal
    footer_y = fy2 - 86
    draw.line([(fx1 + 40, footer_y - 20), (fx2 - 40, footer_y - 20)], fill=muted_ink, width=2)
    draw.text((fx1 + 44, footer_y), preset.channel_handle, fill=muted_ink, font=handle_font)
    ref_label = script.scripture_refs[0].citation.upper() if script.scripture_refs else "VOX BÍBLICO"
    ref_box = draw.textbbox((0, 0), ref_label, font=handle_font)
    draw.text((fx2 - 44 - (ref_box[2] - ref_box[0]), footer_y), ref_label, fill=terracotta, font=handle_font)

    cache.ensure_dirs()
    out_path = cache.qa / "cover.png"
    img.save(out_path, format="PNG", optimize=True)
    return out_path
