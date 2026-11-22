"""Supervisão determinística de QA: validação de timing, ffprobe e contact sheet 9:16 com safe-zones."""

from __future__ import annotations

import io
import json
import math
import os
import subprocess
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

from backend.models.audio import AudioAlignment
from backend.models.preset import StylePreset
from backend.models.scene import Scene
from backend.models.script import Script
from backend.models.validation import (
    collect_placeholder_errors,
    is_forbidden_bureaucratic_stamp,
)


@dataclass
class TimingValidationReport:
    """Relatório estruturado de auditoria de cobertura word_id, ritmo, beats e integridade editorial."""

    ok: bool
    total_duration_ms: int
    scene_durations_ms: dict[str, int] = field(default_factory=dict)
    scene_word_counts: dict[str, int] = field(default_factory=dict)
    pacing_summary: dict[str, Any] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def validate_project_content(
    script: Script | None,
    scenes: list[Scene],
    *,
    require_verified_scripture: bool = True,
) -> list[str]:
    """Audita Fail-Fast contra placeholders ([Conferir...], [TODO], TBD) e selos burocráticos."""
    errors: list[str] = []

    if script is not None:
        for ref in script.scripture_refs:
            errors.extend(
                collect_placeholder_errors(
                    ref.citation,
                    field_path=f"script.scripture_refs[{ref.ref_id}].citation",
                )
            )
            errors.extend(
                collect_placeholder_errors(
                    ref.exact_text,
                    field_path=f"script.scripture_refs[{ref.ref_id}].exact_text",
                )
            )
            if require_verified_scripture and not ref.verified_by_human:
                errors.append(
                    f"script.scripture_refs[{ref.ref_id}] ({ref.citation}): "
                    "referência bíblica ainda não validada por humano (verified_by_human=False)."
                )
        for seg in script.narration_segments:
            errors.extend(
                collect_placeholder_errors(
                    seg.display_text,
                    field_path=f"script.narration_segments[{seg.segment_id}].display_text",
                )
            )
            errors.extend(
                collect_placeholder_errors(
                    seg.tts_text,
                    field_path=f"script.narration_segments[{seg.segment_id}].tts_text",
                )
            )

    for scene in scenes:
        vis = scene.visual
        prefix = f"{scene.scene_id}.visual"
        for fname in ("headline", "subtext", "original_term", "stamp_text", "series_label"):
            val = getattr(vis, fname, None)
            if val:
                errors.extend(collect_placeholder_errors(val, field_path=f"{prefix}.{fname}"))
        if vis.stamp_text and is_forbidden_bureaucratic_stamp(vis.stamp_text):
            errors.append(
                f"{prefix}.stamp_text: selo burocrático proibido '{vis.stamp_text}'. "
                "Remova o selo e utilize composição editorial limpa."
            )
        if vis.motion_data:
            errors.extend(
                collect_placeholder_errors(vis.motion_data, field_path=f"{prefix}.motion_data")
            )
        for beat in vis.beats:
            if beat.headline:
                errors.extend(
                    collect_placeholder_errors(
                        beat.headline,
                        field_path=f"{prefix}.beats[{beat.beat_id}].headline",
                    )
                )
            if beat.subtext:
                errors.extend(
                    collect_placeholder_errors(
                        beat.subtext,
                        field_path=f"{prefix}.beats[{beat.beat_id}].subtext",
                    )
                )

    return errors


