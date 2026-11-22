"""Testes completos da Fase 3: TTS Local Zero-Shot, Amostras de Voz, Preview Bíblico e Workers Isolados."""

from __future__ import annotations

import io
import json
import math
import shutil
import struct
import subprocess
import sys
import time
import wave
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from backend.core.config import WORKSPACE_ROOT, load_settings
from backend.core.storage import ProjectStorage
from backend.server import create_app
from backend.services.alignment_service import normalize_biblical_text, split_tts_chunks
from backend.services.sse_hub import SSEHub
from backend.services.tts_local_service import run_isolated_tts_worker

_FAKE_GEMINI_SECRET = "AIzaSy-Phase3-UltraSecret-Key-111"
_FAKE_OPENROUTER_SECRET = "sk-or-v1-Phase3-UltraSecret-Key-222"
_FAKE_FAL_SECRET = "fal-Phase3-UltraSecret-Key-333"


def _make_wav_bytes(duration_sec: float = 7.0, sample_rate: int = 24000) -> bytes:
    num_frames = int(duration_sec * sample_rate)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        frames = bytearray()
        for i in range(num_frames):
            sample = int(11000 * math.sin(2.0 * math.pi * 240.0 * (i / sample_rate)))
            frames.extend(struct.pack("<h", sample))
        wf.writeframes(bytes(frames))
    return buf.getvalue()


def _assert_no_secrets_leaked(text: str) -> None:
    assert _FAKE_GEMINI_SECRET not in text
    assert _FAKE_OPENROUTER_SECRET not in text
    assert _FAKE_FAL_SECRET not in text


@pytest.fixture()
def phase3_client(tmp_path: Path) -> tuple[TestClient, ProjectStorage, Path, SSEHub]:
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
            "TTS_VENV_PYTHON": "",
            "VOICESTUDIO_URL": "http://127.0.0.1:59991",
            "GEMINI_API_KEY": _FAKE_GEMINI_SECRET,
            "OPENROUTER_API_KEY": _FAKE_OPENROUTER_SECRET,
            "FAL_KEY": _FAKE_FAL_SECRET,
        },
        allow_custom_cache=True,
    )
    storage = ProjectStorage(projects_dir)
    hub = SSEHub()
    app = create_app(settings=settings, storage=storage, sse_hub=hub)
    with TestClient(app) as client:
        yield client, storage, cache_dir, hub


def test_audio_capabilities_contract_and_zero_secret_leak(
    phase3_client: tuple[TestClient, ProjectStorage, Path, SSEHub],
) -> None:
    client, _, _, _ = phase3_client

    resp = client.get("/api/audio/capabilities")
    assert resp.status_code == 200
    _assert_no_secrets_leaked(resp.text)

    data = resp.json()
    assert data["hardware"] in ("cpu", "cuda")
    if data["hardware"] == "cpu":
        assert data["gpu_name"] is None
        assert isinstance(data["cpu_warning"], str) and "CPU" in data["cpu_warning"]
    assert data["tts_venv_configured"] is False
    assert data["tts_venv_valid"] is False
    assert "setup_tts_venv" in data["setup_command"]

    engines_by_id = {eng["id"]: eng for eng in data["engines"]}
    assert set(engines_by_id.keys()) == {"pilot_sapi", "xtts_v2", "f5_tts", "voicestudio"}
    assert engines_by_id["pilot_sapi"]["ready"] is True
    assert engines_by_id["pilot_sapi"]["requires_sample"] is False
    assert engines_by_id["xtts_v2"]["ready"] is False
    assert engines_by_id["xtts_v2"]["requires_sample"] is True
    assert engines_by_id["f5_tts"]["ready"] is False
    assert engines_by_id["voicestudio"]["ready"] is False

    align_by_id = {eng["id"]: eng for eng in data["alignment_engines"]}
    assert align_by_id["deterministic_rms"]["ready"] is True
    assert "whisperx" in align_by_id
    assert "stable_ts" in align_by_id
    assert isinstance(data["voice_samples"], list)


