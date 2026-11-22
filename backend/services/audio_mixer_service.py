"""Geração/normalização de áudio piloto ($0), síntese de SFX táteis e mixagem FFmpeg em passo único."""

from __future__ import annotations

import logging
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from backend.models.preset import AudioMode, StylePreset
from backend.models.script import Script
from backend.services.alignment_service import normalize_biblical_text

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ResolvedSfxCue:
    """Cue de SFX já resolvido em milissegundos absolutos no vídeo."""

    sfx_id: str
    path: Path
    start_ms: int
    gain_db: float = -6.0


def _run_ffmpeg(args: list[str], context: str) -> subprocess.CompletedProcess[str]:
    """Executa FFmpeg em modo fail-fast verificando exit code."""
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        err = proc.stderr.strip() or "(sem stderr)"
        logger.error("Falha FFmpeg [%s] (code=%s): %s", context, proc.returncode, err)
        raise RuntimeError(f"FFmpeg falhou em '{context}' (exit={proc.returncode}): {err}")
    return proc


def _probe_wav_duration_sec(wav_path: Path) -> float:
    proc = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(wav_path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"ffprobe falhou ao medir '{wav_path}': {proc.stderr.strip()}")
    return float(proc.stdout.strip())


def _try_windows_sapi_tts(text: str, raw_wav_path: Path) -> bool:
    """Tenta sintetizar narração PT-BR via Windows SAPI (System.Speech) sem custo ($0)."""
    ps_script = r"""
param([string]$TextFile, [string]$OutWav)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$ptVoice = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'pt-*' } | Select-Object -First 1
if ($null -ne $ptVoice) {
    $synth.SelectVoice($ptVoice.VoiceInfo.Name)
}
$synth.Rate = 0
$synth.SetOutputToWaveFile($OutWav)
$content = Get-Content -LiteralPath $TextFile -Raw -Encoding UTF8
$synth.Speak($content)
$synth.Dispose()
"""
    with tempfile.TemporaryDirectory(prefix="studio_sapi_") as tmp_dir:
        txt_path = Path(tmp_dir) / "script_tts.txt"
        ps_path = Path(tmp_dir) / "speak.ps1"
        txt_path.write_text(text, encoding="utf-8-sig")
        ps_path.write_text(ps_script, encoding="utf-8-sig")
        proc = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(ps_path),
                "-TextFile",
                str(txt_path),
                "-OutWav",
                str(raw_wav_path),
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=90,
        )
        if proc.returncode != 0 or not raw_wav_path.exists() or raw_wav_path.stat().st_size < 4096:
            logger.info("Windows SAPI indisponível ou sem saída válida (%s); usando fallback sintético.", proc.stderr.strip())
            return False
        return True


def _synthesize_fallback_pilot_narration(output_wav: Path, duration_sec: float) -> None:
    """Gera faixa vocal piloto modulada em ~40s via FFmpeg lavfi (100% determinístico offline)."""
    dur = max(10.0, duration_sec)
    # Modulação formântica suave com cadência de frases (pausas naturais a cada ~4s) para acionar o ducking
    expr = (
        "0.22*(sin(2*PI*145*t)+0.55*sin(2*PI*290*t)+0.25*sin(2*PI*435*t))"
        "*(0.5+0.5*sin(2*PI*3.4*t))"
        "*between(mod(t,4.0),0.18,3.62)"
    )
    _run_ffmpeg(
        [
            "-f",
            "lavfi",
            "-i",
            f"aevalsrc='{expr}':s=48000:d={dur:.3f}",
            "-af",
            "highpass=f=90,lowpass=f=3400,afade=t=in:d=0.12,afade=t=out:st="
            f"{max(0.1, dur - 0.25):.3f}:d=0.25",
            "-ar",
            "48000",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            str(output_wav),
        ],
        context="synthesize_fallback_pilot_narration",
    )


