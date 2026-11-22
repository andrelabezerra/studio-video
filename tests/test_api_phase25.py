"""Testes completos da Fase 2.5: miniaturas reais, detecção reativa stale, run-pending e clone-workflow."""

from __future__ import annotations

import asyncio
import io
import json
import os
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.api import production as production_api
from backend.core.cache import get_project_cache, sha256_file
from backend.core.config import WORKSPACE_ROOT, load_preset, load_settings
from backend.core.storage import ProjectStorage
from backend.models.preset import SceneStatus
from backend.server import create_app
from backend.services.alignment_service import align_audio_to_script, resolve_scene_timings
from backend.services.audio_mixer_service import ensure_pilot_audio
from backend.services.compositor_service import compute_expected_scene_hash
from backend.services.qa_service import ensure_scene_thumbnail


def _make_dummy_scene_mp4(
    output_mp4: Path,
    *,
    width: int = 540,
    height: int = 960,
    fps: int = 15,
    duration_sec: float = 0.6,
    color: str = "0x1E3A5F",
) -> Path:
    """Gera um clipe H.264 9:16 mínimo via FFmpeg lavfi para testes determinísticos rápidos."""
    output_mp4.parent.mkdir(parents=True, exist_ok=True)
    proc = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            f"color=c={color}:s={width}x{height}:r={fps}:d={duration_sec:.2f}",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            "-an",
            str(output_mp4),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"FFmpeg falhou ao gerar clipe dummy: {proc.stderr.strip()}")
    return output_mp4


def _seed_clean_piloto_cache(
    projects_dir: Path,
    cache_dir: Path,
    *,
    profile: str = "preview",
) -> tuple[str, list[str]]:
    """Prepara piloto-makarios em tmp_path com áudio, clipes válidos e vídeo final em cache (estado limpo)."""
    slug = "piloto-makarios"
    storage = ProjectStorage(projects_dir)
    cache = get_project_cache(slug, cache_root=cache_dir, ensure=True)
    manifest = storage.load_manifest(slug)
    briefing = storage.load_briefing(slug)
    script = storage.load_script(slug)
    storyboard = storage.load_storyboard(slug)
    preset = load_preset(manifest.preset_id, presets_dir=WORKSPACE_ROOT / "config" / "style_presets")

    narration_wav, audio_mode = ensure_pilot_audio(
        script=script,
        cache_dir=cache.root,
        input_audio_path=None,
        target_duration_sec=float(briefing.target_duration_sec),
    )
    alignment = align_audio_to_script(
        narration_wav,
        script,
        audio_source=audio_mode,
        audio_cache_relpath="audio/narration_master.wav",
        engine="deterministic",
    )
    storage.save_audio_alignment(slug, alignment)

    raw_scenes = storage.load_all_scenes(slug, storyboard=storyboard)
    resolved_scenes = resolve_scene_timings(raw_scenes, alignment)

    w = preset.video.preview_width if profile == "preview" else preset.video.width
    h = preset.video.preview_height if profile == "preview" else preset.video.height
    fps = preset.video.preview_fps if profile == "preview" else preset.video.fps

    # Cria 1 clipe base rápido e copia para todas as cenas com os hashes esperados exatos
    base_clip = cache.root / "_base_dummy.mp4"
    _make_dummy_scene_mp4(base_clip, width=w, height=h, fps=fps, duration_sec=0.5)

    scene_ids: list[str] = []
    for scene in resolved_scenes:
        expected = compute_expected_scene_hash(
            scene=scene,
            alignment=alignment,
            script=script,
            preset=preset,
            cache=cache,
            profile=profile,
            templates_dir=WORKSPACE_ROOT / "templates_video",
        )
        clip_path = cache.scene_video_path(scene.scene_id, profile=profile, cache_hash=expected)
        shutil.copy2(base_clip, clip_path)
        updated = scene.model_copy(
            update={"cache_hash": expected, "status": SceneStatus.RENDERED}
        )
        storage.save_scene(slug, updated)
        scene_ids.append(scene.scene_id)

    # Cria vídeo final de preview com mtime >= mtime dos clipes de cena
    render_mp4 = cache.final_video_path(profile=profile)
    shutil.copy2(base_clip, render_mp4)
    future_mtime = max(
        p.stat().st_mtime for p in cache.scenes.glob("*.mp4")
    ) + 2.0
    os.utime(render_mp4, (future_mtime, future_mtime))
    base_clip.unlink(missing_ok=True)

    storage.save_manifest(
        slug,
        manifest.model_copy(
            update={"gates": manifest.gates.model_copy(update={"audio_aligned": True})}
        ),
    )
    return slug, scene_ids