def test_voice_samples_full_lifecycle_and_path_traversal_block(
    phase3_client: tuple[TestClient, ProjectStorage, Path, SSEHub],
) -> None:
    client, _, cache_dir, _ = phase3_client

    # Upload amostra ideal (7s)
    wav_7s = _make_wav_bytes(duration_sec=7.0, sample_rate=44100)
    r_up = client.post(
        "/api/voice-samples/upload",
        data={"name": "Pastor André Teste!"},
        files={"file": ("gravacao.wav", wav_7s, "audio/wav")},
    )
    assert r_up.status_code == 200, r_up.text
    sample = r_up.json()["sample"]
    assert sample["id"] == "pastor_andre_teste"
    assert sample["sample_rate_hz"] == 24000
    assert 6.5 <= sample["duration_sec"] <= 7.5
    assert sample["warning"] is None
    assert sample["audio_url"] == "/api/voice-samples/pastor_andre_teste/audio"

    saved_file = cache_dir / "_voice_samples" / "pastor_andre_teste.wav"
    assert saved_file.is_file()

    # Upload amostra curta (<5s) gera warning amigável
    wav_2s = _make_wav_bytes(duration_sec=2.0, sample_rate=24000)
    r_short = client.post(
        "/api/voice-samples/upload",
        data={"name": "curta"},
        files={"file": ("curta.wav", wav_2s, "audio/wav")},
    )
    assert r_short.status_code == 200
    assert r_short.json()["sample"]["warning"] is not None

    # Listagem
    r_list = client.get("/api/voice-samples")
    assert r_list.status_code == 200
    ids = [s["id"] for s in r_list.json()["samples"]]
    assert "pastor_andre_teste" in ids
    assert "curta" in ids

    # Download áudio WAV
    r_audio = client.get("/api/voice-samples/pastor_andre_teste/audio")
    assert r_audio.status_code == 200
    assert r_audio.content[:4] == b"RIFF"

    # Bloqueio de path traversal (GET, DELETE e validação direta de serviço)
    for evil in ("bad..id", "inv@lid", "..\\secret"):
        r_evil_get = client.get(f"/api/voice-samples/{evil}/audio")
        assert r_evil_get.status_code == 400
        r_evil_del = client.delete(f"/api/voice-samples/{evil}")
        assert r_evil_del.status_code == 400

    r_trav_get = client.get("/api/voice-samples/..%2F..%2Fsecret/audio")
    assert r_trav_get.status_code in (400, 404, 405, 422)
    r_trav_del = client.delete("/api/voice-samples/..%2F..%2Fsecret")
    assert r_trav_del.status_code in (400, 404, 405, 422)

    # Exclusão limpa
    r_del = client.delete("/api/voice-samples/pastor_andre_teste")
    assert r_del.status_code == 200
    assert r_del.json()["deleted"] is True
    assert not saved_file.exists()

    r_after = client.get("/api/voice-samples/pastor_andre_teste/audio")
    assert r_after.status_code == 404


def test_preview_tts_expands_scripture_and_respects_180_char_limit(
    phase3_client: tuple[TestClient, ProjectStorage, Path, SSEHub],
) -> None:
    client, storage, _, _ = phase3_client

    # Injeta abreviação "Mt 5:3" e um segmento longo (>240 chars) no roteiro temporário
    script = storage.load_script("piloto-makarios")
    updated_segments = list(script.narration_segments)
    updated_segments[0] = updated_segments[0].model_copy(
        update={
            "display_text": "Veja Mt 5:3 agora.",
            "tts_text": "Veja Mt 5:3 agora.",
        }
    )
    long_text = (
        "Quando lemos Mt 5:3 com atenção histórica, percebemos que Jesus não está prometendo "
        "uma alegria superficial passageira, mas anunciando o favor real do Reino dos céus "
        "sobre todos os que reconhecem sua dependência diária da graça de Deus em cada estação."
    )
    updated_segments[1] = updated_segments[1].model_copy(
        update={"display_text": long_text, "tts_text": long_text}
    )
    storage.save_script(
        "piloto-makarios",
        script.model_copy(update={"narration_segments": updated_segments}),
    )

    resp = client.post("/api/projects/piloto-makarios/audio/preview-tts")
    assert resp.status_code == 200, resp.text
    payload = resp.json()

    assert payload["total_segments"] == len(updated_segments)
    assert payload["total_chunks"] > payload["total_segments"]
    assert payload["total_chars"] > 0
    assert payload["estimated_duration_sec"] > 0

    first_chunk = payload["chunks"][0]
    assert first_chunk["segment_id"] == "seg_01"
    assert "Mateus, capítulo cinco, versículo três" in first_chunk["normalized_text"]
    assert "Mt 5:3" not in first_chunk["normalized_text"]

    for chunk in payload["chunks"]:
        assert chunk["char_count"] == len(chunk["normalized_text"])
        assert chunk["char_count"] <= 180

    # Confirma que split_tts_chunks reutiliza normalize_biblical_text
    direct = split_tts_chunks("Leia Jo 3:16 hoje.")
    assert direct == [normalize_biblical_text("Leia Jo 3:16 hoje.")]
    assert "João, capítulo três, versículo dezesseis" in direct[0]


