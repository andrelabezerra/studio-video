"""Normalização bíblica pré-TTS e alinhamento palavra-por-palavra (word_id-anchored)."""

from __future__ import annotations

import array
import hashlib
import importlib.util
import json
import logging
import math
import re
import subprocess
import tempfile
import wave
from collections.abc import Sequence
from pathlib import Path

from backend.models.audio import AudioAlignment, WordTiming
from backend.models.preset import AudioMode
from backend.models.scene import Scene
from backend.models.script import Script

logger = logging.getLogger(__name__)

# Abreviações bíblicas PT-BR (AT + NT) mapeadas para forma falada natural
_BIBLE_BOOKS: dict[str, str] = {
    "gn": "Gênesis",
    "ex": "Êxodo",
    "lv": "Levítico",
    "nm": "Números",
    "dt": "Deuteronômio",
    "js": "Josué",
    "jz": "Juízes",
    "rt": "Rute",
    "1sm": "Primeira Samuel",
    "2sm": "Segunda Samuel",
    "1rs": "Primeira Reis",
    "2rs": "Segunda Reis",
    "1cr": "Primeira Crônicas",
    "2cr": "Segunda Crônicas",
    "ed": "Esdras",
    "ne": "Neemias",
    "et": "Ester",
    "jó": "Jó",
    "jo": "João",
    "sl": "Salmos",
    "pv": "Provérbios",
    "ec": "Eclesiastes",
    "ct": "Cantares",
    "is": "Isaías",
    "jr": "Jeremias",
    "lm": "Lamentações",
    "ez": "Ezequiel",
    "dn": "Daniel",
    "os": "Oseias",
    "jl": "Joel",
    "am": "Amós",
    "ob": "Obadias",
    "jn": "Jonas",
    "mq": "Miqueias",
    "na": "Naum",
    "hc": "Habacuque",
    "sf": "Sofonias",
    "ag": "Ageu",
    "zc": "Zacarias",
    "ml": "Malaquias",
    "mt": "Mateus",
    "mc": "Marcos",
    "lc": "Lucas",
    "at": "Atos",
    "rm": "Romanos",
    "1co": "Primeira Coríntios",
    "2co": "Segunda Coríntios",
    "gl": "Gálatas",
    "ef": "Efésios",
    "fp": "Filipenses",
    "cl": "Colossenses",
    "1ts": "Primeira Tessalonicenses",
    "2ts": "Segunda Tessalonicenses",
    "1tm": "Primeira Timóteo",
    "2tm": "Segunda Timóteo",
    "tt": "Tito",
    "fm": "Filemom",
    "hb": "Hebreus",
    "tg": "Tiago",
    "1pe": "Primeira Pedro",
    "2pe": "Segunda Pedro",
    "1jo": "Primeira João",
    "2jo": "Segunda João",
    "3jo": "Terceira João",
    "jd": "Judas",
    "ap": "Apocalipse",
}

_FULL_BOOK_NAMES = sorted(set(_BIBLE_BOOKS.values()), key=len, reverse=True)
_BOOK_KEYS_SORTED = sorted(_BIBLE_BOOKS.keys(), key=len, reverse=True)

_BOOK_PATTERN = "|".join(
    [re.escape(k) for k in _BOOK_KEYS_SORTED] + [re.escape(v) for v in _FULL_BOOK_NAMES]
)

# Casa "Mt 5:3", "1Co 13:4-7", "1 Co 13:4–7", "Mateus 5:3", "Mt 5"
_SCRIPTURE_REF_RE = re.compile(
    rf"(?<!\w)(?P<prefix>[123]\s*)?(?P<book>{_BOOK_PATTERN})\.?\s+"
    rf"(?P<chapter>\d{{1,3}})(?::(?P<v_start>\d{{1,3}})(?:[-–](?P<v_end>\d{{1,3}}))?)?(?!\w)",
    re.IGNORECASE,
)

