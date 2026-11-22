"""Testes automatizados da Fase 4: Manifesto de Templates, Fila FIFO, Pins de Revisão, Nível 2 Cirúrgico e Métricas 48h."""

from __future__ import annotations

import io
import json
import shutil
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.core.config import WORKSPACE_ROOT, load_settings
from backend.core.storage import ProjectStorage
from backend.models.preset import SceneStatus
from backend.server import create_app


@pytest.fixture()
def phase4_client(tmp_path: Path) -> tuple[TestClient, Path, Path]:
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
            "ENABLE_FAL_3D": "false",
            "MAX_COST_PER_SCENE_USD": "0.50",
            "MAX_COST_PER_VIDEO_USD": "2.50",
            "GEMINI_API_KEY": "sk-secret-gemini-never-leak",
            "OPENROUTER_API_KEY": "sk-or-secret-never-leak",
            "FAL_KEY": "fal-secret-never-leak",
        },
        allow_custom_cache=True,
    )
    storage = ProjectStorage(projects_dir)
    app = create_app(settings=settings, storage=storage)
    with TestClient(app) as client:
        yield client, projects_dir, cache_dir


def test_templates_manifest_includes_all_five_templates_and_timeline_map(
    phase4_client: tuple[TestClient, Path, Path],
) -> None:
    client, _, _ = phase4_client
    resp = client.get("/api/templates")
    assert resp.status_code == 200
    payload = resp.json()
    assert "templates" in payload
    templates = payload["templates"]
    assert len(templates) == 6

    ids = [t["id"] for t in templates]
    assert set(ids) == {
        "paper_collage",
        "bible_quote_card",
        "kinetic_captions",
        "timeline_map",
        "editorial_motion",
        "tier2_video",
    }

    timeline = next(t for t in templates if t["id"] == "timeline_map")
    assert timeline["tier"] == 1
    assert timeline["default_cost_usd"] == 0.0
    assert "mapa_contexto" in timeline["recommended_formats"]
    assert "conexao_at_nt" in timeline["recommended_formats"]
    field_keys = [f["key"] for f in timeline["editable_fields"]]
    assert "original_term" in field_keys
    assert "stamp_text" in field_keys


def test_review_pins_lifecycle_preserves_cache_hash_and_downgrades_approved_status(
    phase4_client: tuple[TestClient, Path, Path],
) -> None:
    client, projects_dir, _ = phase4_client
    slug = "piloto-makarios"
    scene_id = "scene_03"
    storage = ProjectStorage(projects_dir)

    # Prepara cena com status APPROVED e cache_hash preenchido
    expected_hash = "a" * 64
    initial_scene = storage.load_scene(slug, scene_id).model_copy(
        update={
            "status": SceneStatus.APPROVED,
            "cache_hash": expected_hash,
            "review_pins": [],
        }
    )
    storage.save_scene(slug, initial_scene)

    # 1) POST pin -> muda status de approved para needs_revision SEM invalidar cache_hash
    r_add = client.post(
        f"/api/projects/{slug}/scenes/{scene_id}/pins",
        json={
            "x_pct": 54.5,
            "y_pct": 38.0,
            "time_ms": 1800,
            "note": "Destacar rota da Galileia em dourado",
        },
    )
    assert r_add.status_code == 200
    added = r_add.json()
    assert added["pin"]["pin_id"] == "pin_01"
    assert added["pin"]["x_pct"] == 54.5
    assert added["pin"]["y_pct"] == 38.0
    assert added["pin"]["time_ms"] == 1800
    assert added["pin"]["note"] == "Destacar rota da Galileia em dourado"
    assert added["pin"]["resolved"] is False

    assert added["scene"]["status"] == "needs_revision"
    assert added["scene"]["cache_hash"] == expected_hash
    assert len(added["scene"]["review_pins"]) == 1

    # Segundo pin recebe pin_02
    r_add2 = client.post(
        f"/api/projects/{slug}/scenes/{scene_id}/pins",
        json={
            "x_pct": 25.0,
            "y_pct": 70.0,
            "time_ms": 950,
            "note": "Subir legenda 20px",
        },
    )
    assert r_add2.status_code == 200
    assert r_add2.json()["pin"]["pin_id"] == "pin_02"
    assert len(r_add2.json()["scene"]["review_pins"]) == 2

    # 2) PATCH pin_01 -> resolved=True e nota atualizada, mantendo cache_hash intacto
    r_patch = client.patch(
        f"/api/projects/{slug}/scenes/{scene_id}/pins/pin_01",
        json={
            "resolved": True,
            "note": "Destacar rota da Galileia em dourado (ajustado)",
        },
    )
    assert r_patch.status_code == 200
    patched = r_patch.json()
    assert patched["pin"]["pin_id"] == "pin_01"
    assert patched["pin"]["resolved"] is True
    assert patched["pin"]["note"] == "Destacar rota da Galileia em dourado (ajustado)"
    assert patched["scene"]["cache_hash"] == expected_hash

    # 3) DELETE pin_01 -> remove apenas pin_01 mantendo pin_02 e cache_hash
    r_del = client.delete(f"/api/projects/{slug}/scenes/{scene_id}/pins/pin_01")
    assert r_del.status_code == 200
    deleted = r_del.json()
    assert deleted["deleted_pin_id"] == "pin_01"
    assert [p["pin_id"] for p in deleted["scene"]["review_pins"]] == ["pin_02"]
    assert deleted["scene"]["cache_hash"] == expected_hash

    # Pin inexistente retorna 404
    assert client.delete(f"/api/projects/{slug}/scenes/{scene_id}/pins/pin_99").status_code == 404


