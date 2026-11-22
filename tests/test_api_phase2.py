"""Testes completos da API REST + SSE da Fase 2 (Co-criação, Produção, Assets, Capa e Segurança)."""

from __future__ import annotations

import asyncio
import io
import math
import shutil
import struct
import threading
import wave
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.core.config import WORKSPACE_ROOT, load_settings
from backend.core.storage import ProjectStorage
from backend.server import create_app
from backend.services.sse_hub import SSEHub

_FAKE_GEMINI_SECRET = "AIzaSy-Phase2-UltraSecret-Key-999"
_FAKE_OPENROUTER_SECRET = "sk-or-v1-Phase2-UltraSecret-Key-888"
_FAKE_FAL_SECRET = "fal-Phase2-UltraSecret-Key-777"


def _make_sample_png_bytes(width: int = 2160, height: int = 3840) -> bytes:
    img = Image.new("RGB", (width, height), color=(30, 58, 95))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _make_sample_wav_bytes(duration_sec: float = 3.0, sample_rate: int = 24000) -> bytes:
    num_frames = int(duration_sec * sample_rate)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        frames = bytearray()
        for i in range(num_frames):
            sample = int(12000 * math.sin(2.0 * math.pi * 220.0 * (i / sample_rate)))
            frames.extend(struct.pack("<h", sample))
        wf.writeframes(bytes(frames))
    return buf.getvalue()


def _assert_no_secrets_leaked(text: str) -> None:
    assert _FAKE_GEMINI_SECRET not in text
    assert _FAKE_OPENROUTER_SECRET not in text
    assert _FAKE_FAL_SECRET not in text


@pytest.fixture()
def api_client(tmp_path: Path) -> tuple[TestClient, Path, Path]:
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
            "GEMINI_API_KEY": _FAKE_GEMINI_SECRET,
            "OPENROUTER_API_KEY": _FAKE_OPENROUTER_SECRET,
            "FAL_KEY": _FAKE_FAL_SECRET,
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


def test_health_presets_projects_and_zero_secret_leak(
    api_client: tuple[TestClient, Path, Path],
) -> None:
    client, _, cache_dir = api_client

    r_health = client.get("/api/health")
    assert r_health.status_code == 200
    _assert_no_secrets_leaked(r_health.text)
    health = r_health.json()
    assert health["status"] == "ok"
    assert health["default_preset"] == "pastor-andre-biblico"
    assert Path(health["cache_dir"]).resolve() == cache_dir.resolve()

    r_presets = client.get("/api/presets")
    assert r_presets.status_code == 200
    _assert_no_secrets_leaked(r_presets.text)
    presets = r_presets.json()["presets"]
    assert any(p["preset_id"] == "pastor-andre-biblico" for p in presets)

    r_projects = client.get("/api/projects")
    assert r_projects.status_code == 200
    _assert_no_secrets_leaked(r_projects.text)
    projects = r_projects.json()["projects"]
    piloto = next((p for p in projects if p["slug"] == "piloto-makarios"), None)
    assert piloto is not None
    assert piloto["format_type"] == "perdido_traducao"
    assert piloto["scene_count"] == 10
    assert piloto["cost_spent_usd"] == 0.0

    r_detail = client.get("/api/projects/piloto-makarios")
    assert r_detail.status_code == 200
    _assert_no_secrets_leaked(r_detail.text)
    detail = r_detail.json()
    assert detail["manifest"]["slug"] == "piloto-makarios"
    assert len(detail["scenes"]) == 10
    assert "artifacts" in detail
    assert detail["artifacts"]["has_final_mp4"] is False

    # Static mount /templates_video para o iframe ao vivo da UI
    r_stage = client.get("/templates_video/stage.html")
    assert r_stage.status_code == 200
    assert "stage_engine.js" in r_stage.text


