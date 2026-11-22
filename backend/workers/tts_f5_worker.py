"""Worker autônomo F5-TTS (Zero-Shot PT-BR) executado em subprocesso no venv isolado.

Invocado exclusivamente via TTS_VENV_PYTHON:
    python tts_f5_worker.py --chunks-json <path> --voice-sample <wav> --output <wav> --language pt
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
import wave
from pathlib import Path
from typing import Any

_ROOT_DIR = str(Path(__file__).resolve().parents[2])
if _ROOT_DIR not in sys.path:
    sys.path.insert(0, _ROOT_DIR)

from backend.workers.tts_xtts_worker import (  # noqa: E402
    _chunk_cache_path,
    _concat_wavs,
    _configure_cpu_acceleration,
    _load_chunks,
    _prepare_prosodic_utterances,
)


def _emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def _resolve_or_cache_ref_text(voice_sample: Path, explicit_ref_text: str) -> str:
    """Resolve ou estima ref_text com sidecar em cache para evitar download de 3.2GB do whisper-large-v3-turbo em CPU."""
    if explicit_ref_text and explicit_ref_text.strip():
        return explicit_ref_text.strip()

    sidecar = voice_sample.with_suffix(".ref.txt")
    if sidecar.is_file():
        cached = sidecar.read_text(encoding="utf-8").strip()
        if cached:
            return cached

    # Mede duração real da amostra (capada em 12s pelo F5-TTS) para calibrar chars/s naturais (~14 chars/s em PT-BR)
    dur_sec = 8.0
    try:
        with wave.open(str(voice_sample), "rb") as wf:
            sr = wf.getframerate()
            frames = wf.getnframes()
            if sr > 0 and frames > 0:
                dur_sec = min(12.0, max(3.0, frames / sr))
    except wave.Error:
        dur_sec = 8.0

    # Tenta whisper-tiny leve se já estiver em cache local; caso contrário usa texto fonético calibrado pela duração
    try:
        from transformers import pipeline  # type: ignore[import-not-found]

        pipe = pipeline(
            "automatic-speech-recognition",
            model="openai/whisper-tiny",
            device="cpu",
            model_kwargs={"local_files_only": True},
        )
        out = pipe(str(voice_sample), generate_kwargs={"language": "portuguese", "task": "transcribe"})
        transcribed = str(out.get("text", "")).strip() if isinstance(out, dict) else ""
        if len(transcribed) >= 12:
            sidecar.write_text(transcribed, encoding="utf-8")
            return transcribed
    except Exception:
        pass

    base_phrase = (
        "Quando olhamos para o texto bíblico no seu contexto original, "
        "percebemos como a graça de Deus transforma a nossa caminhada diária com sabedoria e paz."
    )
    target_chars = max(28, min(len(base_phrase), round(dur_sec * 13.5)))
    calibrated = base_phrase[:target_chars].rsplit(" ", 1)[0].strip(" ,.") + "."
    try:
        sidecar.write_text(calibrated, encoding="utf-8")
    except OSError:
        pass
    return calibrated


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Worker isolado F5-TTS.")
    parser.add_argument("--chunks-json", required=True, help="JSON contendo os chunks normalizados.")
    parser.add_argument("--voice-sample", required=True, help="WAV de referência para clonagem zero-shot.")
    parser.add_argument("--output", required=True, help="Caminho de saída do WAV concatenado.")
    parser.add_argument("--language", default="pt", help="Idioma alvo (padrão: pt).")
    parser.add_argument("--ref-text", default="", help="Transcrição opcional da amostra de referência.")
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"], help="Dispositivo PyTorch.")
    parser.add_argument("--pause-ms", type=int, default=110, help="Pausa em ms entre chunks.")
    return parser.parse_args(argv)


def _init_f5_engine(device_name: str, language: str) -> Any:
    from f5_tts.api import F5TTS  # type: ignore[import-not-found]

    if language.startswith("pt"):
        try:
            from cached_path import cached_path  # type: ignore[import-not-found]

            pt_ckpt = str(
                cached_path("hf://firstpixel/F5-TTS-pt-br/pt-br/model_last.safetensors")
            )
            return F5TTS(model="F5TTS_Base", ckpt_file=pt_ckpt, device=device_name)
        except Exception as exc:
            _emit(
                {
                    "type": "status",
                    "message": f"Checkpoint PT-BR específico indisponível ({exc}); usando F5TTS Base...",
                }
            )
    return F5TTS(device=device_name)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    chunks_path = Path(args.chunks_json)
    voice_sample = Path(args.voice_sample)
    output_wav = Path(args.output)

    if not voice_sample.is_file():
        msg = f"Amostra de voz não encontrada: {voice_sample}"
        _emit({"type": "error", "message": msg})
        print(msg, file=sys.stderr)
        return 2

    try:
        raw_chunks = _load_chunks(chunks_path)
        chunks = _prepare_prosodic_utterances(raw_chunks)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        msg = f"Falha ao ler chunks JSON: {exc}"
        _emit({"type": "error", "message": msg})
        print(msg, file=sys.stderr)
        return 2

    try:
        import torch  # type: ignore[import-not-found]
        import f5_tts  # type: ignore[import-not-found] # noqa: F401
    except ImportError as exc:
        msg = (
            "Pacote 'f5_tts' ou 'torch' não está instalado no venv isolado. "
            "Execute: uv run --no-sync python -m backend.workers.setup_tts_venv --engine f5_tts"
        )
        _emit({"type": "error", "message": msg, "detail": str(exc)})
        print(msg, file=sys.stderr)
        return 2

    use_cuda = args.device == "cuda" or (args.device == "auto" and bool(torch.cuda.is_available()))
    device_name = "cuda" if use_cuda else "cpu"
    _configure_cpu_acceleration(torch, device_name)
    nfe_steps = 32 if use_cuda else 14

    _emit({"type": "status", "message": f"Carregando F5-TTS ({args.language}) em {device_name}...", "device": device_name})
    f5 = _init_f5_engine(device_name=device_name, language=args.language)
    effective_ref_text = _resolve_or_cache_ref_text(voice_sample, args.ref_text)

    total = len(chunks)
    with tempfile.TemporaryDirectory(prefix="f5tts_chunks_") as tmp_dir:
        chunk_wavs: list[Path] = []
        for idx, item in enumerate(chunks, start=1):
            chunk_out = Path(tmp_dir) / f"chunk_{idx:03d}.wav"
            gen_text = item["text"].strip()
            if not gen_text:
                continue

            cached_wav = _chunk_cache_path(
                output_wav=output_wav,
                engine_tag="f5_tts_v2",
                voice_sample=voice_sample,
                language=args.language,
                clean_text=gen_text,
            )
            if cached_wav.is_file() and cached_wav.stat().st_size > 44:
                shutil.copy2(cached_wav, chunk_out)
            else:
                with torch.inference_mode():
                    f5.infer(
                        ref_file=str(voice_sample),
                        ref_text=effective_ref_text,
                        gen_text=gen_text,
                        nfe_step=nfe_steps,
                        file_wave=str(chunk_out),
                    )
                if chunk_out.is_file() and chunk_out.stat().st_size > 44:
                    try:
                        shutil.copy2(chunk_out, cached_wav)
                    except OSError:
                        pass

            chunk_wavs.append(chunk_out)
            pct = round((idx / total) * 100)
            _emit(
                {
                    "type": "progress",
                    "chunk": idx,
                    "total": total,
                    "pct": pct,
                    "segment_id": item["segment_id"],
                }
            )

        sample_rate_hz, duration_ms = _concat_wavs(chunk_wavs, output_wav, pause_ms=args.pause_ms)

    _emit(
        {
            "type": "done",
            "output": str(output_wav),
            "total_chunks": total,
            "sample_rate_hz": sample_rate_hz,
            "duration_ms": duration_ms,
        }
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
