"""Serviço de TTS Local Zero-Shot ($0), detecção de hardware, amostras e preview bíblico.

Regras invioláveis:
- Zero PyTorch no .venv principal (motores neurais rodam exclusivamente em subprocesso via TTS_VENV_PYTHON).
- Amostras de voz salvas fora do OneDrive em STUDIO_CACHE_DIR/_voice_samples/ (WAV 24kHz mono).
- Reuso estrito de normalize_biblical_text e split_tts_chunks de alignment_service.py.
- Zero vazamento de credenciais de .env em capacidades, erros ou logs.
"""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import tempfile
import threading
import unicodedata
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any, Literal

import httpx

from backend.core.cache import ProjectCachePaths
from backend.core.config import StudioSettings, get_voice_samples_dir, load_settings, resolve_cache_dir
from backend.models.preset import AudioMode
from backend.models.script import Script
from backend.services.alignment_service import (
    _probe_audio_metadata,
    normalize_biblical_text,
    probe_isolated_alignment_engines,
    probe_venv_modules,
    split_tts_chunks,
)
from backend.services.audio_mixer_service import _run_ffmpeg, ensure_pilot_audio
from backend.workers import F5_WORKER_SCRIPT, XTTS_WORKER_SCRIPT
from backend.workers.setup_tts_venv import (
    _venv_python_path,
    resolve_default_venv_dir,
    run_tts_venv_setup,
)

logger = logging.getLogger(__name__)

TtsEngineId = Literal["pilot_sapi", "xtts_v2", "f5_tts", "voicestudio"]
ProgressCallback = Callable[[int, str], None]

ALLOWED_VOICE_SAMPLE_EXTENSIONS = frozenset({".wav", ".mp3", ".m4a", ".ogg", ".flac"})
_SAFE_SAMPLE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_CPU_WARNING_MSG = (
    "Sem GPU NVIDIA detectada: clonagem neural (XTTS-v2/F5-TTS) roda em CPU "
    "(~1-3 min por vídeo); gravação real ou pilot_sapi são instantâneos."
)
_DEFAULT_SETUP_COMMAND = "uv run --no-sync python -m backend.workers.setup_tts_venv --engine xtts_v2"


def detect_hardware() -> dict[str, Any]:
    """Detecta presença de GPU NVIDIA (CUDA) via nvidia-smi sem importar PyTorch."""
    try:
        proc = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            check=False,
            timeout=3,
        )
        if proc.returncode == 0:
            lines = [line.strip() for line in proc.stdout.splitlines() if line.strip()]
            if lines:
                return {
                    "hardware": "cuda",
                    "gpu_name": lines[0],
                    "cpu_warning": None,
                }
    except (OSError, subprocess.SubprocessError):
        pass

    return {
        "hardware": "cpu",
        "gpu_name": None,
        "cpu_warning": _CPU_WARNING_MSG,
    }


def resolve_effective_tts_venv_python(settings: StudioSettings) -> str | None:
    """Resolve TTS_VENV_PYTHON priorizando settings e auto-detectando o venv padrão em produção."""
    if settings.tts_venv_python and settings.tts_venv_python.strip():
        return settings.tts_venv_python.strip()

    try:
        default_prod_cache = resolve_cache_dir(None, create=False)
        is_prod_cache = settings.studio_cache_dir.resolve() == default_prod_cache.resolve()
    except (OSError, ValueError):
        is_prod_cache = False

    if not is_prod_cache:
        return None

    try:
        fresh = load_settings(workspace_root=settings.workspace_root, create_cache_dir=False)
        if fresh.tts_venv_python and fresh.tts_venv_python.strip():
            return fresh.tts_venv_python.strip()
    except (OSError, ValueError):
        pass

    default_py = _venv_python_path(resolve_default_venv_dir())
    if default_py.is_file():
        return str(default_py)
    return None


def validate_tts_venv(tts_venv_python: str | None) -> tuple[bool, bool, Path | None]:
    """Retorna (configured, valid, resolved_path) para TTS_VENV_PYTHON."""
    if not tts_venv_python or not tts_venv_python.strip():
        return (False, False, None)
    candidate = Path(os.path.expanduser(os.path.expandvars(tts_venv_python.strip())))
    if not candidate.is_file():
        return (True, False, None)
    return (True, True, candidate.resolve())