def test_full_cocreation_gate1_audio_asset_cover_and_guardrails(
    api_client: tuple[TestClient, Path, Path],
) -> None:
    client, projects_dir, cache_dir = api_client

    # 1) Criar novo projeto
    r_create = client.post(
        "/api/projects",
        json={
            "title": "A palavra grega Metanoia",
            "raw_idea": "Explicar que metanoia no grego original não é só remorso, mas mudança radical de mente em Mateus 4:17.",
            "seed_reference": "Mt 4:17",
            "bible_translation": "NVI",
        },
    )
    assert r_create.status_code == 200
    _assert_no_secrets_leaked(r_create.text)
    created = r_create.json()
    slug = created["manifest"]["slug"]
    assert slug == "a-palavra-grega-metanoia"
    assert created["briefing"]["recommended_format"]["format_type"] == "perdido_traducao"
    assert created["script"] is None
    assert created["scenes"] == []

    # 2) Recomendar série para tema de mapa/contexto + atualizar briefing sincronizando manifest
    r_rec = client.post(
        f"/api/projects/{slug}/briefing/recommend",
        json={
            "raw_idea": "Mostrar a rota e a distância da viagem missionária de Paulo até a cidade de Cafarnaum no mapa.",
            "seed_reference": "At 16:9",
        },
    )
    assert r_rec.status_code == 200
    assert r_rec.json()["recommended_format"]["format_type"] == "mapa_contexto"

    r_put_briefing = client.put(
        f"/api/projects/{slug}/briefing",
        json={
            "raw_idea": "Explicar o termo grego metanoia em Mateus 4:17 e sua tradução.",
            "seed_reference": "Mt 4:17",
            "selected_format_type": "perdido_traducao",
            "target_duration_sec": 40,
        },
    )
    assert r_put_briefing.status_code == 200
    assert r_put_briefing.json()["manifest"]["series"]["format_type"] == "perdido_traducao"
    assert r_put_briefing.json()["manifest"]["series"]["series_id"] == "perdido_traducao"

    # 3) Gerar roteiro e 3 hooks (modo local determinístico)
    r_gen = client.post(
        f"/api/projects/{slug}/script/generate",
        json={"use_llm": False},
    )
    assert r_gen.status_code == 200
    gen_payload = r_gen.json()
    assert gen_payload["mode"] == "local"
    script = gen_payload["script"]
    assert len(script["hooks"]) == 3
    for hook in script["hooks"]:
        assert len(hook["spoken_text"].split()) <= 8
    assert len(script["narration_segments"]) >= 8
    assert len(script["scripture_refs"]) >= 1
    assert all(ref["verified_by_human"] is False for ref in script["scripture_refs"])
    assert "cover_spec" in script["distribution_pack"]

    # 4) Refino pontual de hooks, segments e distribution
    r_ref_hooks = client.post(
        f"/api/projects/{slug}/script/refine",
        json={"instruction": "Deixe os hooks mais diretos e provocativos", "target": "hooks", "use_llm": False},
    )
    assert r_ref_hooks.status_code == 200
    assert r_ref_hooks.json()["mode"] == "local"
    refined_script = r_ref_hooks.json()["script"]
    assert len(refined_script["hooks"]) == 3
    assert all(len(h["spoken_text"].split()) <= 8 for h in refined_script["hooks"])
    assert refined_script["hooks"][0]["spoken_text"] != script["hooks"][0]["spoken_text"]

    r_ref_dist = client.post(
        f"/api/projects/{slug}/script/refine",
        json={"instruction": "Título mais curto em formato pergunta", "target": "distribution", "use_llm": False},
    )
    assert r_ref_dist.status_code == 200
    assert r_ref_dist.json()["mode"] == "local"

    # 5) Gate 1 DEVE BLOQUEAR com HTTP 422 enquanto verified_by_human=False
    r_approve_blocked = client.post(f"/api/projects/{slug}/script/approve")
    assert r_approve_blocked.status_code == 422
    assert "Checkpoint" in r_approve_blocked.json()["detail"]

    # 6) Marcar verified_by_human=True via PUT /script e aprovar Gate 1
    current_script = r_ref_dist.json()["script"]
    for ref in current_script["scripture_refs"]:
        ref["verified_by_human"] = True
        ref["exact_text"] = "Arrependam-se, pois o Reino dos céus está próximo."

    r_save_script = client.put(f"/api/projects/{slug}/script", json=current_script)
    assert r_save_script.status_code == 200
    assert r_save_script.json()["manifest"]["gates"]["scripture_verified"] is True

    r_approve_ok = client.post(f"/api/projects/{slug}/script/approve")
    assert r_approve_ok.status_code == 200
    approved_project = r_approve_ok.json()
    assert approved_project["manifest"]["gates"]["scripture_verified"] is True
    assert approved_project["manifest"]["gates"]["script_gate_1_approved"] is True
    assert approved_project["storyboard"] is not None
    assert 6 <= len(approved_project["scenes"]) <= len(current_script["narration_segments"])
    assert approved_project["scenes"][0]["timing"]["start_word_id"] == "w_0001"
    assert any(scene["visual"]["beats"] for scene in approved_project["scenes"])

    # 7) Upload de áudio gravado + forced alignment (no cache fora do OneDrive!)
    wav_bytes = _make_sample_wav_bytes(duration_sec=3.0)
    r_upload_audio = client.post(
        f"/api/projects/{slug}/audio/upload",
        files={"file": ("gravacao.wav", wav_bytes, "audio/wav")},
    )
    assert r_upload_audio.status_code == 200
    audio_info = r_upload_audio.json()
    assert audio_info["duration_ms"] >= 2800
    assert (cache_dir / slug / "audio" / "narration_master.wav").is_file()
    # Garante que nenhum binário WAV foi gravado dentro de projects/<slug>
    assert not list((projects_dir / slug).rglob("*.wav"))

    r_align = client.post(f"/api/projects/{slug}/audio/align", json={"audio_source": "recorded"})
    assert r_align.status_code == 200
    aligned_proj = r_align.json()
    assert aligned_proj["manifest"]["gates"]["audio_aligned"] is True
    assert aligned_proj["audio_alignment"] is not None
    assert aligned_proj["scenes"][0]["timing"]["resolved_start_ms"] == 0
    assert aligned_proj["artifacts"]["has_audio"] is True

    # 8) Guardrails de cena: bloquear tier=2 e custo acima do teto
    first_scene_id = aligned_proj["scenes"][0]["scene_id"]
    r_tier2 = client.put(
        f"/api/projects/{slug}/scenes/{first_scene_id}",
        json={"tier": 2, "template": "tier2_video"},
    )
    assert r_tier2.status_code == 403

    r_cost_cap = client.put(
        f"/api/projects/{slug}/scenes/{first_scene_id}",
        json={"cost_usd": 0.99},
    )
    assert r_cost_cap.status_code == 422

    r_scene_ok = client.put(
        f"/api/projects/{slug}/scenes/{first_scene_id}",
        json={"status": "approved", "visual": {"headline": "METANOIA REAL"}},
    )
    assert r_scene_ok.status_code == 200
    assert r_scene_ok.json()["scene"]["visual"]["headline"] == "METANOIA REAL"
    assert r_scene_ok.json()["scene"]["status"] == "approved"

    # 9) Upload de asset PNG (dropzone Gemini PRO) com smart resize <= 1080x1920
    big_png = _make_sample_png_bytes(width=2160, height=3840)
    r_asset = client.post(
        f"/api/projects/{slug}/scenes/{first_scene_id}/asset",
        files={"file": ("gemini_cutout.png", big_png, "image/png")},
        data={"asset_id": "cutout_metanoia", "apply_rembg": "false"},
    )
    assert r_asset.status_code == 200
    asset_resp = r_asset.json()
    assert asset_resp["asset_url"].startswith(f"/api/projects/{slug}/media/assets/")
    asset_entry = next(
        a for a in asset_resp["scene"]["assets"] if a["asset_id"] == "cutout_metanoia"
    )
    assert asset_entry["sha256"] and len(asset_entry["sha256"]) == 64

    r_asset_media = client.get(asset_resp["asset_url"])
    assert r_asset_media.status_code == 200
    with Image.open(io.BytesIO(r_asset_media.content)) as resized_img:
        assert resized_img.width <= 1080
        assert resized_img.height <= 1920
    # Nenhum PNG dentro de projects/<slug>
    assert not list((projects_dir / slug).rglob("*.png"))

    # 10) Geração de capa PNG limpa 1080x1920 respeitando safe-zones
    r_cover = client.post(f"/api/projects/{slug}/cover")
    assert r_cover.status_code == 200
    cover_url = r_cover.json()["cover_url"]
    assert cover_url == f"/api/projects/{slug}/media/qa/cover.png"

    r_cover_img = client.get(cover_url)
    assert r_cover_img.status_code == 200
    with Image.open(io.BytesIO(r_cover_img.content)) as cover_img:
        assert cover_img.size == (1080, 1920)