def ensure_pilot_audio(
    script: Script,
    cache_dir: Path,
    input_audio_path: Path | None = None,
    target_duration_sec: float = 40.0,
) -> tuple[Path, AudioMode]:
    """Garante WAV 48kHz mono de narração no cache (gravação real ou piloto local $0)."""
    audio_dir = cache_dir / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)
    output_wav = audio_dir / "narration_master.wav"

    if input_audio_path is not None:
        if not input_audio_path.exists():
            raise FileNotFoundError(f"Áudio de entrada não encontrado: {input_audio_path}")
        _run_ffmpeg(
            [
                "-i",
                str(input_audio_path),
                "-ar",
                "48000",
                "-ac",
                "1",
                "-c:a",
                "pcm_s16le",
                str(output_wav),
            ],
            context="normalize_input_audio",
        )
        return output_wav, AudioMode.RECORDED

    full_tts_text = " ".join(
        normalize_biblical_text(seg.tts_text) for seg in script.narration_segments
    )
    sapi_raw = audio_dir / "_sapi_raw.wav"

    used_sapi = False
    try:
        used_sapi = _try_windows_sapi_tts(full_tts_text, sapi_raw)
    except (OSError, subprocess.SubprocessError) as exc:
        logger.info("Falha ao acionar SAPI (%s); usando áudio piloto calibrado.", exc)
        used_sapi = False

    if used_sapi:
        raw_dur = _probe_wav_duration_sec(sapi_raw)
        if raw_dur >= 0.5:
            filters = ["aresample=48000", "highpass=f=80"]
            if target_duration_sec <= 50.0 and raw_dur <= 75.0:
                if raw_dur < 36.0 or raw_dur > 46.0:
                    tempo = max(0.72, min(1.65, raw_dur / target_duration_sec))
                    filters.append(f"atempo={tempo:.4f}")
            elif raw_dur > 58.0:
                # Roteiros longos mantêm a voz real SAPI com cadência editorial ágil (sem descartar a fala!)
                filters.append("atempo=1.1800")
            _run_ffmpeg(
                [
                    "-i",
                    str(sapi_raw),
                    "-af",
                    ",".join(filters),
                    "-ar",
                    "48000",
                    "-ac",
                    "1",
                    "-c:a",
                    "pcm_s16le",
                    str(output_wav),
                ],
                context="normalize_sapi_audio",
            )
            sapi_raw.unlink(missing_ok=True)
            return output_wav, AudioMode.VOICESTUDIO
        sapi_raw.unlink(missing_ok=True)

    _synthesize_fallback_pilot_narration(output_wav, duration_sec=target_duration_sec)
    return output_wav, AudioMode.VOICESTUDIO


def ensure_default_sfx_and_track(
    cache_dir: Path,
    workspace_root: Path | None = None,
) -> tuple[dict[str, Path], Path]:
    """Garante SFX táteis editoriais e cama musical ambiente no cache (sem gravar mídia no OneDrive)."""
    sfx_cache_dir = cache_dir / "audio" / "sfx"
    tracks_cache_dir = cache_dir / "audio" / "tracks"
    sfx_cache_dir.mkdir(parents=True, exist_ok=True)
    tracks_cache_dir.mkdir(parents=True, exist_ok=True)

    sfx_specs: dict[str, list[str]] = {
        "paper_tear_01": [
            "-f",
            "lavfi",
            "-i",
            "anoisesrc=color=pink:amplitude=0.38:d=0.34",
            "-af",
            "bandpass=f=2400:width_type=q:w=1.1,afade=t=in:d=0.025,afade=t=out:st=0.14:d=0.20",
        ],
        "stamp_drop_01": [
            "-f",
            "lavfi",
            "-i",
            "aevalsrc='0.55*sin(2*PI*(120-70*t/0.22)*t)*exp(-14*t)+0.15*sin(2*PI*340*t)*exp(-30*t)':s=48000:d=0.24",
            "-af",
            "lowpass=f=600,afade=t=out:st=0.16:d=0.08",
        ],
        "page_flip_01": [
            "-f",
            "lavfi",
            "-i",
            "anoisesrc=color=white:amplitude=0.26:d=0.28",
            "-af",
            "bandpass=f=1600:width_type=q:w=0.9,afade=t=in:d=0.05,afade=t=out:st=0.12:d=0.16",
        ],
        "editorial_click_01": [
            "-f",
            "lavfi",
            "-i",
            "aevalsrc='0.45*sin(2*PI*920*t)*exp(-48*t)':s=48000:d=0.12",
            "-af",
            "highpass=f=300",
        ],
    }

    sfx_map: dict[str, Path] = {}
    for sfx_id, lavfi_args in sfx_specs.items():
        workspace_candidate: Path | None = None
        if workspace_root is not None:
            for ext in (".wav", ".mp3", ".ogg"):
                cand = workspace_root / "music" / "sfx" / f"{sfx_id}{ext}"
                if cand.exists():
                    workspace_candidate = cand
                    break
        if workspace_candidate is not None:
            sfx_map[sfx_id] = workspace_candidate
            continue

        cached_sfx = sfx_cache_dir / f"{sfx_id}.wav"
        if not cached_sfx.exists():
            _run_ffmpeg(
                [*lavfi_args, "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", str(cached_sfx)],
                context=f"synth_sfx_{sfx_id}",
            )
        sfx_map[sfx_id] = cached_sfx

    # Cama musical editorial contemplativa
    track_path: Path | None = None
    if workspace_root is not None:
        tracks_ws = workspace_root / "music" / "tracks"
        if tracks_ws.exists():
            for ext in ("*.wav", "*.mp3", "*.m4a", "*.ogg"):
                found = sorted(tracks_ws.glob(ext))
                if found:
                    track_path = found[0]
                    break

    if track_path is None:
        track_path = tracks_cache_dir / "editorial_contemplative_01.wav"
        if not track_path.exists():
            # Acorde ambiente quente em D menor / F maior contemplativo (48kHz stereo, 55s)
            pad_expr = (
                "0.11*(sin(2*PI*146.83*t)+0.8*sin(2*PI*220.0*t)"
                "+0.65*sin(2*PI*261.63*t)+0.45*sin(2*PI*329.63*t))"
                "*(0.82+0.18*sin(2*PI*0.18*t))"
            )
            _run_ffmpeg(
                [
                    "-f",
                    "lavfi",
                    "-i",
                    f"aevalsrc='{pad_expr}':s=48000:d=55.0",
                    "-af",
                    "lowpass=f=1200,afade=t=in:d=1.2,afade=t=out:st=53.0:d=2.0",
                    "-ar",
                    "48000",
                    "-ac",
                    "2",
                    "-c:a",
                    "pcm_s16le",
                    str(track_path),
                ],
                context="synth_default_music_track",
            )

    return sfx_map, track_path


