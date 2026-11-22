"""Worker autônomo F5-TTS (Zero-Shot PT-BR) executado em subprocesso no venv isolado.

Invocado exclusivamente via TTS_VENV_PYTHON:
    python tts_f5_worker.py --chunks-json <path> --voice-sample <wav> --output <wav> --language pt
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import wave
from pathlib import Path
from typing import Any


def _emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def _load_chunks(chunks_json_path: Path) -> list[dict[str, str]]:
    if not chunks_json_path.is_file():
        raise FileNotFoundError(f"Arquivo de chunks não encontrado: {chunks_json_path}")
    raw = json.loads(chunks_json_path.read_text(encoding="utf-8"))
    items = raw.get("chunks", raw) if isinstance(raw, dict) else raw
    if not isinstance(items, list) or not items:
        raise ValueError("Lista de chunks vazia em --chunks-json.")

    normalized: list[dict[str, str]] = []
    for idx, entry in enumerate(items, start=1):
        if isinstance(entry, str):
            text = entry.strip()
            seg_id = f"chunk_{idx:02d}"
        elif isinstance(entry, dict):
            text = str(entry.get("normalized_text") or entry.get("text") or "").strip()
            seg_id = str(entry.get("segment_id") or f"chunk_{idx:02d}")
        else:
            continue
        if text:
            normalized.append({"segment_id": seg_id, "text": text})
    if not normalized:
        raise ValueError("Nenhum chunk com texto válido encontrado para síntese.")
    return normalized


def _concat_wavs(wav_paths: list[Path], output_wav: Path, pause_ms: int = 180) -> tuple[int, int]:
    if not wav_paths:
        raise ValueError("Nenhum WAV gerado para concatenação.")

    output_wav.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(wav_paths[0]), "rb") as first:
        nchannels = first.getnchannels()
        sampwidth = first.getsampwidth()
        framerate = first.getframerate()

    silence_frames = int(round((max(0, pause_ms) / 1000.0) * framerate))
    silence_bytes = b"\x00" * (silence_frames * nchannels * sampwidth)

    total_frames = 0
    with wave.open(str(output_wav), "wb") as out_wf:
        out_wf.setnchannels(nchannels)
        out_wf.setsampwidth(sampwidth)
        out_wf.setframerate(framerate)
        for idx, path in enumerate(wav_paths):
            with wave.open(str(path), "rb") as in_wf:
                if (
                    in_wf.getnchannels() != nchannels
                    or in_wf.getsampwidth() != sampwidth
                    or in_wf.getframerate() != framerate
                ):
                    raise ValueError(
                        f"Parâmetros WAV inconsistentes no chunk {idx + 1} ({path.name})."
                    )
                frames = in_wf.readframes(in_wf.getnframes())
                out_wf.writeframes(frames)
                total_frames += in_wf.getnframes()
            if idx < len(wav_paths) - 1 and silence_bytes:
                out_wf.writeframes(silence_bytes)
                total_frames += silence_frames

    duration_ms = max(1, int(round((total_frames / framerate) * 1000.0)))
    return framerate, duration_ms


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Worker isolado F5-TTS.")
    parser.add_argument("--chunks-json", required=True, help="JSON contendo os chunks normalizados.")
    parser.add_argument("--voice-sample", required=True, help="WAV de referência para clonagem zero-shot.")
    parser.add_argument("--output", required=True, help="Caminho de saída do WAV concatenado.")
    parser.add_argument("--language", default="pt", help="Idioma alvo (padrão: pt).")
    parser.add_argument("--ref-text", default="", help="Transcrição opcional da amostra de referência.")
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"], help="Dispositivo PyTorch.")
    parser.add_argument("--pause-ms", type=int, default=180, help="Pausa em ms entre chunks.")
    return parser.parse_args(argv)


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
        chunks = _load_chunks(chunks_path)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        msg = f"Falha ao ler chunks JSON: {exc}"
        _emit({"type": "error", "message": msg})
        print(msg, file=sys.stderr)
        return 2

    try:
        import torch  # type: ignore[import-not-found]
        from f5_tts.api import F5TTS  # type: ignore[import-not-found]
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

    _emit({"type": "status", "message": f"Carregando F5-TTS em {device_name}...", "device": device_name})
    f5 = F5TTS(device=device_name)

    total = len(chunks)
    with tempfile.TemporaryDirectory(prefix="f5tts_chunks_") as tmp_dir:
        chunk_wavs: list[Path] = []
        for idx, item in enumerate(chunks, start=1):
            chunk_out = Path(tmp_dir) / f"chunk_{idx:03d}.wav"
            f5.infer(
                ref_file=str(voice_sample),
                ref_text=args.ref_text,
                gen_text=item["text"],
                file_wave=str(chunk_out),
            )
            chunk_wavs.append(chunk_out)
            pct = int(round((idx / total) * 100))
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