def probe_voicestudio(voicestudio_url: str, *, timeout_sec: float = 1.5) -> bool:
    """Verifica rapidamente se um servidor local VoiceStudio HTTP está respondendo."""
    base = (voicestudio_url or "").strip().rstrip("/")
    if not base:
        return False
    try:
        with httpx.Client(timeout=timeout_sec, follow_redirects=True) as client:
            for endpoint in (f"{base}/health", f"{base}/"):
                try:
                    resp = client.get(endpoint)
                    if resp.status_code < 500:
                        return True
                except httpx.HTTPError:
                    continue
    except httpx.HTTPError:
        return False
    return False


def sanitize_sample_id(raw_name: str) -> str:
    """Converte nome livre/arquivo em slug seguro [a-z0-9][a-z0-9_-]{0,63}."""
    ascii_text = (
        unicodedata.normalize("NFKD", raw_name or "")
        .encode("ascii", "ignore")
        .decode("ascii")
        .lower()
    )
    cleaned = re.sub(r"[^a-z0-9_-]+", "_", ascii_text)
    cleaned = re.sub(r"_+", "_", cleaned).strip("_-")
    if not cleaned:
        cleaned = "amostra_voz"
    if not cleaned[0].isalnum():
        cleaned = f"v_{cleaned}"
    return cleaned[:64]


def validate_sample_id(sample_id: str) -> str:
    """Valida sample_id contra path traversal e caracteres inválidos (fail-fast)."""
    if not sample_id or not _SAFE_SAMPLE_ID_RE.match(sample_id):
        raise ValueError(f"sample_id inválido ou inseguro: '{sample_id}'.")
    return sample_id


def _sample_duration_warning(duration_sec: float) -> str | None:
    if duration_sec < 5.0:
        return (
            f"Amostra curta ({duration_sec:.1f}s): recomendamos 6–15s de fala limpa "
            "sem ruído para clonagem estável."
        )
    if duration_sec > 30.0:
        return (
            f"Amostra longa ({duration_sec:.1f}s): recomendamos 6–15s de fala limpa "
            "para melhor qualidade e velocidade."
        )
    return None


def _resolve_configured_sample_path(settings: StudioSettings) -> Path | None:
    raw = (settings.tts_voice_sample or "").strip()
    if not raw:
        return None
    expanded = Path(os.path.expanduser(os.path.expandvars(raw)))
    candidate = expanded if expanded.is_absolute() else (settings.workspace_root / expanded)
    try:
        resolved = candidate.resolve()
    except OSError:
        return None
    return resolved if resolved.is_file() and resolved.stat().st_size > 44 else None


def _build_sample_entry(
    *,
    sample_id: str,
    wav_path: Path,
    is_default: bool,
) -> dict[str, Any]:
    sample_rate_hz, duration_ms = _probe_audio_metadata(wav_path)
    duration_sec = round(duration_ms / 1000.0, 2)
    return {
        "id": sample_id,
        "filename": wav_path.name,
        "duration_sec": duration_sec,
        "sample_rate_hz": sample_rate_hz,
        "is_default": is_default,
        "warning": _sample_duration_warning(duration_sec),
        "audio_url": f"/api/voice-samples/{sample_id}/audio",
    }


def list_voice_samples(settings: StudioSettings) -> list[dict[str, Any]]:
    """Lista amostras WAV de STUDIO_CACHE_DIR/_voice_samples/ + TTS_VOICE_SAMPLE (se existir)."""
    samples_dir = get_voice_samples_dir(settings, create=True)
    default_stem = sanitize_sample_id(Path(settings.tts_voice_sample or "pastor_andre").stem)

    entries_by_id: dict[str, tuple[Path, bool]] = {}
    for wav_file in sorted(samples_dir.glob("*.wav")):
        if not wav_file.is_file() or wav_file.stat().st_size <= 44:
            continue
        sample_id = sanitize_sample_id(wav_file.stem)
        if not _SAFE_SAMPLE_ID_RE.match(sample_id):
            continue
        entries_by_id[sample_id] = (wav_file.resolve(), sample_id == default_stem)

    configured_path = _resolve_configured_sample_path(settings)
    if configured_path is not None:
        cfg_id = sanitize_sample_id(configured_path.stem)
        if cfg_id not in entries_by_id:
            entries_by_id[cfg_id] = (configured_path, True)

    samples: list[dict[str, Any]] = []
    for sample_id, (wav_path, is_def) in sorted(entries_by_id.items()):
        try:
            samples.append(_build_sample_entry(sample_id=sample_id, wav_path=wav_path, is_default=is_def))
        except (RuntimeError, ValueError, OSError) as exc:
            logger.warning("Ignorando amostra de voz corrompida '%s': %s", wav_path.name, exc)

    if samples and not any(item["is_default"] for item in samples):
        samples[0]["is_default"] = True

    return samples