def test_generate_tts_fail_fast_422_for_unconfigured_engines(
    phase3_client: tuple[TestClient, ProjectStorage, Path, SSEHub],
) -> None:
    client, _, _, _ = phase3_client

    # xtts_v2 sem TTS_VENV_PYTHON
    r_xtts = client.post(
        "/api/projects/piloto-makarios/audio/generate-tts",
        json={"engine": "xtts_v2", "auto_align": True},
    )
    assert r_xtts.status_code == 422
    assert "TTS_VENV_PYTHON" in r_xtts.json()["detail"]

    # f5_tts sem TTS_VENV_PYTHON
    r_f5 = client.post(
        "/api/projects/piloto-makarios/audio/generate-tts",
        json={"engine": "f5_tts", "auto_align": True},
    )
    assert r_f5.status_code == 422
    assert "TTS_VENV_PYTHON" in r_f5.json()["detail"]

    # voicestudio inacessível
    r_vs = client.post(
        "/api/projects/piloto-makarios/audio/generate-tts",
        json={"engine": "voicestudio", "auto_align": True},
    )
    assert r_vs.status_code == 422
    assert "VoiceStudio" in r_vs.json()["detail"]


def test_generate_tts_pilot_sapi_with_auto_align_updates_master_and_alignment(
    phase3_client: tuple[TestClient, ProjectStorage, Path, SSEHub],
) -> None:
    client, storage, cache_dir, hub = phase3_client

    published_events: list[tuple[str, dict[str, Any]]] = []
    orig_publish = hub.publish

    def _spy_publish(slug: str, event: str, data: dict[str, Any]) -> int:
        published_events.append((event, dict(data)))
        return orig_publish(slug, event, data)

    hub.publish = _spy_publish  # type: ignore[method-assign]

    resp = client.post(
        "/api/projects/piloto-makarios/audio/generate-tts",
        json={"engine": "pilot_sapi", "auto_align": True},
    )
    assert resp.status_code == 200, resp.text
    started = resp.json()
    assert started["status"] == "started"
    assert started["engine"] == "pilot_sapi"
    assert started["auto_align"] is True
    assert started["job_id"]

    # Aguarda conclusão da thread de background (evento SSE done ou error)
    deadline = time.monotonic() + 45.0
    terminal: tuple[str, dict[str, Any]] | None = None
    while time.monotonic() < deadline:
        for ev_name, ev_data in published_events:
            if ev_name in ("done", "error") and ev_data.get("job_id") == started["job_id"]:
                terminal = (ev_name, ev_data)
                break
        if terminal is not None:
            break
        time.sleep(0.1)

    assert terminal is not None, f"Timeout aguardando SSE done; eventos={published_events}"
    ev_name, ev_data = terminal
    assert ev_name == "done", f"Esperava done, recebeu {ev_name}: {ev_data}"
    assert ev_data["stage"] == "tts_generate"
    assert ev_data["engine"] == "pilot_sapi"
    assert ev_data["words_count"] > 20
    assert ev_data["duration_ms"] > 1000
    assert ev_data["audio_url"] == "/api/projects/piloto-makarios/media/audio/narration_master.wav"

    master_wav = cache_dir / "piloto-makarios" / "audio" / "narration_master.wav"
    assert master_wav.is_file() and master_wav.stat().st_size > 10000
    with wave.open(str(master_wav), "rb") as wf:
        assert wf.getframerate() == 48000
        assert wf.getnchannels() == 1

    alignment = storage.load_audio_alignment("piloto-makarios")
    assert len(alignment.words) == ev_data["words_count"]
    assert alignment.duration_ms == ev_data["duration_ms"]

    manifest = storage.load_manifest("piloto-makarios")
    assert manifest.gates.audio_aligned is True

    stages_seen = {d.get("stage") for _, d in published_events}
    assert "tts_generate" in stages_seen
    assert "audio_align" in stages_seen