_UNITS = (
    "zero",
    "um",
    "dois",
    "três",
    "quatro",
    "cinco",
    "seis",
    "sete",
    "oito",
    "nove",
)
_TEENS = (
    "dez",
    "onze",
    "doze",
    "treze",
    "quatorze",
    "quinze",
    "dezesseis",
    "dezessete",
    "dezoito",
    "dezenove",
)
_TENS = (
    "",
    "",
    "vinte",
    "trinta",
    "quarenta",
    "cinquenta",
    "sessenta",
    "setenta",
    "oitenta",
    "noventa",
)
_HUNDREDS = (
    "",
    "cento",
    "duzentos",
    "trezentos",
    "quatrocentos",
    "quinhentos",
    "seiscentos",
    "setecentos",
    "oitocentos",
    "novecentos",
)

_EDGE_PUNCT = ".,!?;:\"'()[]{}«»—–…"
_VOWEL_GROUPS_RE = re.compile(r"[aeiouáàâãéêíóôõúü]+", re.IGNORECASE)


def number_to_pt_br(value: int) -> str:
    """Converte inteiros de 0 a 999 para extenso em português do Brasil."""
    if value < 0 or value > 999:
        return str(value)
    if value < 10:
        return _UNITS[value]
    if value < 20:
        return _TEENS[value - 10]
    if value == 100:
        return "cem"

    parts: list[str] = []
    hundreds = value // 100
    rem = value % 100
    if hundreds:
        parts.append(_HUNDREDS[hundreds])
    if rem:
        if rem < 10:
            parts.append(_UNITS[rem])
        elif rem < 20:
            parts.append(_TEENS[rem - 10])
        else:
            tens = rem // 10
            units = rem % 10
            if units:
                parts.append(f"{_TENS[tens]} e {_UNITS[units]}")
            else:
                parts.append(_TENS[tens])
    return " e ".join(parts)


def _expand_scripture_match(match: re.Match[str]) -> str:
    prefix = (match.group("prefix") or "").strip()
    raw_book = match.group("book")
    key = f"{prefix}{raw_book}".lower().replace(" ", "")

    if key in _BIBLE_BOOKS:
        book_name = _BIBLE_BOOKS[key]
    elif raw_book.lower() in _BIBLE_BOOKS and not prefix:
        book_name = _BIBLE_BOOKS[raw_book.lower()]
    else:
        ordinal_map = {"1": "Primeira", "2": "Segunda", "3": "Terceira"}
        normalized_book = raw_book[0].upper() + raw_book[1:]
        book_name = f"{ordinal_map[prefix]} {normalized_book}" if prefix in ordinal_map else normalized_book

    chapter = number_to_pt_br(int(match.group("chapter")))
    v_start_raw = match.group("v_start")
    v_end_raw = match.group("v_end")

    if v_start_raw and v_end_raw:
        v_start = number_to_pt_br(int(v_start_raw))
        v_end = number_to_pt_br(int(v_end_raw))
        return f"{book_name}, capítulo {chapter}, versículos {v_start} a {v_end}"
    if v_start_raw:
        v_start = number_to_pt_br(int(v_start_raw))
        return f"{book_name}, capítulo {chapter}, versículo {v_start}"
    return f"{book_name}, capítulo {chapter}"


def _split_long_sentence(sentence: str, max_chars: int) -> list[str]:
    cleaned = " ".join(sentence.split())
    if len(cleaned) <= max_chars:
        return [cleaned] if cleaned else []

    chunks: list[str] = []
    remaining = cleaned
    while len(remaining) > max_chars:
        window = remaining[: max_chars + 1]
        cut_idx = -1
        for sep in (". ", "! ", "? ", "; ", ": ", ", "):
            pos = window.rfind(sep)
            if pos >= max_chars // 3:
                cut_idx = pos + 1
                break
        if cut_idx == -1:
            pos = window.rfind(" ")
            cut_idx = pos if pos > 0 else max_chars
        chunk = remaining[:cut_idx].strip()
        if chunk:
            chunks.append(chunk)
        remaining = remaining[cut_idx:].strip()
    if remaining:
        chunks.append(remaining)
    return chunks