def resolve_voice_sample_path(
    settings: StudioSettings,
    sample_id: str | None = None,
) -> Path | None:
    """Resolve o caminho real de uma amostra de voz validando contra path traversal."""
    samples_dir = get_voice_samples_dir(settings, create=True).resolve()

    if sample_id is not None:
        clean_id = validate_sample_id(sample_id)
        candidate = (samples_dir / f"{clean_id}.wav").resolve()
        if not candidate.is_relative_to(samples_dir):
            raise ValueError(f"Tentativa de path traversal em sample_id: '{sample_id}'.")
        if candidate.is_file() and candidate.stat().st_size > 44:
            return candidate

        configured_path = _resolve_configured_sample_path(settings)
        if configured_path is not None and sanitize_sample_id(configured_path.stem) == clean_id:
            return configured_path
        return None

    # Sem sample_id explícito: tenta padrão ou primeira amostra disponível
    samples = list_voice_samples(settings)
    if not samples:
        return None
    preferred = next((s for s in samples if s["is_default"]), samples[0])
    return resolve_voice_sample_path(settings, preferred["id"])


def save_uploaded_voice_sample(
    settings: StudioSettings,
    *,
    file_bytes: bytes,
    filename: str,
    custom_name: str | None = None,
) -> dict[str, Any]:
    """Valida upload, converte via FFmpeg para WAV 24kHz mono em STUDIO_CACHE_DIR/_voice_samples/."""
    clean_filename = (filename or "amostra.wav").strip()
    ext = Path(clean_filename).suffix.lower()
    if ext not in ALLOWED_VOICE_SAMPLE_EXTENSIONS:
        raise ValueError(
            f"Formato de amostra não suportado ('{ext}'). Use .wav, .mp3, .m4a, .ogg ou .flac."
        )
    if not file_bytes:
        raise ValueError("Arquivo de amostra de voz vazio.")

    raw_label = (custom_name or "").strip() or Path(clean_filename).stem
    sample_id = sanitize_sample_id(raw_label)
    validate_sample_id(sample_id)

    samples_dir = get_voice_samples_dir(settings, create=True).resolve()
    target_wav = (samples_dir / f"{sample_id}.wav").resolve()
    if not target_wav.is_relative_to(samples_dir):
        raise ValueError(f"Caminho de destino fora do diretório de amostras: '{sample_id}'.")

    token = uuid.uuid4().hex[:8]
    raw_tmp = samples_dir / f".upload_{sample_id}_{token}{ext}"
    conv_tmp = samples_dir / f".conv_{sample_id}_{token}.wav"

    try:
        raw_tmp.write_bytes(file_bytes)
        _run_ffmpeg(
            [
                "-i",
                str(raw_tmp),
                "-af",
                "highpass=f=70",
                "-ar",
                "24000",
                "-ac",
                "1",
                "-c:a",
                "pcm_s16le",
                str(conv_tmp),
            ],
            context=f"convert_voice_sample_{sample_id}",
        )
        os.replace(conv_tmp, target_wav)
        default_stem = sanitize_sample_id(Path(settings.tts_voice_sample or "pastor_andre").stem)
        return _build_sample_entry(
            sample_id=sample_id,
            wav_path=target_wav,
            is_default=(sample_id == default_stem),
        )
    finally:
        raw_tmp.unlink(missing_ok=True)
        conv_tmp.unlink(missing_ok=True)