def validate_project_timing(
    scenes: list[Scene],
    alignment: AudioAlignment,
    preset: StylePreset,
    *,
    script: Script | None = None,
) -> TimingValidationReport:
    """Verifica cobertura contígua de word_id, beats, ritmo anti-fragmentação e zero placeholders."""
    errors: list[str] = []
    warnings: list[str] = []
    scene_durations: dict[str, int] = {}
    scene_word_counts: dict[str, int] = {}
    micro_scene_ids: list[str] = []
    short_scene_ids: list[str] = []
    beats_total = 0

    if not scenes:
        return TimingValidationReport(
            ok=False,
            total_duration_ms=0,
            errors=["Nenhuma cena fornecida para validação."],
        )

    ordered = sorted(scenes, key=lambda s: s.order)
    errors.extend(validate_project_content(script, ordered, require_verified_scripture=script is not None))

    word_index = {w.word_id: i for i, w in enumerate(alignment.words)}
    expected_word_idx = 0
    prev_end_ms = 0

    for scene in ordered:
        t = scene.timing
        if t.start_word_id not in word_index:
            errors.append(f"{scene.scene_id}: start_word_id '{t.start_word_id}' inexistente.")
            continue
        if t.end_word_id not in word_index:
            errors.append(f"{scene.scene_id}: end_word_id '{t.end_word_id}' inexistente.")
            continue

        start_idx = word_index[t.start_word_id]
        end_idx = word_index[t.end_word_id]
        if start_idx > end_idx:
            errors.append(
                f"{scene.scene_id}: intervalo word_id invertido ({t.start_word_id} > {t.end_word_id})."
            )
            continue
        if start_idx != expected_word_idx:
            errors.append(
                f"{scene.scene_id}: quebra de contiguidade word_id "
                f"(esperado índice {expected_word_idx}, recebido {start_idx} '{t.start_word_id}')."
            )
        expected_word_idx = end_idx + 1
        word_count = end_idx - start_idx + 1
        scene_word_counts[scene.scene_id] = word_count

        # Valida integridade de highlight_word_ids, sfx_cues e beats[]
        for hl_wid in scene.visual.highlight_word_ids:
            if hl_wid not in word_index:
                errors.append(
                    f"{scene.scene_id}: highlight_word_id '{hl_wid}' inexistente no audio_alignment."
                )
        for cue in scene.sfx_cues:
            if cue.anchor_word_id not in word_index:
                errors.append(
                    f"{scene.scene_id}: sfx_cue '{cue.sfx_id}' referencia anchor_word_id '{cue.anchor_word_id}' inexistente."
                )

        prev_beat_pos = -1.0
        for beat in scene.visual.beats:
            beats_total += 1
            beat_pos: float | None = None
            if beat.anchor_word_id is not None:
                if beat.anchor_word_id not in word_index:
                    errors.append(
                        f"{scene.scene_id}: beat '{beat.beat_id}' referencia anchor_word_id "
                        f"'{beat.anchor_word_id}' inexistente no audio_alignment."
                    )
                else:
                    b_idx = word_index[beat.anchor_word_id]
                    if b_idx < start_idx or b_idx > end_idx:
                        errors.append(
                            f"{scene.scene_id}: beat '{beat.beat_id}' anchor_word_id '{beat.anchor_word_id}' "
                            f"está fora do intervalo da cena ({t.start_word_id}..{t.end_word_id})."
                        )
                    else:
                        beat_pos = (b_idx - start_idx) / max(1, word_count)
            elif beat.progress is not None:
                beat_pos = beat.progress

            if beat_pos is not None:
                if beat_pos < prev_beat_pos - 1e-6:
                    warnings.append(
                        f"{scene.scene_id}: beat '{beat.beat_id}' fora de ordem cronológica dentro da cena."
                    )
                prev_beat_pos = max(prev_beat_pos, beat_pos)

        if t.resolved_start_ms is None or t.resolved_end_ms is None:
            errors.append(f"{scene.scene_id}: timings ainda não resolvidos (resolved_*_ms nulos).")
            continue

        dur_ms = t.resolved_end_ms - t.resolved_start_ms
        scene_durations[scene.scene_id] = dur_ms
        if dur_ms <= 0:
            errors.append(f"{scene.scene_id}: duração resolvida inválida ({dur_ms}ms).")
        if t.resolved_start_ms != prev_end_ms:
            errors.append(
                f"{scene.scene_id}: lacuna/sobreposição temporal "
                f"(start={t.resolved_start_ms}ms vs anterior={prev_end_ms}ms)."
            )
        prev_end_ms = t.resolved_end_ms

        dur_sec = dur_ms / 1000.0
        # Bloqueio Fail-Fast contra micro-cenas fragmentadas (ex.: 1–3 palavras / < 1.8s)
        if len(ordered) > 1 and word_count < 4 and dur_sec < 1.8:
            micro_scene_ids.append(scene.scene_id)
            errors.append(
                f"{scene.scene_id}: micro-cena fragmentada ({word_count} palavra(s), {dur_sec:.2f}s). "
                "Agrupe segmentos curtos em blocos narrativos fluidos (~4s–8s)."
            )
        if dur_sec < 2.5:
            short_scene_ids.append(scene.scene_id)

        max_comfortable_sec = (
            preset.video.scene_pacing_sec.max + 2.0
            if len(scene.visual.beats) >= 2
            else preset.video.scene_pacing_sec.max + 1.5
        )
        if dur_sec < preset.video.scene_pacing_sec.min - 0.5:
            warnings.append(
                f"{scene.scene_id}: duração {dur_sec:.2f}s abaixo do ritmo editorial "
                f"({preset.video.scene_pacing_sec.min}s)."
            )
        elif dur_sec > max_comfortable_sec:
            warnings.append(
                f"{scene.scene_id}: duração {dur_sec:.2f}s acima do ritmo editorial "
                f"({preset.video.scene_pacing_sec.max}s)."
            )

        # Alerta de dinamismo para cenas longas sem beats internos
        if dur_sec >= 5.5 and len(scene.visual.beats) == 0:
            warnings.append(
                f"{scene.scene_id}: cena longa ({dur_sec:.2f}s) sem beats[] internos; "
                "adicione 2–3 beats ancorados em word_id para movimento visual contínuo."
            )

    if expected_word_idx != len(alignment.words):
        errors.append(
            f"Cobertura incompleta de palavras: cobertas {expected_word_idx}/{len(alignment.words)}."
        )

    # Guardrail contra excesso de cortes frenéticos (ex.: 27 micro-cenas em 60–85s)
    if len(ordered) >= 6 and scene_durations:
        short_ratio = len(short_scene_ids) / len(ordered)
        if short_ratio > 0.40:
            errors.append(
                f"Excesso de cortes rápidos: {len(short_scene_ids)}/{len(ordered)} cenas "
                f"({short_ratio * 100:.0f}%) têm menos de 2.5s ({', '.join(short_scene_ids[:6])}). "
                "Consolide em blocos narrativos de 4s–8s com multi-beats internos."
            )

    total_ms = prev_end_ms
    total_sec = total_ms / 1000.0
    if total_sec < preset.video.target_duration_sec.min:
        warnings.append(
            f"Duração total ({total_sec:.2f}s) abaixo do mínimo alvo "
            f"({preset.video.target_duration_sec.min}s)."
        )
    elif total_sec > preset.video.target_duration_sec.max:
        warnings.append(
            f"Duração total ({total_sec:.2f}s) acima do máximo alvo "
            f"({preset.video.target_duration_sec.max}s)."
        )

    durations_sec_list = [ms / 1000.0 for ms in scene_durations.values()]
    pacing_summary = {
        "scene_count": len(ordered),
        "avg_scene_duration_sec": (
            round(sum(durations_sec_list) / len(durations_sec_list), 2)
            if durations_sec_list
            else 0.0
        ),
        "min_scene_duration_sec": round(min(durations_sec_list), 2) if durations_sec_list else 0.0,
        "max_scene_duration_sec": round(max(durations_sec_list), 2) if durations_sec_list else 0.0,
        "short_scene_count": len(short_scene_ids),
        "micro_scene_ids": micro_scene_ids,
        "beats_total": beats_total,
    }

    return TimingValidationReport(
        ok=len(errors) == 0,
        total_duration_ms=total_ms,
        scene_durations_ms=scene_durations,
        scene_word_counts=scene_word_counts,
        pacing_summary=pacing_summary,
        errors=errors,
        warnings=warnings,
    )