def test_tier2_catalog_zero_leaks_guardrails_and_local_simulation(
    phase4_client: tuple[TestClient, Path, Path],
) -> None:
    client, projects_dir, cache_dir = phase4_client
    slug = "piloto-makarios"
    scene_id = "scene_04"
    storage = ProjectStorage(projects_dir)

    # 1) GET /api/tier2/catalog -> 4 modelos, flags corretas e 0 chaves de API vazadas
    r_cat = client.get("/api/tier2/catalog")
    assert r_cat.status_code == 200
    raw_text = r_cat.text
    assert "sk-secret-gemini-never-leak" not in raw_text
    assert "sk-or-secret-never-leak" not in raw_text
    assert "fal-secret-never-leak" not in raw_text
    assert "api_key" not in raw_text.lower()

    cat = r_cat.json()
    assert cat["enable_tier2_video"] is False
    assert cat["enable_fal_3d"] is False
    assert cat["max_cost_per_scene_usd"] == 0.50
    assert cat["max_cost_per_video_usd"] == 2.50
    model_ids = {m["model_id"] for m in cat["models"]}
    assert model_ids == {"hailuo_3", "grok_imagine_lite", "gpt_image_2", "fal_trellis_3d"}

    # 2) Bloqueio 403 quando ENABLE_TIER2_VIDEO=false e simulate_local=false
    r_403_video = client.post(
        f"/api/projects/{slug}/scenes/{scene_id}/tier2-generate",
        json={
            "model_id": "hailuo_3",
            "prompt": "Panorâmica histórica de Cafarnaum ao amanhecer",
            "simulate_local": False,
        },
    )
    assert r_403_video.status_code == 403
    assert "ENABLE_TIER2_VIDEO=false" in r_403_video.json()["detail"]

    # Bloqueio 403 quando ENABLE_FAL_3D=false e simulate_local=false
    r_403_3d = client.post(
        f"/api/projects/{slug}/scenes/{scene_id}/tier2-generate",
        json={
            "model_id": "fal_trellis_3d",
            "prompt": "Rolo de pergaminho 3D",
            "simulate_local": False,
        },
    )
    assert r_403_3d.status_code == 403
    assert "ENABLE_FAL_3D=false" in r_403_3d.json()["detail"]

    # 3) Bloqueio 422 quando custo excede cap_usd do projeto
    manifest = storage.load_manifest(slug)
    tight_manifest = manifest.model_copy(
        update={
            "cost_ledger": manifest.cost_ledger.model_copy(
                update={"spent_total": 2.40, "cap_usd": 2.50}
            )
        }
    )
    storage.save_manifest(slug, tight_manifest)

    r_422_cap = client.post(
        f"/api/projects/{slug}/scenes/{scene_id}/tier2-generate",
        json={
            "model_id": "grok_imagine_lite",
            "prompt": "Mapa animado Nível 2",
            "simulate_local": False,
        },
    )
    assert r_422_cap.status_code == 422
    assert "Custo excede o teto configurado" in r_422_cap.json()["detail"]

    # Restaura manifest original
    storage.save_manifest(slug, manifest)

    # 4) Sucesso com simulate_local=True ($0.00): gera arte 9:16 no STUDIO_CACHE_DIR e registra no cost_ledger
    r_sim = client.post(
        f"/api/projects/{slug}/scenes/{scene_id}/tier2-generate",
        json={
            "model_id": "hailuo_3",
            "prompt": "Gravura editorial Vox de Jerusalém no século I com destaque dourado",
            "simulate_local": True,
        },
    )
    assert r_sim.status_code == 200
    sim_data = r_sim.json()
    assert sim_data["simulated"] is True
    assert sim_data["cost_ledger"]["spent_total"] == 0.0
    assert len(sim_data["cost_ledger"]["items"]) == 1
    assert sim_data["cost_ledger"]["items"][0]["cost_usd"] == 0.0
    assert sim_data["cost_ledger"]["items"][0]["scene_id"] == scene_id
    assert sim_data["scene"]["tier"] == 2
    assert sim_data["scene"]["template"] == "tier2_video"

    expected_cache_png = cache_dir / slug / "assets" / f"{scene_id}_tier2_hailuo_3.png"
    assert expected_cache_png.is_file() and expected_cache_png.stat().st_size > 0
    assert not list((projects_dir / slug).rglob("*.png"))

    r_media = client.get(sim_data["asset_url"])
    assert r_media.status_code == 200
    with Image.open(io.BytesIO(r_media.content)) as art_img:
        assert art_img.size == (1080, 1920)