def delete_voice_sample(settings: StudioSettings, sample_id: str) -> bool:
    """Remove amostra salva em STUDIO_CACHE_DIR/_voice_samples/ (bloqueando path traversal)."""
    clean_id = validate_sample_id(sample_id)
    samples_dir = get_voice_samples_dir(settings, create=True).resolve()
    target_wav = (samples_dir / f"{clean_id}.wav").resolve()
    if not target_wav.is_relative_to(samples_dir):
        raise ValueError(f"Tentativa de path traversal ao excluir amostra: '{sample_id}'.")
    if not target_wav.is_file():
        return False
    target_wav.unlink()
    return True


def get_audio_capabilities(settings: StudioSettings) -> dict[str, Any]:
    """Retorna capacidades de hardware, engines TTS/alinhamento e amostras (0 segredos)."""
    hw = detect_hardware()
    effective_venv_py = resolve_effective_tts_venv_python(settings)
    venv_configured, venv_valid, venv_path = validate_tts_venv(effective_venv_py)

    venv_mods = (
        probe_venv_modules(venv_path, ("TTS", "f5_tts"))
        if venv_valid and venv_path is not None
        else {"TTS": False, "f5_tts": False}
    )
    xtts_ready = venv_valid and venv_mods.get("TTS", False)
    f5_ready = venv_valid and venv_mods.get("f5_tts", False)
    voicestudio_ready = probe_voicestudio(settings.voicestudio_url)

    def _venv_hint(engine_id: str, pkg_name: str, is_ready: bool) -> str:
        if is_ready:
            return "Pronto no venv isolado (TTS_VENV_PYTHON)."
        if not venv_configured:
            return "Configure TTS_VENV_PYTHON via setup_tts_venv."
        if not venv_valid:
            return "TTS_VENV_PYTHON configurado, mas o executável não foi encontrado."
        return f"Pacote '{pkg_name}' ausente no venv isolado. Rode setup_tts_venv --engine {engine_id}."

    align_status = probe_isolated_alignment_engines(venv_path if venv_valid else None)
    samples = list_voice_samples(settings)

    return {
        "hardware": hw["hardware"],
        "gpu_name": hw["gpu_name"],
        "cpu_warning": hw["cpu_warning"],
        "tts_venv_configured": venv_configured,
        "tts_venv_valid": venv_valid,
        "setup_command": _DEFAULT_SETUP_COMMAND,
        "engines": [
            {
                "id": "pilot_sapi",
                "label": "Piloto Local PT-BR ($0 · instantâneo)",
                "ready": True,
                "requires_sample": False,
                "mode": "local_fast",
                "hint": "Pronto para uso imediato.",
            },
            {
                "id": "xtts_v2",
                "label": "XTTS-v2 Zero-Shot ($0 · clonagem)",
                "ready": xtts_ready,
                "requires_sample": True,
                "mode": "isolated_venv",
                "hint": _venv_hint("xtts_v2", "TTS", xtts_ready),
            },
            {
                "id": "f5_tts",
                "label": "F5-TTS PT-BR ($0 · clonagem)",
                "ready": f5_ready,
                "requires_sample": True,
                "mode": "isolated_venv",
                "hint": _venv_hint("f5_tts", "f5_tts", f5_ready),
            },
            {
                "id": "voicestudio",
                "label": "VoiceStudio Local HTTP ($0)",
                "ready": voicestudio_ready,
                "requires_sample": True,
                "mode": "local_http",
                "hint": (
                    f"Conectado em {settings.voicestudio_url}."
                    if voicestudio_ready
                    else f"Inicie o VoiceStudio em {settings.voicestudio_url}."
                ),
            },
        ],
        "alignment_engines": [
            {"id": "deterministic_rms", "ready": align_status["deterministic_rms"]},
            {"id": "whisperx", "ready": align_status["whisperx"]},
            {"id": "stable_ts", "ready": align_status["stable_ts"]},
        ],
        "voice_samples": samples,
    }