def test_media_path_traversal_protection(
    api_client: tuple[TestClient, Path, Path],
) -> None:
    client, _, _ = api_client

    # Variante não-codificada pode ser normalizada pelo cliente HTTP para /api/projects/.env (400/403/404)
    resp_norm = client.get("/api/projects/piloto-makarios/media/../../.env")
    assert resp_norm.status_code in (400, 403, 404)
    _assert_no_secrets_leaked(resp_norm.text)

    # Variantes codificadas chegam intactas ao endpoint /media/{subpath} e devem retornar 403/404
    for bad_url in (
        "/api/projects/piloto-makarios/media/%2e%2e/%2e%2e/.env",
        "/api/projects/piloto-makarios/media/..%5c..%5c.env",
    ):
        resp = client.get(bad_url)
        assert resp.status_code in (403, 404), f"URL '{bad_url}' retornou {resp.status_code}"
        _assert_no_secrets_leaked(resp.text)


def test_sse_hub_cross_thread_delivery() -> None:
    hub = SSEHub(heartbeat_interval_sec=2.0)

    async def _collect() -> list[str]:
        chunks: list[str] = []
        publisher_thread: threading.Thread | None = None

        def _publisher() -> None:
            hub.publish("demo-slug", "progress", {"stage": "rendering", "progress_pct": 50})
            hub.publish("demo-slug", "done", {"stage": "done", "progress_pct": 100, "done": True})

        async for frame in hub.subscribe("demo-slug", max_events=3):
            chunks.append(frame)
            if len(chunks) == 1:
                # Após o heartbeat inicial, o assinante já está registrado — disparo 100% determinístico
                publisher_thread = threading.Thread(target=_publisher, daemon=True)
                publisher_thread.start()

        if publisher_thread is not None:
            publisher_thread.join(timeout=2.0)
        return chunks

    frames = asyncio.run(_collect())
    assert len(frames) == 3
    assert frames[0].startswith("event: heartbeat")
    assert "event: progress" in frames[1]
    assert "event: done" in frames[2]