@pytest.fixture()
def phase25_client(tmp_path: Path) -> tuple[TestClient, Path, Path]:
    projects_dir = tmp_path / "projects"
    shutil.copytree(
        WORKSPACE_ROOT / "projects" / "piloto-makarios",
        projects_dir / "piloto-makarios",
    )
    cache_dir = tmp_path / "studio_cache"

    settings = load_settings(
        workspace_root=WORKSPACE_ROOT,
        env_overrides={
            "STUDIO_CACHE_DIR": str(cache_dir),
            "ENABLE_TIER2_VIDEO": "false",
            "MAX_COST_PER_SCENE_USD": "0.50",
            "MAX_COST_PER_VIDEO_USD": "2.50",
        },
        allow_custom_cache=True,
    )
    storage = ProjectStorage(projects_dir)
    app = create_app(settings=settings, storage=storage)
    with TestClient(app) as client:
        yield client, projects_dir, cache_dir


def test_cache_thumbs_and_idempotent_thumbnail_generation(tmp_path: Path) -> None:
    cache = get_project_cache("demo-thumbs", cache_root=tmp_path, ensure=True)
    assert cache.thumbs.is_dir()
    assert cache.scene_thumb_path("scene_01").name == "scene_01.jpg"
    assert (
        cache.scene_thumb_path("scene_01", "abcdef1234567890").name
        == "scene_01_abcdef123456.jpg"
    )

    clip = _make_dummy_scene_mp4(cache.scenes / "scene_01_preview.mp4")
    thumb = cache.scene_thumb_path("scene_01", "abcdef1234567890")
    out = ensure_scene_thumbnail(clip, thumb)
    assert out == thumb
    assert thumb.is_file() and thumb.stat().st_size > 0

    with Image.open(thumb) as img:
        assert img.size == (270, 480)
        assert img.format == "JPEG"

    first_mtime = thumb.stat().st_mtime_ns
    # Chamada idempotente com force=False não deve regerar arquivo existente
    ensure_scene_thumbnail(clip, thumb, force=False)
    assert thumb.stat().st_mtime_ns == first_mtime