def build_tts_preview(script: Script, *, max_chunk_chars: int = 180) -> dict[str, Any]:
    """Gera preview do texto bíblico normalizado pré-TTS reusando alignment_service."""
    chunks: list[dict[str, Any]] = []
    for seg in script.narration_segments:
        raw_source = seg.tts_text.strip() or seg.display_text.strip()
        normalized_text = normalize_biblical_text(raw_source, max_chunk_chars=max_chunk_chars)
        seg_chunks = split_tts_chunks(normalized_text, max_chunk_chars=max_chunk_chars)
        for chunk_text in seg_chunks:
            chunks.append(
                {
                    "segment_id": seg.segment_id,
                    "role": seg.role.value,
                    "original_text": seg.display_text,
                    "normalized_text": chunk_text,
                    "char_count": len(chunk_text),
                }
            )

    total_chars = sum(item["char_count"] for item in chunks)
    total_chunks = len(chunks)
    estimated_duration_sec = (
        round(max(1.0, (total_chars / 14.5) + (total_chunks * 0.22)), 1)
        if total_chunks > 0
        else 0.0
    )
    return {
        "total_segments": len(script.narration_segments),
        "total_chunks": total_chunks,
        "total_chars": total_chars,
        "estimated_duration_sec": estimated_duration_sec,
        "chunks": chunks,
    }


def validate_tts_generation_request(
    settings: StudioSettings,
    engine: TtsEngineId,
    voice_sample_id: str | None = None,
    *,
    allow_auto_setup: bool = False,
) -> tuple[Path | None, Path | None]:
    """Valida pré-requisitos da engine fail-fast; retorna (venv_python_path, voice_sample_path)."""
    if engine == "pilot_sapi":
        return (None, None)

    if engine in ("xtts_v2", "f5_tts"):
        effective_venv_py = resolve_effective_tts_venv_python(settings)
        configured, valid, venv_path = validate_tts_venv(effective_venv_py)
        required_pkg = "TTS" if engine == "xtts_v2" else "f5_tts"
        pkg_ready = False
        if configured and valid and venv_path is not None:
            mods = probe_venv_modules(venv_path, (required_pkg,))
            pkg_ready = mods.get(required_pkg, False)

        if not allow_auto_setup:
            if not configured or not valid or venv_path is None:
                raise ValueError(
                    f"Engine '{engine}' exige TTS_VENV_PYTHON configurado e válido (fora do OneDrive). "
                    f"Execute: uv run --no-sync python -m backend.workers.setup_tts_venv --engine {engine}"
                )
            if not pkg_ready:
                raise ValueError(
                    f"Pacote '{required_pkg}' não encontrado no venv isolado ('{venv_path}'). "
                    f"Execute: uv run --no-sync python -m backend.workers.setup_tts_venv --engine {engine}"
                )

        sample_path = resolve_voice_sample_path(settings, voice_sample_id)
        if sample_path is None:
            raise ValueError(
                f"Engine '{engine}' exige uma amostra de voz (WAV/MP3 de 6–15s). "
                "Envie uma amostra em POST /api/voice-samples/upload antes de gerar."
            )
        return (venv_path if pkg_ready else None, sample_path)

    if engine == "voicestudio":
        if not probe_voicestudio(settings.voicestudio_url):
            raise ValueError(
                f"VoiceStudio local inacessível em {settings.voicestudio_url}. "
                "Inicie o servidor local antes de gerar narração."
            )
        sample_path = resolve_voice_sample_path(settings, voice_sample_id)
        if sample_path is None:
            raise ValueError(
                "VoiceStudio exige uma amostra de voz (WAV/MP3 de 6–15s). "
                "Envie uma amostra antes de gerar."
            )
        return (None, sample_path)

    raise ValueError(f"Engine TTS desconhecida: '{engine}'.")