def normalize_biblical_text(text: str, max_chunk_chars: int = 180) -> str:
    """Expande referências bíblicas para leitura falada PT-BR e limita blocos a <= max_chunk_chars."""
    if max_chunk_chars < 20:
        raise ValueError("max_chunk_chars deve ser >= 20.")
    expanded = _SCRIPTURE_REF_RE.sub(_expand_scripture_match, text.strip())
    expanded = re.sub(r"\s+", " ", expanded).strip()
    if not expanded:
        return ""

    # Divide por sentenças preservando pontuação final
    raw_sentences = re.split(r"(?<=[.!?])\s+", expanded)
    chunks: list[str] = []
    for sentence in raw_sentences:
        chunks.extend(_split_long_sentence(sentence, max_chunk_chars))
    return "\n".join(chunks)


def split_tts_chunks(text: str, max_chunk_chars: int = 180) -> list[str]:
    """Expande referências bíblicas via normalize_biblical_text e devolve blocos prontos (<= max_chunk_chars)."""
    normalized = normalize_biblical_text(text, max_chunk_chars=max_chunk_chars)
    if not normalized:
        return []
    return [line.strip() for line in normalized.splitlines() if line.strip()]


def tokenize_display_text(text: str) -> list[str]:
    """Tokeniza texto de exibição em palavras limpas preservando hífens internos e referências como '5:3'."""
    tokens: list[str] = []
    for raw in text.split():
        cleaned = raw.strip(_EDGE_PUNCT)
        if cleaned:
            tokens.append(cleaned)
    return tokens


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(65536), b""):
            digest.update(block)
    return digest.hexdigest()


def _probe_audio_metadata(audio_path: Path) -> tuple[int, int]:
    """Retorna (sample_rate_hz, duration_ms) via wave ou ffprobe."""
    try:
        with wave.open(str(audio_path), "rb") as wf:
            sample_rate = wf.getframerate()
            frame_count = wf.getnframes()
            if sample_rate <= 0 or frame_count <= 0:
                raise ValueError(f"WAV vazio ou inválido: {audio_path}")
            duration_ms = max(1, int(round((frame_count / sample_rate) * 1000.0)))
            return sample_rate, duration_ms
    except wave.Error:
        proc = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "stream=sample_rate,duration:format=duration",
                "-of",
                "json",
                str(audio_path),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            raise RuntimeError(f"ffprobe falhou ao ler áudio '{audio_path}': {proc.stderr.strip()}")
        payload = json.loads(proc.stdout)
        streams = payload.get("streams") or []
        if not streams:
            raise ValueError(f"Nenhuma faixa de áudio encontrada em '{audio_path}'.")
        sample_rate = int(streams[0].get("sample_rate") or 48000)
        duration_sec = float(
            streams[0].get("duration") or payload.get("format", {}).get("duration") or 0.0
        )
        if duration_sec <= 0:
            raise ValueError(f"Duração de áudio inválida em '{audio_path}'.")
        return sample_rate, max(1, int(round(duration_sec * 1000.0)))


def _detect_speech_bounds_ms(audio_path: Path, duration_ms: int) -> tuple[int, int]:
    """Detecta início e fim efetivos da fala no WAV via energia RMS (janela de 20ms)."""
    try:
        with wave.open(str(audio_path), "rb") as wf:
            if wf.getsampwidth() != 2:
                return (0, duration_ms)
            sr = wf.getframerate()
            channels = wf.getnchannels()
            raw_bytes = wf.readframes(wf.getnframes())
    except wave.Error:
        return (0, duration_ms)

    samples = array.array("h")
    samples.frombytes(raw_bytes)
    if channels > 1:
        samples = samples[::channels]
    if not samples:
        return (0, duration_ms)

    win_size = max(1, int(sr * 0.02))  # 20ms
    rms_values: list[float] = []
    for i in range(0, len(samples), win_size):
        chunk = samples[i : i + win_size]
        if not chunk:
            continue
        mean_sq = sum(s * s for s in chunk) / len(chunk)
        rms_values.append(math.sqrt(mean_sq))

    peak_rms = max(rms_values) if rms_values else 0.0
    if peak_rms <= 1e-6:
        return (0, duration_ms)

    threshold = peak_rms * 0.06
    active_indices = [idx for idx, val in enumerate(rms_values) if val >= threshold]
    if not active_indices:
        return (0, duration_ms)

    start_ms = max(0, min(duration_ms - 100, active_indices[0] * 20))
    end_ms = min(duration_ms, max(start_ms + 100, (active_indices[-1] + 1) * 20))
    return (start_ms, end_ms)