def test_isolated_tts_worker_subprocess_protocol_and_setup_dry_run(tmp_path: Path) -> None:
    # 1) Testa protocolo de subprocesso isolado com fake worker em tmp_path
    fake_worker = tmp_path / "fake_xtts_worker.py"
    fake_worker.write_text(
        """
import argparse, json, math, struct, wave
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument("--chunks-json", required=True)
p.add_argument("--voice-sample", required=True)
p.add_argument("--output", required=True)
p.add_argument("--language", default="pt")
args = p.parse_args()

data = json.loads(Path(args.chunks_json).read_text(encoding="utf-8"))
chunks = data["chunks"]
assert Path(args.voice_sample).is_file()

total = len(chunks)
for i, ch in enumerate(chunks, start=1):
    print(json.dumps({
        "type": "progress",
        "chunk": i,
        "total": total,
        "pct": int(round(i * 100 / total)),
        "segment_id": ch.get("segment_id", f"seg_{i:02d}"),
    }), flush=True)

sr = 24000
frames = bytearray()
for i in range(sr):
    frames.extend(struct.pack("<h", int(9000 * math.sin(2.0 * math.pi * 220.0 * (i / sr)))))

out = Path(args.output)
out.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(out), "wb") as wf:
    wf.setnchannels(1)
    wf.setsampwidth(2)
    wf.setframerate(sr)
    wf.writeframes(bytes(frames))

print(json.dumps({"type": "done", "output": str(out), "total_chunks": total}), flush=True)
""",
        encoding="utf-8",
    )

    sample_wav = tmp_path / "ref_voice.wav"
    sample_wav.write_bytes(_make_wav_bytes(duration_sec=6.0, sample_rate=24000))
    output_wav = tmp_path / "out" / "synth.wav"

    chunks = [
        {"segment_id": "seg_01", "normalized_text": "Mateus, capítulo cinco, versículo três."},
        {"segment_id": "seg_02", "normalized_text": "No grego original a palavra é macários."},
        {"segment_id": "seg_03", "normalized_text": "Alegria que nasce do Reino dos céus."},
    ]
    progress_log: list[tuple[int, int, int, str]] = []

    result_path = run_isolated_tts_worker(
        venv_python=sys.executable,
        worker_script=fake_worker,
        chunks=chunks,
        voice_sample=sample_wav,
        output_wav=output_wav,
        language="pt",
        on_chunk_progress=lambda c, t, pct, seg: progress_log.append((c, t, pct, seg)),
    )

    assert result_path == output_wav
    assert output_wav.is_file() and output_wav.stat().st_size > 44
    assert progress_log == [
        (1, 3, 33, "seg_01"),
        (2, 3, 67, "seg_02"),
        (3, 3, 100, "seg_03"),
    ]

    # 2) Testa CLI setup_tts_venv --dry-run
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "backend.workers.setup_tts_venv",
            "--engine",
            "xtts_v2",
            "--dry-run",
        ],
        cwd=str(WORKSPACE_ROOT),
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    plan = json.loads(proc.stdout)
    assert plan["dry_run"] is True
    assert plan["engine"] == "xtts_v2"
    assert "onedrive" not in plan["venv_dir"].lower()
    assert plan["env_line"].startswith("TTS_VENV_PYTHON=")
    assert len(plan["commands"]) >= 3