def run_isolated_tts_worker(
    *,
    venv_python: Path | str,
    worker_script: Path | str,
    chunks: list[dict[str, Any]],
    voice_sample: Path,
    output_wav: Path,
    language: str = "pt",
    on_chunk_progress: Callable[[int, int, int, str], None] | None = None,
    timeout_sec: float = 600.0,
) -> Path:
    """Executa worker TTS isolado em subprocesso lendo progresso JSON chunk-a-chunk."""
    py_path = Path(venv_python)
    script_path = Path(worker_script)
    if not py_path.is_file():
        raise FileNotFoundError(f"Python isolado não encontrado: '{py_path}'.")
    if not script_path.is_file():
        raise FileNotFoundError(f"Worker script não encontrado: '{script_path}'.")
    if not voice_sample.is_file():
        raise FileNotFoundError(f"Amostra de voz não encontrada: '{voice_sample}'.")
    if not chunks:
        raise ValueError("Lista de chunks vazia para síntese TTS.")

    output_wav.parent.mkdir(parents=True, exist_ok=True)
    chunks_file = output_wav.parent / f".tts_chunks_{uuid.uuid4().hex[:8]}.json"
    chunks_file.write_text(
        json.dumps({"chunks": chunks}, ensure_ascii=False),
        encoding="utf-8",
    )

    stderr_lines: list[str] = []
    worker_error_msg: str | None = None

    def _drain_stderr(stream: Any) -> None:
        if stream is None:
            return
        for raw_line in iter(stream.readline, ""):
            stderr_lines.append(raw_line)
        stream.close()

    try:
        cmd = [
            str(py_path),
            str(script_path),
            "--chunks-json",
            str(chunks_file),
            "--voice-sample",
            str(voice_sample),
            "--output",
            str(output_wav),
            "--language",
            language,
        ]
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        stderr_thread = threading.Thread(
            target=_drain_stderr,
            args=(proc.stderr,),
            name="tts-worker-stderr",
            daemon=True,
        )
        stderr_thread.start()

        assert proc.stdout is not None
        for raw_line in iter(proc.stdout.readline, ""):
            line = raw_line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                logger.debug("TTS worker stdout: %s", line[:200])
                continue
            if not isinstance(event, dict):
                continue
            ev_type = event.get("type")
            if ev_type == "progress":
                chunk_idx = int(event.get("chunk", 0))
                total = max(1, int(event.get("total", len(chunks))))
                pct = max(0, min(100, int(event.get("pct", round((chunk_idx / total) * 100)))))
                seg_id = str(event.get("segment_id") or "")
                if on_chunk_progress is not None:
                    on_chunk_progress(chunk_idx, total, pct, seg_id)
            elif ev_type == "error":
                worker_error_msg = str(event.get("message") or "Erro no worker TTS isolado.")

        proc.stdout.close()
        try:
            returncode = proc.wait(timeout=timeout_sec)
        except subprocess.TimeoutExpired as exc:
            proc.kill()
            proc.wait()
            raise RuntimeError(f"Worker TTS excedeu timeout de {timeout_sec:.0f}s.") from exc
        finally:
            stderr_thread.join(timeout=5.0)

        if returncode != 0:
            err_detail = worker_error_msg or "".join(stderr_lines).strip() or f"exit code {returncode}"
            raise RuntimeError(f"Worker TTS falhou (exit={returncode}): {err_detail}")

        if not output_wav.is_file() or output_wav.stat().st_size <= 44:
            raise RuntimeError(f"Worker TTS concluiu sem gerar WAV válido em '{output_wav}'.")

        return output_wav
    finally:
        chunks_file.unlink(missing_ok=True)


def synthesize_via_voicestudio(
    *,
    voicestudio_url: str,
    chunks: list[dict[str, Any]],
    voice_sample: Path,
    output_wav: Path,
    language: str = "pt",
    timeout_sec: float = 180.0,
) -> Path:
    """Envia texto normalizado + amostra de voz para servidor local VoiceStudio HTTP."""
    base = voicestudio_url.strip().rstrip("/")
    full_text = "\n".join(str(c.get("normalized_text") or c.get("text") or "") for c in chunks).strip()
    if not full_text:
        raise ValueError("Texto vazio para síntese via VoiceStudio.")

    output_wav.parent.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=timeout_sec, follow_redirects=True) as client:
        with voice_sample.open("rb") as fh:
            resp = client.post(
                f"{base}/api/tts",
                data={"text": full_text, "language": language},
                files={"voice_sample": (voice_sample.name, fh, "audio/wav")},
            )
    if resp.status_code >= 400:
        raise RuntimeError(
            f"VoiceStudio retornou HTTP {resp.status_code}: {resp.text[:240]}"
        )
    if len(resp.content) <= 44:
        raise RuntimeError("VoiceStudio retornou áudio vazio ou inválido.")
    output_wav.write_bytes(resp.content)
    return output_wav