def _estimate_word_weight(raw_token: str) -> tuple[float, float]:
    """Retorna (peso_fonético, peso_pausa_pós_palavra) para alinhamento determinístico."""
    clean = raw_token.strip(_EDGE_PUNCT)
    syllables = len(_VOWEL_GROUPS_RE.findall(clean))
    if syllables == 0:
        # Números como "5:3" levam mais tempo falado
        syllables = max(2, len(re.findall(r"\d+", clean)) * 2)
    base_weight = max(1.0, syllables * 1.15 + len(clean) * 0.14)

    pause_weight = 0.0
    if raw_token.endswith((".", "!", "?")):
        pause_weight = 1.65
    elif raw_token.endswith((",", ";", ":")):
        pause_weight = 0.75
    return base_weight, pause_weight


def _try_whisperx_align(
    audio_path: Path,
    script: Script,
    duration_ms: int,
) -> list[WordTiming] | None:
    """Tenta usar whisperx se instalado; retorna None se indisponível."""
    try:
        import whisperx  # type: ignore[import-not-found]
    except ImportError:
        return None

    logger.info("WhisperX detectado; executando forced alignment em %s.", audio_path.name)
    device = "cpu"
    model_a, metadata = whisperx.load_align_model(language_code="pt", device=device)
    audio = whisperx.load_audio(str(audio_path))
    segments_in = [
        {"text": seg.display_text, "start": 0.0, "end": duration_ms / 1000.0}
        for seg in script.narration_segments
    ]
    aligned = whisperx.align(segments_in, model_a, metadata, audio, device, return_char_alignments=False)
    word_entries: list[WordTiming] = []
    idx = 0
    for seg_model, seg_out in zip(script.narration_segments, aligned.get("segments", []), strict=False):
        for w in seg_out.get("words", []):
            text = str(w.get("word", "")).strip(_EDGE_PUNCT)
            if not text:
                continue
            idx += 1
            start_ms = max(0, min(duration_ms, int(round(float(w.get("start", 0.0)) * 1000))))
            end_ms = max(start_ms, min(duration_ms, int(round(float(w.get("end", start_ms / 1000.0)) * 1000))))
            word_entries.append(
                WordTiming(
                    word_id=f"w_{idx:04d}",
                    segment_id=seg_model.segment_id,
                    text=text,
                    start_ms=start_ms,
                    end_ms=end_ms,
                    confidence=float(w.get("score", 0.92)),
                )
            )
    return word_entries or None