def test_pipeline_status_scene_runtime_and_selective_run_pending(
    phase25_client: tuple[TestClient, Path, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client, projects_dir, cache_dir = phase25_client
    slug, scene_ids = _seed_clean_piloto_cache(projects_dir, cache_dir, profile="preview")

    # 1) Estado limpo: gera miniaturas on-demand para clipes pré-existentes e pending_count == 0
    r_clean = client.get(f"/api/projects/{slug}")
    assert r_clean.status_code == 200
    clean = r_clean.json()

    ps = clean["pipeline_status"]
    assert ps["audio_stale"] is False
    assert ps["stale_scene_ids"] == []
    assert ps["render_stale"] is False
    assert ps["pending_count"] == 0

    sr = clean["scene_runtime"]
    assert set(sr.keys()) == set(scene_ids)
    for sid in scene_ids:
        entry = sr[sid]
        assert entry["is_stale"] is False
        assert entry["has_clip"] is True
        assert entry["expected_hash"] and len(entry["expected_hash"]) == 64
        assert entry["thumbnail_url"].startswith(f"/api/projects/{slug}/media/thumbs/{sid}_")

    # Verifica que miniatura é servida via HTTP 200 com 270x480 JPEG real
    r_thumb = client.get(sr["scene_01"]["thumbnail_url"])
    assert r_thumb.status_code == 200
    with Image.open(io.BytesIO(r_thumb.content)) as thumb_img:
        assert thumb_img.size == (270, 480)

    # 2) POST /run-pending quando limpo retorna status="noop" sem abrir thread
    r_noop = client.post(f"/api/projects/{slug}/run-pending", json={"profile": "preview"})
    assert r_noop.status_code == 200
    noop = r_noop.json()
    assert noop["status"] == "noop"
    assert noop["job_id"] is None
    assert noop["pending_count"] == 0

    # 3) Editar visual.headline da scene_02 marca APENAS scene_02 como stale (e render_stale=True)
    r_edit = client.put(
        f"/api/projects/{slug}/scenes/scene_02",
        json={"visual": {"headline": "MAKÁRIOS REATIVO"}},
    )
    assert r_edit.status_code == 200

    r_stale = client.get(f"/api/projects/{slug}")
    assert r_stale.status_code == 200
    stale_detail = r_stale.json()
    ps_stale = stale_detail["pipeline_status"]
    assert ps_stale["audio_stale"] is False
    assert ps_stale["stale_scene_ids"] == ["scene_02"]
    assert ps_stale["render_stale"] is True
    assert ps_stale["pending_count"] == 2

    assert stale_detail["scene_runtime"]["scene_02"]["is_stale"] is True
    assert stale_detail["scene_runtime"]["scene_02"]["has_clip"] is False
    assert stale_detail["scene_runtime"]["scene_02"]["thumbnail_url"] is None
    for other_sid in scene_ids:
        if other_sid != "scene_02":
            assert stale_detail["scene_runtime"][other_sid]["is_stale"] is False
            assert stale_detail["scene_runtime"][other_sid]["has_clip"] is True

    # 4) Executar run-pending seletivamente: renderiza APENAS scene_02 (real Playwright ou spy) e consolida
    rendered_calls: list[str] = []
    real_render_scene_clip = production_api.render_scene_clip

    def _spy_render_scene_clip(*args: Any, **kwargs: Any) -> tuple[Path, str, bool]:
        scene_arg = kwargs.get("scene") if "scene" in kwargs else args[0]
        rendered_calls.append(scene_arg.scene_id)
        return real_render_scene_clip(*args, **kwargs)

    monkeypatch.setattr(production_api, "render_scene_clip", _spy_render_scene_clip)

    hub = client.app.state.sse_hub
    collected_events: list[str] = []
    done_event = threading.Event()
    subscribed_event = threading.Event()

    def _listen_sse() -> None:
        async def _consume() -> None:
            async for frame in hub.subscribe(slug, max_events=40):
                collected_events.append(frame)
                if frame.startswith("event: heartbeat"):
                    subscribed_event.set()
                if frame.startswith("event: done") or frame.startswith("event: error"):
                    done_event.set()
                    break

        asyncio.run(_consume())

    listener = threading.Thread(target=_listen_sse, daemon=True)
    listener.start()
    assert subscribed_event.wait(timeout=5.0), "Assinante SSE não recebeu heartbeat inicial."

    r_run = client.post(f"/api/projects/{slug}/run-pending", json={"profile": "preview"})
    assert r_run.status_code == 200
    run_payload = r_run.json()
    assert run_payload["status"] == "started"
    assert run_payload["job_id"]
    assert run_payload["pending_count"] == 2
    assert run_payload["stale_scene_ids"] == ["scene_02"]

    assert done_event.wait(timeout=90.0), f"run-pending não emitiu evento done. Eventos: {collected_events}"
    listener.join(timeout=5.0)

    # Verifica evento SSE done sem erro
    assert any(ev.startswith("event: done") for ev in collected_events), f"Eventos recebidos: {collected_events}"
    done_frame = next(ev for ev in collected_events if ev.startswith("event: done"))
    data_line = next(line for line in done_frame.splitlines() if line.startswith("data: "))
    done_data = json.loads(data_line.removeprefix("data: "))
    assert done_data["done"] is True
    assert done_data["regenerated_scenes"] == ["scene_02"]
    assert done_data["audio_realigned"] is False
    assert done_data["profile"] == "preview"
    assert done_data["video_url"] == f"/api/projects/{slug}/media/renders/preview_9x16.mp4"

    # Apenas scene_02 foi renderizada pelo loop seletivo
    assert rendered_calls == ["scene_02"]

    # Projeto volta a ficar 100% limpo com nova miniatura servida em /media/thumbs/...
    r_after = client.get(f"/api/projects/{slug}")
    assert r_after.status_code == 200
    after = r_after.json()
    assert after["pipeline_status"]["pending_count"] == 0
    assert after["pipeline_status"]["stale_scene_ids"] == []
    assert after["pipeline_status"]["render_stale"] is False
    assert after["scene_runtime"]["scene_02"]["is_stale"] is False
    assert after["scene_runtime"]["scene_02"]["has_clip"] is True

    new_thumb_url = after["scene_runtime"]["scene_02"]["thumbnail_url"]
    assert new_thumb_url is not None
    r_new_thumb = client.get(new_thumb_url)
    assert r_new_thumb.status_code == 200
    with Image.open(io.BytesIO(r_new_thumb.content)) as img:
        assert img.size == (270, 480)

    # Confirma que pipeline_status/scene_runtime NÃO foram gravados nos JSONs em disco
    manifest_disk = json.loads((projects_dir / slug / "manifest.json").read_text(encoding="utf-8"))
    assert "pipeline_status" not in manifest_disk
    assert "scene_runtime" not in manifest_disk
    # Confirma 0 arquivos binários de mídia dentro de projects/
    assert not list((projects_dir / slug).rglob("*.jpg"))
    assert not list((projects_dir / slug).rglob("*.mp4"))
    assert not list((projects_dir / slug).rglob("*.wav"))

    # 5) Alterar palavra no roteiro deve acionar audio_stale=True
    script_payload = after["script"]
    script_payload["narration_segments"][0]["display_text"] = "Texto alterado para testar stale de áudio."
    r_put_script = client.put(f"/api/projects/{slug}/script", json=script_payload)
    assert r_put_script.status_code == 200
    r_audio_stale = client.get(f"/api/projects/{slug}")
    assert r_audio_stale.json()["pipeline_status"]["audio_stale"] is True


def test_clone_workflow_inheritance_and_gate1_storyboard_preservation(
    phase25_client: tuple[TestClient, Path, Path],
) -> None:
    client, projects_dir, cache_dir = phase25_client

    # Personaliza preferências do storyboard fonte (piloto-makarios) para comprovar herança
    source_sb_path = projects_dir / "piloto-makarios" / "storyboard.json"
    source_sb = json.loads(source_sb_path.read_text(encoding="utf-8"))
    source_sb["music_track"] = "music/tracks/custom_editorial_clone.wav"
    source_sb["music_enabled"] = False
    source_sb["captions_enabled"] = False
    source_sb_path.write_text(json.dumps(source_sb, indent=2), encoding="utf-8")

    # Simula mídia no cache do projeto fonte para comprovar 0 cópia de mídia
    source_cache = get_project_cache("piloto-makarios", cache_root=cache_dir, ensure=True)
    (source_cache.renders / "final_9x16.mp4").write_bytes(b"fake-mp4-data")

    # 1) Clonar workflow sem sobrescrever bible_translation -> herda NVI + ep 2 + preferências
    r_clone = client.post(
        "/api/projects/piloto-makarios/clone-workflow",
        json={
            "title": "O que significa Shalom no hebraico",
            "raw_idea": "Explicar que shalom no hebraico original vai muito além de ausência de guerra em Números 6:26.",
            "seed_reference": "Nm 6:26",
        },
    )
    assert r_clone.status_code == 200
    cloned = r_clone.json()
    new_slug = cloned["manifest"]["slug"]
    assert new_slug == "o-que-significa-shalom-no-hebraico"

    # Herança de manifest e série com episode_number incrementado e gates zerados
    assert cloned["manifest"]["preset_id"] == "pastor-andre-biblico"
    assert cloned["manifest"]["series"]["format_type"] == "perdido_traducao"
    assert cloned["manifest"]["series"]["series_id"] == "perdido_traducao"
    assert cloned["manifest"]["series"]["batch_id"] == "retomada-lote-01"
    assert cloned["manifest"]["series"]["episode_number"] == 2
    assert all(val is False for val in cloned["manifest"]["gates"].values())
    assert cloned["manifest"]["cost_ledger"]["spent_total"] == 0.0
    assert cloned["manifest"]["cost_ledger"]["estimated_total"] == 0.0

    # Herança de briefing + recomendação nova calculada
    assert cloned["briefing"]["bible_translation"] == "NVI"
    assert cloned["briefing"]["target_duration_sec"] == 40
    assert cloned["briefing"]["audio_mode"] == "recorded"
    assert cloned["briefing"]["human_seal_mode"] == "paper_cutout"
    assert cloned["briefing"]["selected_format_type"] == "perdido_traducao"
    assert cloned["briefing"]["recommended_format"]["format_type"] == "perdido_traducao"

    # Roteiro, áudio e cenas NÃO copiados; storyboard herda apenas preferências com scene_ids=[]
    assert cloned["script"] is None
    assert cloned["audio_alignment"] is None
    assert cloned["scenes"] == []
    assert cloned["storyboard"] is not None
    assert cloned["storyboard"]["scene_ids"] == []
    assert cloned["storyboard"]["music_track"] == "music/tracks/custom_editorial_clone.wav"
    assert cloned["storyboard"]["music_enabled"] is False
    assert cloned["storyboard"]["captions_enabled"] is False

    # Pipeline status inicial limpo (sem script ainda)
    assert cloned["pipeline_status"] == {
        "audio_stale": False,
        "stale_scene_ids": [],
        "render_stale": False,
        "pending_count": 0,
    }

    # 0 cópia de mídia no cache do projeto clonado
    assert not (cache_dir / new_slug).exists()

    # GET /api/projects lista o projeto clonado normalmente com scene_count == 0
    r_list = client.get("/api/projects")
    assert r_list.status_code == 200
    listed = next(p for p in r_list.json()["projects"] if p["slug"] == new_slug)
    assert listed["scene_count"] == 0

    # 2) Gerar roteiro + validar Bíblia + Gate 1 -> preserva music_track/music_enabled/captions_enabled!
    r_gen = client.post(f"/api/projects/{new_slug}/script/generate", json={"use_llm": False})
    assert r_gen.status_code == 200
    script = r_gen.json()["script"]
    for ref in script["scripture_refs"]:
        ref["verified_by_human"] = True
        ref["exact_text"] = "O Senhor volte o rosto para você e lhe dê paz."
    assert client.put(f"/api/projects/{new_slug}/script", json=script).status_code == 200

    r_approve = client.post(f"/api/projects/{new_slug}/script/approve")
    assert r_approve.status_code == 200
    approved = r_approve.json()
    assert len(approved["storyboard"]["scene_ids"]) >= 8
    assert approved["storyboard"]["music_track"] == "music/tracks/custom_editorial_clone.wav"
    assert approved["storyboard"]["music_enabled"] is False
    assert approved["storyboard"]["captions_enabled"] is False

    # 3) Segundo clone com tradução sobrescrita -> episode_number == 3 e bible_translation == "ARA"
    r_clone2 = client.post(
        "/api/projects/piloto-makarios/clone-workflow",
        json={
            "title": "A palavra grega Agape",
            "raw_idea": "Explicar a diferença entre agape e phileo em João 21.",
            "seed_reference": "Jo 21:15",
            "bible_translation": "ARA",
        },
    )
    assert r_clone2.status_code == 200
    cloned2 = r_clone2.json()
    assert cloned2["manifest"]["series"]["episode_number"] == 3
    assert cloned2["briefing"]["bible_translation"] == "ARA"