def _normalize_to_master_wav(raw_wav: Path, master_wav: Path, context: str) -> Path:
    """Normaliza qualquer saída TTS para WAV 48kHz mono pcm_s16le (contrato da Fase 2)."""
    master_wav.parent.mkdir(parents=True, exist_ok=True)
    tmp_master = master_wav.parent / f".master_{uuid.uuid4().hex[:8]}.wav"
    try:
        _run_ffmpeg(
            [
                "-i",
                str(raw_wav),
                "-af",
                "highpass=f=70",
                "-ar",
                "48000",
                "-ac",
                "1",
                "-c:a",
                "pcm_s16le",
                str(tmp_master),
            ],
            context=context,
        )
        os.replace(tmp_master, master_wav)
        return master_wav
    finally:
        tmp_master.unlink(missing_ok=True)


def generate_tts_narration(
    *,
    settings: StudioSettings,
    script: Script,
    cache: ProjectCachePaths,
    engine: TtsEngineId,
    voice_sample_id: str | None = None,
    target_duration_sec: float = 40.0,
    allow_auto_setup: bool = False,
    on_progress: ProgressCallback | None = None,
) -> tuple[Path, AudioMode]:
    """Gera narration_master.wav (48kHz mono) usando a engine local selecionada."""
    venv_path, sample_path = validate_tts_generation_request(
        settings,
        engine,
        voice_sample_id,
        allow_auto_setup=allow_auto_setup,
    )
    master_wav = cache.audio / "narration_master.wav"
    preview = build_tts_preview(script)
    chunks = preview["chunks"]

    def _emit(pct: int, msg: str) -> None:
        if on_progress is not None:
            on_progress(pct, msg)

    if engine == "pilot_sapi":
        _emit(20, f"Sintetizando narração local PT-BR ({len(chunks)} blocos normalizados)...")
        out_path, audio_mode = ensure_pilot_audio(
            script=script,
            cache_dir=cache.root,
            input_audio_path=None,
            target_duration_sec=target_duration_sec,
        )
        _emit(95, "Narração piloto local pronta (48kHz mono).")
        return out_path, audio_mode

    raw_tts_wav = cache.audio / f"_raw_{engine}_{uuid.uuid4().hex[:8]}.wav"
    try:
        if engine in ("xtts_v2", "f5_tts"):
            if venv_path is None and allow_auto_setup:
                _emit(6, f"Preparando ambiente isolado de clonagem ({engine}) pela 1ª vez...")
                venv_path = run_tts_venv_setup(
                    engine=engine,
                    on_step=lambda step, total, msg: _emit(5 + int((step / max(1, total)) * 10), msg),
                )
                settings.tts_venv_python = str(venv_path)
            assert venv_path is not None and sample_path is not None
            worker_script = XTTS_WORKER_SCRIPT if engine == "xtts_v2" else F5_WORKER_SCRIPT
            _emit(10, f"Iniciando worker isolado {engine} ({len(chunks)} blocos)...")

            def _on_chunk(chunk_idx: int, total: int, pct: int, seg_id: str) -> None:
                scaled = 10 + round(pct * 0.78)
                label = f" ({seg_id})" if seg_id else ""
                _emit(scaled, f"Sintetizando bloco {chunk_idx}/{total}{label} via {engine}...")

            run_isolated_tts_worker(
                venv_python=venv_path,
                worker_script=worker_script,
                chunks=chunks,
                voice_sample=sample_path,
                output_wav=raw_tts_wav,
                language="pt",
                on_chunk_progress=_on_chunk,
            )
            _emit(92, "Normalizando narração para 48kHz mono...")
            _normalize_to_master_wav(raw_tts_wav, master_wav, context=f"normalize_tts_{engine}")
            audio_mode = AudioMode.XTTS_V2 if engine == "xtts_v2" else AudioMode.F5_TTS
            return master_wav, audio_mode

        if engine == "voicestudio":
            assert sample_path is not None
            _emit(25, f"Enviando {len(chunks)} blocos normalizados para VoiceStudio local...")
            synthesize_via_voicestudio(
                voicestudio_url=settings.voicestudio_url,
                chunks=chunks,
                voice_sample=sample_path,
                output_wav=raw_tts_wav,
                language="pt",
            )
            _emit(90, "Normalizando resposta do VoiceStudio para 48kHz mono...")
            _normalize_to_master_wav(raw_tts_wav, master_wav, context="normalize_tts_voicestudio")
            return master_wav, AudioMode.VOICESTUDIO

        raise ValueError(f"Engine TTS não suportada: '{engine}'.")
    finally:
        raw_tts_wav.unlink(missing_ok=True)