def probe_venv_modules(
    venv_python: str | Path | None,
    modules: Sequence[str],
    *,
    timeout_sec: float = 8.0,
) -> dict[str, bool]:
    """Verifica quais módulos Python existem em um venv isolado (sem importar PyTorch no processo principal)."""
    result = {mod: False for mod in modules}
    if not venv_python or not modules:
        return result
    py_path = Path(str(venv_python)).expanduser()
    if not py_path.is_file():
        return result

    probe_code = (
        "import importlib.util, json, sys; "
        "mods = sys.argv[1:]; "
        "print(json.dumps({m: (importlib.util.find_spec(m) is not None) for m in mods}))"
    )
    try:
        proc = subprocess.run(
            [str(py_path), "-c", probe_code, *modules],
            capture_output=True,
            text=True,
            check=False,
            timeout=timeout_sec,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        logger.warning("Falha ao inspecionar módulos no venv TTS (%s): %s", py_path, exc)
        return result

    if proc.returncode != 0:
        return result

    try:
        parsed = json.loads(proc.stdout.strip().splitlines()[-1])
    except (IndexError, json.JSONDecodeError, TypeError):
        return result

    if isinstance(parsed, dict):
        for mod in modules:
            result[mod] = bool(parsed.get(mod, False))
    return result


def probe_isolated_alignment_engines(
    tts_venv_python: str | Path | None = None,
) -> dict[str, bool]:
    """Retorna disponibilidade das engines de alinhamento no processo atual ou no venv isolado."""
    in_proc_whisperx = importlib.util.find_spec("whisperx") is not None
    in_proc_stable = importlib.util.find_spec("stable_whisper") is not None

    venv_mods = probe_venv_modules(tts_venv_python, ("whisperx", "stable_whisper"))
    return {
        "deterministic_rms": True,
        "whisperx": in_proc_whisperx or venv_mods.get("whisperx", False),
        "stable_ts": in_proc_stable or venv_mods.get("stable_whisper", False),
    }


def _try_isolated_venv_align(
    engine_name: str,
    audio_path: Path,
    script: Script,
    duration_ms: int,
    tts_venv_python: str | Path | None,
    *,
    whisper_model: str = "medium",
    whisper_device: str = "auto",
) -> list[WordTiming] | None:
    """Executa forced alignment (whisperx ou stable_ts) via subprocesso no TTS_VENV_PYTHON isolado."""
    if not tts_venv_python:
        return None
    py_path = Path(str(tts_venv_python)).expanduser()
    if not py_path.is_file():
        return None

    required_module = "whisperx" if engine_name == "whisperx" else "stable_whisper"
    available = probe_venv_modules(py_path, (required_module,))
    if not available.get(required_module, False):
        return None

    worker_code = r"""
import json
import sys
from pathlib import Path

engine = sys.argv[1]
audio_path = sys.argv[2]
segments_path = Path(sys.argv[3])
out_path = Path(sys.argv[4])
duration_ms = int(sys.argv[5])
whisper_model = sys.argv[6]
whisper_device = sys.argv[7]

segments_in = json.loads(segments_path.read_text(encoding="utf-8"))
device = whisper_device
if device == "auto":
    try:
        import torch
        device = "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:
        device = "cpu"

words_out = []
if engine == "whisperx":
    import whisperx
    model_a, metadata = whisperx.load_align_model(language_code="pt", device=device)
    audio = whisperx.load_audio(audio_path)
    wx_segments = [
        {"text": seg["display_text"], "start": 0.0, "end": duration_ms / 1000.0}
        for seg in segments_in
    ]
    aligned = whisperx.align(wx_segments, model_a, metadata, audio, device, return_char_alignments=False)
    for seg_meta, seg_out in zip(segments_in, aligned.get("segments", [])):
        for w in seg_out.get("words", []):
            txt = str(w.get("word", "")).strip()
            if not txt:
                continue
            words_out.append({
                "segment_id": seg_meta["segment_id"],
                "text": txt,
                "start_ms": int(round(float(w.get("start", 0.0)) * 1000.0)),
                "end_ms": int(round(float(w.get("end", w.get("start", 0.0))) * 1000.0)),
                "confidence": float(w.get("score", 0.92)),
            })
elif engine == "stable_ts":
    import stable_whisper
    model = stable_whisper.load_model(whisper_model, device=device)
    full_text = " ".join(seg["display_text"] for seg in segments_in)
    result = model.align(audio_path, full_text, language="pt")
    flat_words = []
    for seg in result.segments:
        for w in seg.words:
            txt = str(w.word).strip()
            if txt:
                flat_words.append((txt, int(round(float(w.start) * 1000.0)), int(round(float(w.end) * 1000.0)), float(getattr(w, "probability", 0.92) or 0.92)))
    cursor = 0
    for seg_meta in segments_in:
        seg_tokens = [t for t in seg_meta["display_text"].split() if t.strip()]
        for _ in seg_tokens:
            if cursor >= len(flat_words):
                break
            txt, s_ms, e_ms, conf = flat_words[cursor]
            cursor += 1
            words_out.append({
                "segment_id": seg_meta["segment_id"],
                "text": txt,
                "start_ms": s_ms,
                "end_ms": e_ms,
                "confidence": conf,
            })
else:
    raise RuntimeError(f"Engine isolada desconhecida: {engine}")

out_path.write_text(json.dumps({"words": words_out}, ensure_ascii=False), encoding="utf-8")
"""

    with tempfile.TemporaryDirectory(prefix="studio_align_") as tmp_dir:
        tmp_path = Path(tmp_dir)
        segments_file = tmp_path / "segments.json"
        output_file = tmp_path / "aligned_words.json"
        segments_payload = [
            {
                "segment_id": seg.segment_id,
                "display_text": seg.display_text,
                "tts_text": normalize_biblical_text(seg.tts_text),
                "tts_chunks": split_tts_chunks(seg.tts_text),
            }
            for seg in script.narration_segments
        ]
        segments_file.write_text(json.dumps(segments_payload, ensure_ascii=False), encoding="utf-8")

        proc = subprocess.run(
            [
                str(py_path),
                "-c",
                worker_code,
                engine_name,
                str(audio_path),
                str(segments_file),
                str(output_file),
                str(duration_ms),
                whisper_model,
                whisper_device,
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=300,
        )
        if proc.returncode != 0 or not output_file.is_file():
            err = (proc.stderr or proc.stdout).strip()
            logger.warning("Alinhamento isolado (%s) falhou: %s", engine_name, err[:300])
            return None

        payload = json.loads(output_file.read_text(encoding="utf-8"))
        raw_words = payload.get("words") or []
        word_entries: list[WordTiming] = []
        prev_start = 0
        for idx, item in enumerate(raw_words, start=1):
            clean = str(item.get("text", "")).strip(_EDGE_PUNCT)
            if not clean:
                continue
            start_ms = max(prev_start, min(duration_ms, int(item.get("start_ms", prev_start))))
            end_ms = max(start_ms, min(duration_ms, int(item.get("end_ms", start_ms))))
            conf = max(0.0, min(1.0, float(item.get("confidence", 0.92))))
            word_entries.append(
                WordTiming(
                    word_id=f"w_{idx:04d}",
                    segment_id=str(item.get("segment_id") or script.narration_segments[0].segment_id),
                    text=clean,
                    start_ms=start_ms,
                    end_ms=end_ms,
                    confidence=conf,
                )
            )
            prev_start = start_ms
        return word_entries or None


def align_audio_to_script(
    audio_path: Path,
    script: Script,
    *,
    audio_source: AudioMode = AudioMode.RECORDED,
    audio_cache_relpath: str = "audio/narration_master.wav",
    engine: str = "auto",
    tts_venv_python: str | Path | None = None,
    whisper_model: str = "medium",
    whisper_device: str = "auto",
) -> AudioAlignment:
    """Alinha o áudio real ou piloto ao texto exato do script, gerando word_id sequenciais."""
    if not audio_path.exists():
        raise FileNotFoundError(f"Arquivo de áudio não encontrado para alinhamento: {audio_path}")

    sample_rate_hz, duration_ms = _probe_audio_metadata(audio_path)
    audio_sha256 = _sha256_file(audio_path)

    used_engine = "deterministic_energy_syllabic"
    words: list[WordTiming] | None = None

    if engine in ("auto", "whisperx"):
        words = _try_whisperx_align(audio_path, script, duration_ms)
        if words is not None:
            used_engine = "whisperx"
        elif tts_venv_python:
            words = _try_isolated_venv_align(
                "whisperx",
                audio_path,
                script,
                duration_ms,
                tts_venv_python,
                whisper_model=whisper_model,
                whisper_device=whisper_device,
            )
            if words is not None:
                used_engine = "whisperx"
        if words is None and engine == "whisperx":
            raise RuntimeError(
                "Engine 'whisperx' solicitada, mas whisperx não está instalado no ambiente nem no TTS_VENV_PYTHON."
            )

    if words is None and engine in ("auto", "stable_ts"):
        if tts_venv_python:
            words = _try_isolated_venv_align(
                "stable_ts",
                audio_path,
                script,
                duration_ms,
                tts_venv_python,
                whisper_model=whisper_model,
                whisper_device=whisper_device,
            )
            if words is not None:
                used_engine = "stable_ts"
        if words is None and engine == "stable_ts":
            raise RuntimeError(
                "Engine 'stable_ts' solicitada, mas stable-ts não está instalado no TTS_VENV_PYTHON."
            )

    if words is None:
        if engine not in ("auto", "deterministic", "deterministic_rms", "deterministic_energy_syllabic"):
            raise ValueError(f"Engine de alinhamento não suportada: '{engine}'.")

        speech_start_ms, speech_end_ms = _detect_speech_bounds_ms(audio_path, duration_ms)
        active_span_ms = max(100, speech_end_ms - speech_start_ms)

        token_specs: list[tuple[str, str, float, float]] = []
        for seg_idx, segment in enumerate(script.narration_segments):
            raw_tokens = segment.display_text.split()
            seg_clean_tokens = [(rt, rt.strip(_EDGE_PUNCT)) for rt in raw_tokens if rt.strip(_EDGE_PUNCT)]
            for tok_idx, (raw_tok, clean_tok) in enumerate(seg_clean_tokens):
                word_w, pause_w = _estimate_word_weight(raw_tok)
                # Pausa respiratória adicional entre segmentos
                if tok_idx == len(seg_clean_tokens) - 1 and seg_idx < len(script.narration_segments) - 1:
                    pause_w = max(pause_w, 1.35)
                token_specs.append((segment.segment_id, clean_tok, word_w, pause_w))

        if not token_specs:
            raise ValueError("Roteiro não possui palavras alinháveis em narration_segments[].")

        total_weight = sum(w + p for _, _, w, p in token_specs)
        cursor_weight = 0.0
        words = []
        prev_start = 0

        for idx, (segment_id, clean_tok, word_w, pause_w) in enumerate(token_specs, start=1):
            start_f = speech_start_ms + (cursor_weight / total_weight) * active_span_ms
            end_f = speech_start_ms + ((cursor_weight + word_w) / total_weight) * active_span_ms
            start_ms = max(prev_start, min(duration_ms, int(round(start_f))))
            end_ms = max(start_ms, min(duration_ms, int(round(end_f))))
            words.append(
                WordTiming(
                    word_id=f"w_{idx:04d}",
                    segment_id=segment_id,
                    text=clean_tok,
                    start_ms=start_ms,
                    end_ms=end_ms,
                    confidence=0.95,
                )
            )
            prev_start = start_ms
            cursor_weight += word_w + pause_w

    return AudioAlignment(
        audio_source=audio_source,
        audio_cache_relpath=audio_cache_relpath,
        audio_sha256=audio_sha256,
        sample_rate_hz=sample_rate_hz,
        duration_ms=duration_ms,
        alignment_engine=used_engine,
        words=words,
    )


def resolve_scene_timings(scenes: list[Scene], alignment: AudioAlignment) -> list[Scene]:
    """Resolve resolved_start_ms e resolved_end_ms de cada cena a partir de start_word_id/end_word_id.

    Garante cobertura contígua de 0 até alignment.duration_ms sem drift entre áudio e vídeo.
    """
    if not scenes:
        raise ValueError("Lista de cenas vazia; impossível resolver timings.")

    ordered = sorted(scenes, key=lambda s: s.order)
    word_spans: list[tuple[int, int]] = []
    for scene in ordered:
        start_w = alignment.get_word(scene.timing.start_word_id)
        end_w = alignment.get_word(scene.timing.end_word_id)
        # Valida ordem de índices no alinhamento
        alignment.get_word_range(scene.timing.start_word_id, scene.timing.end_word_id)
        word_spans.append((start_w.start_ms, end_w.end_ms))

    boundaries: list[int] = [0]
    for i in range(len(word_spans) - 1):
        prev_end = word_spans[i][1]
        next_start = word_spans[i + 1][0]
        cut_ms = int(round((prev_end + next_start) / 2.0)) if next_start >= prev_end else next_start
        cut_ms = max(boundaries[-1] + 1, min(alignment.duration_ms - 1, cut_ms))
        boundaries.append(cut_ms)
    boundaries.append(alignment.duration_ms)

    resolved_scenes: list[Scene] = []
    for idx, scene in enumerate(ordered):
        updated_timing = scene.timing.model_copy(
            update={
                "resolved_start_ms": boundaries[idx],
                "resolved_end_ms": boundaries[idx + 1],
            }
        )
        resolved_scenes.append(scene.model_copy(update={"timing": updated_timing}))

    return resolved_scenes
