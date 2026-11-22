"""Worker autônomo XTTS-v2 (Zero-Shot PT-BR) executado em subprocesso no venv isolado.

Nunca deve ser importado no .venv principal para rodar inferência — apenas invocado via
TTS_VENV_PYTHON com:
    python tts_xtts_worker.py --chunks-json <path> --voice-sample <wav> --output <wav> --language pt
"""

from __future__ import annotations

import argparse
import array
import hashlib
import json
import math
import os
import re
import shutil
import sys
import tempfile
import wave
from pathlib import Path
from typing import Any

# Evita prompt interativo de TOS da Coqui em subprocesso headless e habilita checkpoint XTTS no PyTorch 2.6+
os.environ.setdefault("COQUI_TOS_AGREED", "1")
os.environ.setdefault("TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD", "1")

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?…])\s+")
_TERMINAL_PUNCT = (".", "!", "?", "…")


def _emit(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def _clean_text_for_xtts(text: str, language: str = "pt") -> str:
    """Limpa pontuação que causa leitura literal de 'ponto' no XTTS-v2 PT-BR mantendo prosódia natural."""
    cleaned = text.strip()
    if not cleaned:
        return ""

    # Remove aspas, parênteses e travessões que geram artefatos acústicos no XTTS
    for ch in ('"', "“", "”", "‘", "’", "'", "«", "»", "(", ")", "[", "]", "{", "}"):
        cleaned = cleaned.replace(ch, "")
    cleaned = re.sub(r"\s*[—–]\s*", ", ", cleaned)
    cleaned = re.sub(r"\.{2,}|…", ",", cleaned)

    # Dois-pontos e ponto-e-vírgula viram pausa curta de vírgula (evita falar 'dois pontos')
    cleaned = re.sub(r"\s*[:;]\s*", ", ", cleaned)

    # Preserva apenas '?' ou '!' final para entonação; remove TODOS os '.' para o XTTS nunca dizer "ponto"
    ends_question = cleaned.endswith("?")
    ends_exclamation = cleaned.endswith("!")

    # Pontos internos entre palavras viram vírgula; pontos finais são removidos
    cleaned = re.sub(r"\.\s+", ", ", cleaned)
    cleaned = cleaned.replace(".", "")
    cleaned = re.sub(r"[!?]+", "", cleaned)

    # Limpa vírgulas duplicadas ou nas bordas
    cleaned = re.sub(r"\s*,\s*", ", ", cleaned)
    cleaned = re.sub(r"(?:,\s*){2,}", ", ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" ,;:-")
    if not cleaned:
        return ""

    if ends_question:
        return f"{cleaned}?"
    if ends_exclamation:
        return f"{cleaned}!"
    if language.startswith("pt"):
        # Sem ponto final em PT-BR: o XTTS-v2 encerra naturalmente no token [STOP] sem falar "ponto"
        return cleaned
    return f"{cleaned}."


def _prepare_prosodic_utterances(
    chunks: list[dict[str, str]],
    max_chars: int = 168,
) -> list[dict[str, str]]:
    """Agrupa frases curtas e fragmentos quebrados em blocos prosódicos contínuos (<= max_chars).

    Reduz drasticamente o número de chamadas neurais em CPU (2-3x mais rápido) e dá fluidez
    humana contínua sem pontos finais que fariam o XTTS-v2 dizer 'ponto'.
    """
    # 1) Primeiro une fragmentos que foram cortados no meio de uma frase (sem pontuação final)
    sentences: list[dict[str, str]] = []
    for item in chunks:
        raw_text = " ".join(item["text"].split()).strip()
        if not raw_text:
            continue
        seg_id = item["segment_id"]
        if sentences and not sentences[-1]["text"].endswith(_TERMINAL_PUNCT):
            combined = f"{sentences[-1]['text']} {raw_text}".strip()
            if len(combined) <= max_chars + 20:
                sentences[-1]["text"] = combined
                sentences[-1]["segment_id"] = seg_id
                continue
        for part in _SENTENCE_SPLIT_RE.split(raw_text):
            p = part.strip()
            if p:
                sentences.append({"segment_id": seg_id, "text": p})

    # 2) Limpa cada sentença (removendo '.') e agrupa sentenças curtas consecutivas até max_chars
    utterances: list[dict[str, str]] = []
    for entry in sentences:
        cleaned = _clean_text_for_xtts(entry["text"])
        if not cleaned:
            continue
        if utterances:
            prev = utterances[-1]["text"]
            # Une com vírgula se a anterior não termina em ?/! ou com espaço se já termina em ?/!
            sep = " " if prev.endswith(("?", "!")) else ", "
            candidate = f"{prev}{sep}{cleaned}"
            if len(candidate) <= max_chars:
                utterances[-1]["text"] = candidate
                utterances[-1]["segment_id"] = entry["segment_id"]
                continue
        utterances.append({"segment_id": entry["segment_id"], "text": cleaned})

    return utterances or [
        {"segment_id": c["segment_id"], "text": _clean_text_for_xtts(c["text"]) or c["text"]}
        for c in chunks
    ]


def _configure_cpu_acceleration(torch_mod: Any, device_name: str) -> None:
    """Ativa otimizações de CPU (flush denormals + threads nos P-cores) para acelerar inferência sem perda de qualidade."""
    if device_name != "cpu":
        return
    try:
        torch_mod.set_flush_denormals(True)
    except Exception:
        pass
    try:
        logical = os.cpu_count() or 8
        # Em CPUs híbridas Intel (P-cores + E-cores), 6-8 threads evitam contenção nos E-cores
        optimal_threads = max(4, min(8, logical - 2))
        torch_mod.set_num_threads(optimal_threads)
    except Exception:
        pass


def _load_or_compute_xtts_latents(
    xtts_model: Any,
    voice_sample: Path,
    torch_mod: Any,
    device_name: str,
) -> tuple[Any, Any]:
    """Carrega do cache em disco ou calcula e salva (gpt_cond_latent, speaker_embedding) da amostra."""
    stat = voice_sample.stat()
    fingerprint = f"{voice_sample.name}:{stat.st_size}:{stat.st_mtime_ns}:v2"
    digest = hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()[:16]
    cache_file = voice_sample.parent / f".{voice_sample.stem}_{digest}.xtts_latents.pt"

    if cache_file.is_file():
        try:
            cached = torch_mod.load(str(cache_file), map_location=device_name, weights_only=True)
            if isinstance(cached, dict) and "gpt_cond_latent" in cached and "speaker_embedding" in cached:
                return (
                    cached["gpt_cond_latent"].to(device_name),
                    cached["speaker_embedding"].to(device_name),
                )
        except Exception:
            cache_file.unlink(missing_ok=True)

    with torch_mod.inference_mode():
        gpt_cond_latent, speaker_embedding = xtts_model.get_conditioning_latents(
            audio_path=[str(voice_sample)],
            gpt_cond_len=12,
            gpt_cond_chunk_len=4,
            max_ref_length=15,
            sound_norm_refs=True,
        )
    try:
        torch_mod.save(
            {
                "gpt_cond_latent": gpt_cond_latent.detach().cpu(),
                "speaker_embedding": speaker_embedding.detach().cpu(),
            },
            str(cache_file),
        )
    except Exception:
        pass
    return gpt_cond_latent, speaker_embedding


def _chunk_cache_path(
    output_wav: Path,
    engine_tag: str,
    voice_sample: Path,
    language: str,
    clean_text: str,
) -> Path:
    """Retorna caminho de cache SHA-256 por frase sintetizada (reuso instantâneo ao editar roteiro)."""
    st = voice_sample.stat()
    key = f"{engine_tag}|{voice_sample.name}:{st.st_size}:{st.st_mtime_ns}|{language}|{clean_text}"
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:24]
    cache_dir = output_wav.parent / "_tts_chunk_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir / f"{engine_tag}_{digest}.wav"


def _trim_and_fade_pcm16(
    raw_bytes: bytes,
    framerate: int,
    nchannels: int,
    sampwidth: int,
) -> bytes:
    """Remove silêncio morto nas bordas do chunk e aplica fade-in/out suave para fala contínua sem cliques."""
    if sampwidth != 2 or nchannels != 1 or len(raw_bytes) < framerate // 10:
        return raw_bytes

    samples = array.array("h")
    samples.frombytes(raw_bytes)
    n = len(samples)
    if n == 0:
        return raw_bytes

    win = max(1, framerate // 100)  # janela de 10ms
    rms_list: list[float] = []
    for i in range(0, n, win):
        block = samples[i : i + win]
        if not block:
            continue
        rms_list.append(math.sqrt(sum(s * s for s in block) / len(block)))

    peak = max(rms_list) if rms_list else 0.0
    if peak <= 50.0:
        return raw_bytes

    thresh = max(120.0, peak * 0.035)
    active = [idx for idx, val in enumerate(rms_list) if val >= thresh]
    if not active:
        return raw_bytes

    # Mantém 25ms de ataque natural antes da 1ª sílaba e 55ms de decaimento natural após a última sílaba
    lead_pad = round(0.025 * framerate)
    tail_pad = round(0.055 * framerate)
    start_sample = max(0, active[0] * win - lead_pad)
    end_sample = min(n, (active[-1] + 1) * win + tail_pad)
    if end_sample <= start_sample + (framerate // 12):
        trimmed = samples
    else:
        trimmed = samples[start_sample:end_sample]

    m = len(trimmed)
    fade_in = min(m // 4, round(0.012 * framerate))
    fade_out = min(m // 3, round(0.028 * framerate))
    for i in range(fade_in):
        gain = 0.5 * (1.0 - math.cos(math.pi * (i / max(1, fade_in))))
        trimmed[i] = round(trimmed[i] * gain)
    for i in range(fade_out):
        idx = m - fade_out + i
        gain = 0.5 * (1.0 + math.cos(math.pi * (i / max(1, fade_out))))
        trimmed[idx] = round(trimmed[idx] * gain)

    return trimmed.tobytes()


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


def _concat_wavs(wav_paths: list[Path], output_wav: Path, pause_ms: int = 110) -> tuple[int, int]:
    if not wav_paths:
        raise ValueError("Nenhum WAV gerado para concatenação.")

    output_wav.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(wav_paths[0]), "rb") as first:
        nchannels = first.getnchannels()
        sampwidth = first.getsampwidth()
        framerate = first.getframerate()

    silence_frames = round((max(0, pause_ms) / 1000.0) * framerate)
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
                raw_frames = in_wf.readframes(in_wf.getnframes())
                clean_frames = _trim_and_fade_pcm16(
                    raw_frames,
                    framerate=framerate,
                    nchannels=nchannels,
                    sampwidth=sampwidth,
                )
                out_wf.writeframes(clean_frames)
                total_frames += len(clean_frames) // (nchannels * sampwidth)
            if idx < len(wav_paths) - 1 and silence_bytes:
                out_wf.writeframes(silence_bytes)
                total_frames += silence_frames

    duration_ms = max(1, round((total_frames / framerate) * 1000.0))
    return framerate, duration_ms


def _write_float_wav(wav_samples: Any, output_path: Path, sample_rate: int = 24000) -> None:
    """Converte vetor float [-1.0, 1.0] retornado pelo XTTS para WAV PCM 16-bit mono."""
    if hasattr(wav_samples, "detach"):
        wav_samples = wav_samples.detach().cpu().numpy()
    if hasattr(wav_samples, "tolist"):
        flat = wav_samples.squeeze().tolist()
    else:
        flat = list(wav_samples)
    if isinstance(flat, float):
        flat = [flat]

    pcm = array.array("h", (max(-32767, min(32767, round(float(x) * 32767.0))) for x in flat))
    with wave.open(str(output_path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm.tobytes())


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Worker isolado XTTS-v2 (Coqui TTS).")
    parser.add_argument("--chunks-json", required=True, help="JSON contendo os chunks normalizados.")
    parser.add_argument("--voice-sample", required=True, help="WAV de referência para clonagem zero-shot.")
    parser.add_argument("--output", required=True, help="Caminho de saída do WAV concatenado.")
    parser.add_argument("--language", default="pt", help="Idioma alvo (padrão: pt).")
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"], help="Dispositivo PyTorch.")
    parser.add_argument("--pause-ms", type=int, default=110, help="Pausa em ms entre chunks.")
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
        raw_chunks = _load_chunks(chunks_path)
        chunks = _prepare_prosodic_utterances(raw_chunks)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        msg = f"Falha ao ler chunks JSON: {exc}"
        _emit({"type": "error", "message": msg})
        print(msg, file=sys.stderr)
        return 2

    try:
        import torch  # type: ignore[import-not-found]
        from TTS.api import TTS  # type: ignore[import-not-found]
    except ImportError as exc:
        msg = (
            "Pacote 'TTS' (Coqui XTTS-v2) ou 'torch' não está instalado no venv isolado. "
            "Execute: uv run --no-sync python -m backend.workers.setup_tts_venv --engine xtts_v2"
        )
        _emit({"type": "error", "message": msg, "detail": str(exc)})
        print(msg, file=sys.stderr)
        return 2

    use_cuda = args.device == "cuda" or (args.device == "auto" and bool(torch.cuda.is_available()))
    device_name = "cuda" if use_cuda else "cpu"
    _configure_cpu_acceleration(torch, device_name)

    _emit({"type": "status", "message": f"Carregando XTTS-v2 em {device_name}...", "device": device_name})
    tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device_name)

    synthesizer = getattr(tts, "synthesizer", None)
    xtts_model = getattr(synthesizer, "tts_model", None)
    gpt_cond_latent: Any = None
    speaker_embedding: Any = None

    if xtts_model is not None and hasattr(xtts_model, "get_conditioning_latents"):
        _emit({"type": "status", "message": "Carregando assinatura vocal da amostra (cache 12s)..."})
        gpt_cond_latent, speaker_embedding = _load_or_compute_xtts_latents(
            xtts_model=xtts_model,
            voice_sample=voice_sample,
            torch_mod=torch,
            device_name=device_name,
        )

    total = len(chunks)
    with tempfile.TemporaryDirectory(prefix="xtts_chunks_") as tmp_dir:
        chunk_wavs: list[Path] = []
        for idx, item in enumerate(chunks, start=1):
            chunk_out = Path(tmp_dir) / f"chunk_{idx:03d}.wav"
            clean_text = _clean_text_for_xtts(item["text"], language=args.language)
            if not clean_text:
                continue

            cached_wav = _chunk_cache_path(
                output_wav=output_wav,
                engine_tag="xtts_v2_v2",
                voice_sample=voice_sample,
                language=args.language,
                clean_text=clean_text,
            )
            if cached_wav.is_file() and cached_wav.stat().st_size > 44:
                shutil.copy2(cached_wav, chunk_out)
            else:
                if xtts_model is not None and gpt_cond_latent is not None and speaker_embedding is not None:
                    with torch.inference_mode():
                        out = xtts_model.inference(
                            text=clean_text,
                            language=args.language,
                            gpt_cond_latent=gpt_cond_latent,
                            speaker_embedding=speaker_embedding,
                            temperature=0.65,
                            length_penalty=1.0,
                            repetition_penalty=7.0,
                            top_k=50,
                            top_p=0.82,
                            speed=1.04,
                            enable_text_splitting=False,
                        )
                    out_sr = int(getattr(synthesizer, "output_sample_rate", 24000) or 24000)
                    _write_float_wav(out["wav"], chunk_out, sample_rate=out_sr)
                else:
                    tts.tts_to_file(
                        text=clean_text,
                        speaker_wav=str(voice_sample),
                        language=args.language,
                        file_path=str(chunk_out),
                        split_sentences=False,
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