def test_execution_queue_enqueue_cancel_and_clear_history(
    phase4_client: tuple[TestClient, Path, Path],
) -> None:
    client, _, cache_dir = phase4_client
    slug = "piloto-makarios"

    # Configura pickup_delay maior para testar cancelamento determinístico enquanto status == "queued"
    queue_mgr = client.get("/api/queue")
    assert queue_mgr.status_code == 200
    client.app.state.queue_manager._pickup_delay_sec = 0.8

    # 1) Enfileira job #1 e cancela imediatamente enquanto queued
    r_enq1 = client.post(
        "/api/queue/enqueue",
        json={"slug": slug, "action": "run_pending", "profile": "preview"},
    )
    assert r_enq1.status_code == 200
    enq1 = r_enq1.json()
    job1_id = enq1["job"]["job_id"]
    assert enq1["job"]["slug"] == slug
    assert enq1["job"]["status"] == "queued"
    assert enq1["queue_length"] >= 1

    r_cancel = client.post(f"/api/queue/{job1_id}/cancel")
    assert r_cancel.status_code == 200
    assert r_cancel.json()["job"]["status"] == "cancelled"

    # Cancelar job já cancelado retorna 200 com status atual; job inexistente retorna 404
    r_cancel_again = client.post(f"/api/queue/{job1_id}/cancel")
    assert r_cancel_again.status_code == 200
    assert r_cancel_again.json()["job"]["status"] == "cancelled"
    assert client.post("/api/queue/q_inexistente/cancel").status_code == 404

    # 2) Reduz delay e testa clear-history removendo jobs finalizados/cancelados
    client.app.state.queue_manager._pickup_delay_sec = 0.02
    r_clear = client.post("/api/queue/clear-history")
    assert r_clear.status_code == 200
    assert r_clear.json()["jobs"] == []

    # Verifica que _queue_history.json foi salvo em STUDIO_CACHE_DIR (fora do OneDrive)
    history_file = cache_dir / "_queue_history.json"
    assert history_file.is_file()
    persisted = json.loads(history_file.read_text(encoding="utf-8"))
    assert "jobs" in persisted


def test_metrics_48h_and_series_analytics_summary(
    phase4_client: tuple[TestClient, Path, Path],
) -> None:
    client, _, _ = phase4_client
    slug = "piloto-makarios"

    # 1) PUT /api/projects/{slug}/metrics registra métricas de 48h
    r_put = client.put(
        f"/api/projects/{slug}/metrics",
        json={
            "viewed_vs_swiped_pct": 78.5,
            "avg_retention_pct": 92.4,
            "comments_count": 47,
        },
    )
    assert r_put.status_code == 200
    m_data = r_put.json()
    assert m_data["metrics_48h"]["viewed_vs_swiped_pct"] == 78.5
    assert m_data["metrics_48h"]["avg_retention_pct"] == 92.4
    assert m_data["metrics_48h"]["comments_count"] == 47
    assert m_data["metrics_48h"]["published_at"] is not None

    # 2) Cria um 2º projeto na série mapa_contexto com métricas menores
    r_new = client.post(
        "/api/projects",
        json={
            "title": "A rota secreta de Jericó",
            "raw_idea": "Mapa geográfico e arqueológico da rota e distância de Jericó para Jerusalém em Lucas 10.",
            "seed_reference": "Lc 10:30",
        },
    )
    assert r_new.status_code == 200
    map_slug = r_new.json()["manifest"]["slug"]
    assert r_new.json()["manifest"]["series"]["format_type"] == "mapa_contexto"
    client.put(
        f"/api/projects/{map_slug}/metrics",
        json={
            "viewed_vs_swiped_pct": 64.0,
            "avg_retention_pct": 81.0,
            "comments_count": 19,
        },
    )

    # 3) GET /api/analytics/series-summary agrega as 4 séries e recomenda a campeã
    r_sum = client.get("/api/analytics/series-summary")
    assert r_sum.status_code == 200
    summary = r_sum.json()
    assert len(summary["series"]) == 4
    assert summary["top_performing_format"] == "perdido_traducao"
    assert "Perdido na Tradução" in summary["recommendation_note"]

    by_fmt = {item["format_type"]: item for item in summary["series"]}
    perdido = by_fmt["perdido_traducao"]
    assert perdido["total_episodes"] == 1
    assert perdido["published_episodes"] == 1
    assert perdido["avg_viewed_vs_swiped_pct"] == 78.5
    assert perdido["avg_retention_pct"] == 92.4
    assert perdido["total_comments"] == 47

    mapa = by_fmt["mapa_contexto"]
    assert mapa["total_episodes"] == 1
    assert mapa["published_episodes"] == 1
    assert mapa["avg_viewed_vs_swiped_pct"] == 64.0
    assert mapa["avg_retention_pct"] == 81.0
    assert mapa["total_comments"] == 19