def test_ready_script_multi_sentence_over_2000_chars(
    api_client: tuple[TestClient, Path, Path],
) -> None:
    client, _, _ = api_client

    ready_script = (
        "Você já leu Filipenses 4:13 achando que é uma promessa de sucesso imediato?\n"
        "Na verdade, Paulo escreveu essa carta dentro de uma prisão romana, cercado de incertezas. "
        "Quando ele diz que tudo pode naquele que o fortalece, o contexto anterior fala de passar fome e fartura. "
        "Mas a cultura moderna transformou o versículo em um slogan de conquista pessoal sem cruz. "
        "Olha só como o texto original revela uma força muito mais profunda para os dias difíceis. "
        "Cristo não promete remover todas as tempestades, ele sustenta você no meio delas. "
        "Qual versículo você quer entender no contexto no próximo vídeo? "
    ) + ("Esse detalhe histórico transforma completamente a leitura devocional da passagem. " * 25)
    assert len(ready_script) > 2000

    r_create = client.post(
        "/api/projects",
        json={
            "title": "Roteiro pronto Filipenses 4 13",
            "raw_idea": ready_script,
            "seed_reference": "Fp 4:13",
            "bible_translation": "NVI",
        },
    )
    assert r_create.status_code == 200
    slug = r_create.json()["manifest"]["slug"]

    r_gen = client.post(
        f"/api/projects/{slug}/script/generate",
        json={"use_llm": False},
    )
    assert r_gen.status_code == 200
    script = r_gen.json()["script"]
    segments = script["narration_segments"]
    assert len(segments) >= 7
    assert "Filipenses" in segments[0]["display_text"]
    assert segments[0]["role"] == "hook"
    assert any("prisão romana" in seg["display_text"] for seg in segments)
    assert any(seg["role"] == "pivot" for seg in segments)
    assert any(seg["role"] == "cta" for seg in segments)