def _parse_fps(rate_str: str) -> float:
    if "/" in rate_str:
        num, den = rate_str.split("/", 1)
        den_f = float(den)
        return float(num) / den_f if den_f else 0.0
    return float(rate_str)


def inspect_video_ffprobe(mp4_path: Path) -> dict[str, Any]:
    """Inspeciona vídeo final via ffprobe e retorna métricas técnicas de vídeo, áudio e sincronia."""
    if not mp4_path.exists():
        raise FileNotFoundError(f"Arquivo MP4 não encontrado para inspeção: {mp4_path}")

    proc = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(mp4_path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffprobe falhou em '{mp4_path}': {proc.stderr.strip()}")

    data = json.loads(proc.stdout)
    streams = data.get("streams", [])
    fmt = data.get("format", {})

    video_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)
    if video_stream is None:
        raise ValueError(f"Stream de vídeo ausente em '{mp4_path}'.")

    v_dur = float(video_stream.get("duration") or fmt.get("duration") or 0.0)
    a_dur = float(audio_stream.get("duration") or fmt.get("duration") or 0.0) if audio_stream else 0.0
    sync_diff = abs(v_dur - a_dur) if audio_stream else 0.0

    fps_raw = video_stream.get("avg_frame_rate") or video_stream.get("r_frame_rate") or "0/1"
    return {
        "path": str(mp4_path),
        "width": int(video_stream["width"]),
        "height": int(video_stream["height"]),
        "fps": round(_parse_fps(fps_raw), 3),
        "video_codec": video_stream.get("codec_name"),
        "pix_fmt": video_stream.get("pix_fmt"),
        "audio_codec": audio_stream.get("codec_name") if audio_stream else None,
        "sample_rate_hz": int(audio_stream["sample_rate"]) if audio_stream and audio_stream.get("sample_rate") else None,
        "duration_sec": round(float(fmt.get("duration") or v_dur), 3),
        "video_duration_sec": round(v_dur, 3),
        "audio_duration_sec": round(a_dur, 3) if audio_stream else None,
        "av_sync_diff_sec": round(sync_diff, 3),
        "file_size_bytes": mp4_path.stat().st_size,
    }


