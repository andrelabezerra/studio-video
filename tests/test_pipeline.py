"""Testes de unidade e integração da Fase 1 (alinhamento, mixagem, QA e projeto piloto)."""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from backend.core.config import WORKSPACE_ROOT, load_preset, load_settings
from backend.core.storage import ProjectStorage
from backend.services.alignment_service import (
    align_audio_to_script,
    normalize_biblical_text,
    resolve_scene_timings,
    tokenize_display_text,
)
from backend.services.audio_mixer_service import (
    ResolvedSfxCue,
    ensure_default_sfx_and_track,
    ensure_pilot_audio,
    mix_audio_single_pass,
)
from backend.services.compositor_service import render_project
from backend.services.qa_service import (
    inspect_video_ffprobe,
    validate_project_timing,
)


def test_normalize_biblical_text_expands_references_and_chunks() -> None:
    text = "Leia Mt 5:3 e também 1Co 13:4-7 com atenção; Jo 3:16 resume o evangelho."
    normalized = normalize_biblical_text(text)

    assert "Mateus, capítulo cinco, versículo três" in normalized
    assert "Primeira Coríntios, capítulo treze, versículos quatro a sete" in normalized
    assert "João, capítulo três, versículo dezesseis" in normalized

    long_sentence = (
        "Quando estudamos a palavra grega makários no contexto histórico do Sermão do Monte "
        "percebemos que Jesus não descreve uma sensação passageira ligada às circunstâncias "
        "do momento, mas uma posição real de favor diante de Deus."
    )
    chunked = normalize_biblical_text(long_sentence, max_chunk_chars=120)
    lines = chunked.splitlines()
    assert len(lines) >= 2
    assert all(len(line) <= 120 for line in lines)


def test_pilot_project_contracts_and_word_id_coverage(tmp_path: Path) -> None:
    storage = ProjectStorage(WORKSPACE_ROOT / "projects")
    manifest = storage.load_manifest("piloto-makarios")
    briefing = storage.load_briefing("piloto-makarios")
    script = storage.load_script("piloto-makarios")
    storyboard = storage.load_storyboard("piloto-makarios")
    scenes = storage.load_all_scenes("piloto-makarios", storyboard=storyboard)
    preset = load_preset(manifest.preset_id)

    assert manifest.slug == "piloto-makarios"
    assert len(script.hooks) == 3
    assert script.all_scripture_verified() is True
    assert len(scenes) == 10
    assert briefing.selected_format_type.value == "perdido_traducao"

    # Confirma que os 3 templates obrigatórios são usados no piloto
    templates_used = {scene.template.value for scene in scenes}
    assert templates_used == {"kinetic_captions", "paper_collage", "bible_quote_card"}

    # Verifica contagem exata de palavras vs word_id das cenas
    all_tokens = [
        tok
        for seg in script.narration_segments
        for tok in tokenize_display_text(seg.display_text)
    ]
    assert scenes[0].timing.start_word_id == "w_0001"
    assert scenes[-1].timing.end_word_id == f"w_{len(all_tokens):04d}"

    # Gera áudio piloto no cache temporário (fora do OneDrive) e valida alinhamento + mixagem
    cache_dir = tmp_path / "cache_piloto"
    narration_wav, audio_mode = ensure_pilot_audio(
        script=script,
        cache_dir=cache_dir,
        target_duration_sec=float(briefing.target_duration_sec),
    )
    assert narration_wav.is_file()

    alignment = align_audio_to_script(
        narration_wav,
        script,
        audio_source=audio_mode,
        engine="deterministic",
    )
    assert len(alignment.words) == len(all_tokens)
    resolved = resolve_scene_timings(scenes, alignment)
    report = validate_project_timing(resolved, alignment, preset)
    assert report.ok, f"Erros de timing: {report.errors}"
    assert report.total_duration_ms == alignment.duration_ms

    # Testa síntese de SFX/trilha no cache e mixagem FFmpeg em passo único
    sfx_map, music_track = ensure_default_sfx_and_track(cache_dir=cache_dir)
    assert music_track.is_file()
    cues = [
        ResolvedSfxCue(
            sfx_id="paper_tear_01",
            path=sfx_map["paper_tear_01"],
            start_ms=resolved[1].timing.resolved_start_ms or 3000,
            gain_db=-6.0,
        )
    ]
    mixed_wav = cache_dir / "audio" / "mixed_test.wav"
    mix_audio_single_pass(
        narration_wav=narration_wav,
        sfx_cues=cues,
        music_track=music_track,
        output_wav=mixed_wav,
        preset=preset,
    )
    assert mixed_wav.is_file()
    assert mixed_wav.stat().st_size > 100_000


def test_end_to_end_preview_render_and_cache_hit(tmp_path: Path) -> None:
    """Executa render preview completo em projetos isolados (tmp_path) e comprova cache hit SHA-256."""
    templates_dir = WORKSPACE_ROOT / "templates_video"
    if not (templates_dir / "stage.html").is_file():
        pytest.skip("templates_video/stage.html ainda não disponível.")

    projects_copy = tmp_path / "projects"
    shutil.copytree(WORKSPACE_ROOT / "projects" / "piloto-makarios", projects_copy / "piloto-makarios")
    cache_root = tmp_path / "studio_cache"

    settings = load_settings(
        workspace_root=WORKSPACE_ROOT,
        env_overrides={"STUDIO_CACHE_DIR": str(cache_root)},
        allow_custom_cache=True,
    )
    storage = ProjectStorage(projects_copy)

    first = render_project(
        slug="piloto-makarios",
        profile="preview",
        settings=settings,
        storage=storage,
        templates_dir=templates_dir,
    )
    assert first.final_mp4.is_file()
    assert first.contact_sheet_jpg.is_file()
    assert len(first.cache_misses) == 10
    assert len(first.cache_hits) == 0

    metrics = inspect_video_ffprobe(first.final_mp4)
    assert metrics["width"] == 540
    assert metrics["height"] == 960
    assert metrics["video_codec"] == "h264"
    assert metrics["pix_fmt"] == "yuv420p"
    assert metrics["audio_codec"] == "aac"
    assert 35.0 <= metrics["duration_sec"] <= 48.0
    assert metrics["av_sync_diff_sec"] < 0.3

    # Segunda execução sem alterações deve atingir 100% cache hit
    second = render_project(
        slug="piloto-makarios",
        profile="preview",
        settings=settings,
        storage=storage,
        templates_dir=templates_dir,
    )
    assert len(second.cache_hits) == 10
    assert len(second.cache_misses) == 0