def mix_audio_single_pass(
    narration_wav: Path,
    sfx_cues: list[ResolvedSfxCue],
    music_track: Path | None,
    output_wav: Path,
    preset: StylePreset,
) -> Path:
    """Mixagem em passo único: narração + SFX via adelay + cama musical com sidechaincompress + loudnorm -14 LUFS."""
    if not narration_wav.exists():
        raise FileNotFoundError(f"Narração não encontrada para mixagem: {narration_wav}")

    output_wav.parent.mkdir(parents=True, exist_ok=True)
    narration_duration = _probe_wav_duration_sec(narration_wav)

    inputs: list[str] = ["-i", str(narration_wav)]
    filter_parts: list[str] = []
    mix_labels: list[str] = ["[voice_main]"]

    has_music = music_track is not None and music_track.exists()
    if has_music:
        filter_parts.append(
            "[0:a]aformat=sample_rates=48000:channel_layouts=stereo,asplit=2[voice_main][voice_sc]"
        )
        inputs.extend(["-stream_loop", "-1", "-i", str(music_track)])
        music_idx = 1
        duck = preset.audio_mix.ducking
        base_gain_db = preset.audio_mix.music_base_gain_db
        filter_parts.append(
            f"[{music_idx}:a]atrim=duration={narration_duration:.3f},"
            f"aformat=sample_rates=48000:channel_layouts=stereo,"
            f"volume={base_gain_db:.2f}dB[music_base]"
        )
        filter_parts.append(
            f"[music_base][voice_sc]sidechaincompress="
            f"threshold={duck.threshold:.4f}:ratio={duck.ratio:.2f}:"
            f"attack={duck.attack_ms}:release={duck.release_ms}:makeup=1[music_ducked]"
        )
        mix_labels.append("[music_ducked]")
        next_input_idx = 2
    else:
        filter_parts.append("[0:a]aformat=sample_rates=48000:channel_layouts=stereo[voice_main]")
        next_input_idx = 1

    for cue_i, cue in enumerate(sfx_cues):
        if not cue.path.exists():
            raise FileNotFoundError(f"Arquivo de SFX ausente para '{cue.sfx_id}': {cue.path}")
        inputs.extend(["-i", str(cue.path)])
        delay_ms = max(0, cue.start_ms)
        label = f"[sfx_{cue_i}]"
        filter_parts.append(
            f"[{next_input_idx}:a]aformat=sample_rates=48000:channel_layouts=stereo,"
            f"volume={cue.gain_db:.2f}dB,adelay={delay_ms}|{delay_ms}{label}"
        )
        mix_labels.append(label)
        next_input_idx += 1

    mix_count = len(mix_labels)
    target_lufs = preset.audio_mix.target_lufs
    true_peak = preset.audio_mix.true_peak_dbtp

    if mix_count == 1:
        filter_parts.append(
            f"{mix_labels[0]}loudnorm=I={target_lufs:.1f}:TP={true_peak:.1f}:LRA=11[aout]"
        )
    else:
        filter_parts.append(
            f"{''.join(mix_labels)}amix=inputs={mix_count}:duration=first:dropout_transition=0:normalize=0,"
            f"loudnorm=I={target_lufs:.1f}:TP={true_peak:.1f}:LRA=11[aout]"
        )

    filter_complex = ";".join(filter_parts)
    _run_ffmpeg(
        [
            *inputs,
            "-filter_complex",
            filter_complex,
            "-map",
            "[aout]",
            "-t",
            f"{narration_duration:.3f}",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-c:a",
            "pcm_s16le",
            str(output_wav),
        ],
        context="mix_audio_single_pass",
    )
    return output_wav