def _extract_midpoint_frame(mp4_path: Path) -> Image.Image:
    """Extrai o frame representativo do meio do clipe direto para memória via pipe (zero PNG em disco)."""
    info = inspect_video_ffprobe(mp4_path)
    duration_sec = float(info["video_duration_sec"])
    mid_sec = max(0.0, min(duration_sec * 0.5, max(0.0, duration_sec - 0.04))) if duration_sec > 0 else 0.0

    def _grab(seek_sec: float) -> subprocess.CompletedProcess[bytes]:
        return subprocess.run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                f"{seek_sec:.3f}",
                "-i",
                str(mp4_path),
                "-frames:v",
                "1",
                "-f",
                "image2pipe",
                "-vcodec",
                "mjpeg",
                "-q:v",
                "2",
                "pipe:1",
            ],
            capture_output=True,
            check=False,
        )

    proc = _grab(mid_sec)
    if (proc.returncode != 0 or not proc.stdout) and mid_sec > 0.0:
        proc = _grab(0.0)
    if proc.returncode != 0 or not proc.stdout:
        stderr = proc.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"Falha ao extrair frame de '{mp4_path}': {stderr}")
    return Image.open(io.BytesIO(proc.stdout)).convert("RGB")


def ensure_scene_thumbnail(
    scene_mp4: Path,
    thumb_path: Path,
    *,
    width: int = 270,
    height: int = 480,
    force: bool = False,
) -> Path:
    """Garante miniatura JPEG leve 9:16 (frame do meio) em STUDIO_CACHE_DIR/<slug>/thumbs/."""
    if not force and thumb_path.is_file() and thumb_path.stat().st_size > 0:
        return thumb_path
    if not scene_mp4.is_file() or scene_mp4.stat().st_size == 0:
        raise FileNotFoundError(f"Clipe de cena não encontrado para gerar miniatura: '{scene_mp4}'.")

    thumb_path.parent.mkdir(parents=True, exist_ok=True)
    frame = _extract_midpoint_frame(scene_mp4).resize((width, height), Image.Resampling.LANCZOS)
    tmp_path = thumb_path.with_name(f".{thumb_path.name}.{os.getpid()}.{threading.get_ident()}.tmp.jpg")
    try:
        frame.save(tmp_path, format="JPEG", quality=84, optimize=True)
        os.replace(tmp_path, thumb_path)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise
    return thumb_path