def test_scene_wide_image_and_animation_editing_and_asset_library(
    api_client: tuple[TestClient, Path, Path],
) -> None:
    client, _, _ = api_client
    slug = "piloto-makarios"

    # 1) Atualizar cena com subtext=None (regressão HTTP 422) + novos campos de imagem e animação
    r_update = client.put(
        f"/api/projects/{slug}/scenes/scene_02",
        json={
            "template": "bible_quote_card",
            "visual": {
                "headline": "NOVA HEADLINE",
                "subtext": None,
                "transition_in": "zoom_punch",
                "camera_motion": "handheld_drift",
                "image_layout": "background_blur",
                "image_fit": "contain",
                "image_scale": 1.35,
                "image_offset_x": -12.0,
                "image_offset_y": 8.0,
                "image_opacity": 0.75,
                "image_animation": "float",
                "illustration_variant": "ancient_arch",
                "element_animation": "pop_bounce",
                "animation_speed": 1.3,
                "motion_intensity": 1.5,
                "show_stamp": True,
            },
        },
    )
    assert r_update.status_code == 200
    updated_vis = r_update.json()["scene"]["visual"]
    assert updated_vis["subtext"] == ""
    assert updated_vis["transition_in"] == "zoom_punch"
    assert updated_vis["camera_motion"] == "handheld_drift"
    assert updated_vis["image_layout"] == "background_blur"
    assert updated_vis["image_animation"] == "float"
    assert updated_vis["element_animation"] == "pop_bounce"
    assert updated_vis["animation_speed"] == 1.3
    assert updated_vis["motion_intensity"] == 1.5
    assert updated_vis["show_stamp"] is True
    assert r_update.json()["scene"]["cache_hash"] is None

    # 2) Subir imagem na scene_02 -> listar na biblioteca -> reutilizar na scene_03 -> remover da scene_02
    png_bytes = _make_sample_png_bytes(1080, 1920)
    r_upload = client.post(
        f"/api/projects/{slug}/scenes/scene_02/asset",
        files={"file": ("arte_editorial.png", png_bytes, "image/png")},
        data={"apply_rembg": "false"},
    )
    assert r_upload.status_code == 200
    uploaded_rel = r_upload.json()["scene"]["assets"][0]["cache_relpath"]
    assert uploaded_rel

    r_list = client.get(f"/api/projects/{slug}/assets")
    assert r_list.status_code == 200
    assets = r_list.json()["assets"]
    assert any(a["cache_relpath"] == uploaded_rel for a in assets)

    r_attach = client.post(
        f"/api/projects/{slug}/scenes/scene_03/asset/attach",
        json={"cache_relpath": uploaded_rel},
    )
    assert r_attach.status_code == 200
    assert r_attach.json()["scene"]["assets"][0]["cache_relpath"] == uploaded_rel

    r_del = client.delete(f"/api/projects/{slug}/scenes/scene_02/asset")
    assert r_del.status_code == 200
    assert r_del.json()["scene"]["assets"][0]["cache_relpath"] is None
    assert r_del.json()["scene"]["cache_hash"] is None