def generate_contact_sheet(
    scene_mp4s: list[tuple[str, Path]],
    output_jpg: Path,
    preset: StylePreset,
    *,
    show_safe_zones: bool = True,
    cols: int = 5,
    tile_width: int = 360,
) -> Path:
    """Monta grade visual contact_sheet.jpg com linhas de safe-zones 9:16 para auditoria rápida."""
    if not scene_mp4s:
        raise ValueError("Nenhuma cena fornecida para gerar contact_sheet.jpg.")

    output_jpg.parent.mkdir(parents=True, exist_ok=True)
    tile_height = round(tile_width * (preset.video.height / preset.video.width))
    cols = max(1, min(cols, len(scene_mp4s)))
    rows = math.ceil(len(scene_mp4s) / cols)

    pad = 24
    header_h = 68
    sheet_w = cols * tile_width + (cols + 1) * pad
    sheet_h = header_h + rows * tile_height + (rows + 1) * pad

    sheet = Image.new("RGB", (sheet_w, sheet_h), color=(20, 22, 27))
    sheet_draw = ImageDraw.Draw(sheet)
    header_font: ImageFont.ImageFont | ImageFont.FreeTypeFont
    badge_font: ImageFont.ImageFont | ImageFont.FreeTypeFont
    try:
        header_font = ImageFont.truetype("segoeui.ttf", 26)
        badge_font = ImageFont.truetype("segoeuib.ttf", 16)
    except OSError:
        header_font = ImageFont.load_default()
        badge_font = ImageFont.load_default()
    sheet_draw.text(
        (pad, 20),
        f"Studio Video - Contact Sheet 9:16 | {preset.name} | Safe-Zones: {'ON' if show_safe_zones else 'OFF'}",
        fill=(244, 237, 225),
        font=header_font,
    )

    sx = tile_width / preset.video.width
    sy = tile_height / preset.video.height
    x1_safe = round(preset.safe_zones_px.left * sx)
    y1_safe = round(preset.safe_zones_px.top * sy)
    x2_safe = round((preset.video.width - preset.safe_zones_px.right) * sx)
    y2_safe = round((preset.video.height - preset.safe_zones_px.bottom) * sy)

    for idx, (scene_id, mp4_path) in enumerate(scene_mp4s):
        frame = _extract_midpoint_frame(mp4_path).resize((tile_width, tile_height), Image.Resampling.LANCZOS)
        tile_draw = ImageDraw.Draw(frame)

        if show_safe_zones:
            # Guia de área segura útil (dourado Vox tracejado/contorno limpo)
            tile_draw.rectangle([x1_safe, y1_safe, x2_safe, y2_safe], outline=(229, 169, 60), width=2)
            # Linhas de corte topo/base/direita em terracota
            tile_draw.line([(0, y1_safe), (tile_width, y1_safe)], fill=(158, 59, 46), width=1)
            tile_draw.line([(0, y2_safe), (tile_width, y2_safe)], fill=(158, 59, 46), width=1)
            tile_draw.line([(x2_safe, 0), (x2_safe, tile_height)], fill=(158, 59, 46), width=1)

        # Badge discreto com ID da cena
        tile_draw.rectangle([8, 8, 124, 34], fill=(24, 26, 31))
        tile_draw.text((16, 11), scene_id.upper(), fill=(229, 169, 60), font=badge_font)

        row = idx // cols
        col = idx % cols
        ox = pad + col * (tile_width + pad)
        oy = header_h + pad + row * (tile_height + pad)
        sheet.paste(frame, (ox, oy))

    sheet.save(output_jpg, format="JPEG", quality=92, optimize=True)
    return output_jpg
