"""Compositor Nível 1 (Playwright Virtual Time + CDP -> pipe FFmpeg, zero PNG em disco)."""

from __future__ import annotations

import base64
import functools
import http.server
import logging
import os
import socketserver
import subprocess
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from playwright.sync_api import Browser, Playwright, sync_playwright

from backend.core.cache import (
    ProjectCachePaths,
    compute_scene_cache_hash,
    get_project_cache,
    sha256_file,
    sha256_json,
)
from backend.core.config import StudioSettings, WORKSPACE_ROOT, get_settings, load_preset
from backend.core.storage import ProjectStorage
from backend.models.audio import AudioAlignment, WordTiming
from backend.models.preset import SceneStatus, StylePreset
from backend.models.scene import Scene
from backend.models.script import Script, ScriptureRef
from backend.services.alignment_service import (
    align_audio_to_script,
    resolve_scene_timings,
    tokenize_display_text,
)
from backend.services.audio_mixer_service import (
    ResolvedSfxCue,
    ensure_default_sfx_and_track,
    ensure_pilot_audio,
    mix_audio_single_pass,
)
from backend.services.qa_service import (
    TimingValidationReport,
    ensure_scene_thumbnail,
    generate_contact_sheet,
    inspect_video_ffprobe,
    validate_project_timing,
)

logger = logging.getLogger(__name__)

_WINDOWS_BROWSER_CANDIDATES: tuple[Path, ...] = (
    Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
    Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"),
    Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"),
)


@dataclass
class RenderResult:
    """Resultado completo de uma execução de renderização do projeto."""

    slug: str
    profile: str
    final_mp4: Path
    contact_sheet_jpg: Path
    mixed_audio_wav: Path
    scene_mp4s: dict[str, Path] = field(default_factory=dict)
    cache_hits: list[str] = field(default_factory=list)
    cache_misses: list[str] = field(default_factory=list)
    ffprobe_metrics: dict[str, Any] = field(default_factory=dict)
    timing_report: TimingValidationReport | None = None


class _SilentHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    """Handler HTTP estático sem poluir stdout/stderr."""

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        return


class _TemplatesHTTPServer:
    """Servidor HTTP efêmero em 127.0.0.1:0 para servir templates_video/ ao Chromium headless."""

    def __init__(self, directory: Path) -> None:
        self._directory = directory.resolve()
        self._httpd: socketserver.TCPServer | None = None
        self._thread: threading.Thread | None = None
        self.base_url: str = ""

    def __enter__(self) -> _TemplatesHTTPServer:
        if not self._directory.is_dir():
            raise FileNotFoundError(f"Diretório templates_video não encontrado: '{self._directory}'.")
        handler = functools.partial(_SilentHTTPRequestHandler, directory=str(self._directory))
        socketserver.TCPServer.allow_reuse_address = True
        self._httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
        port = self._httpd.server_address[1]
        self.base_url = f"http://127.0.0.1:{port}"
        self._thread = threading.Thread(target=self._httpd.serve_forever, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        if self._httpd is not None:
            self._httpd.shutdown()
            self._httpd.server_close()
            self._httpd = None
        if self._thread is not None:
            self._thread.join(timeout=2.0)
            self._thread = None


def _launch_headless_browser(pw: Playwright) -> Browser:
    """Inicia Chromium headless com fallback automático para Edge/Chrome instalados no Windows."""
    launch_args = [
        "--no-sandbox",
        "--disable-gpu-sandbox",
        "--disable-dev-shm-usage",
        "--autoplay-policy=no-user-gesture-required",
        "--font-render-hinting=none",
    ]
    attempts: list[str] = []

    # 1) Tenta Chromium padrão do Playwright e channels do sistema (msedge / chrome)
    for channel in (None, "msedge", "chrome"):
        try:
            kwargs: dict[str, Any] = {
                "headless": True,
                "args": launch_args,
                "timeout": 20_000,
            }
            if channel is not None:
                kwargs["channel"] = channel
            return pw.chromium.launch(**kwargs)
        except Exception as exc:  # noqa: BLE001 - erros heterogêneos do driver Playwright
            attempts.append(f"channel={channel or 'default'}: {exc}")

    # 2) Fallback direto para binários Edge/Chrome conhecidos no Windows
    for exe in _WINDOWS_BROWSER_CANDIDATES:
        if exe.is_file():
            try:
                return pw.chromium.launch(
                    headless=True,
                    executable_path=str(exe),
                    args=launch_args,
                    timeout=20_000,
                )
            except Exception as exc:  # noqa: BLE001
                attempts.append(f"exe={exe}: {exc}")

    joined = " | ".join(attempts)
    raise RuntimeError(
        "Não foi possível iniciar Chromium/Edge/Chrome headless via Playwright. "
        f"Tentativas: {joined}"
    )


def _profile_dimensions(preset: StylePreset, profile: str) -> tuple[int, int, int]:
    if profile == "preview":
        return (
            preset.video.preview_width,
            preset.video.preview_height,
            preset.video.preview_fps,
        )
    if profile == "final":
        return (preset.video.width, preset.video.height, preset.video.fps)
    raise ValueError(f"Perfil de render inválido: '{profile}'. Use 'preview' ou 'final'.")


def _templates_fingerprint(templates_dir: Path, template_name: str) -> str:
    """Calcula hash dos arquivos do motor/template para invalidar cache se HTML/CSS/JS mudar."""
    relevant_files = [
        templates_dir / "stage.html",
        templates_dir / "stage.css",
        templates_dir / "stage_engine.js",
        templates_dir / "templates" / f"{template_name}.js",
    ]
    hashes: dict[str, str] = {}
    for fpath in relevant_files:
        if fpath.is_file():
            hashes[fpath.name] = sha256_file(fpath)
    return sha256_json(hashes)


def _compute_asset_hashes(scene: Scene, cache: ProjectCachePaths) -> dict[str, str]:
    """Calcula apenas os digests SHA-256 dos assets existentes da cena (sem carregar base64)."""
    asset_hashes: dict[str, str] = {}
    for asset in scene.assets:
        if not asset.cache_relpath:
            continue
        asset_path = cache.resolve_relpath(asset.cache_relpath)
        if not asset_path.is_file():
            continue
        asset_hashes[asset.asset_id] = sha256_file(asset_path)
    return asset_hashes


def _load_asset_urls(scene: Scene, cache: ProjectCachePaths) -> tuple[dict[str, str], dict[str, str]]:
    """Carrega assets locais da cena em data URLs e retorna (asset_urls, asset_hashes)."""
    asset_urls: dict[str, str] = {}
    asset_hashes: dict[str, str] = {}
    for asset in scene.assets:
        if not asset.cache_relpath:
            continue
        asset_path = cache.resolve_relpath(asset.cache_relpath)
        if not asset_path.is_file():
            continue
        digest = sha256_file(asset_path)
        asset_hashes[asset.asset_id] = digest
        ext = asset_path.suffix.lower().lstrip(".")
        mime = "image/png" if ext == "png" else "image/jpeg" if ext in ("jpg", "jpeg") else "image/webp"
        b64 = base64.b64encode(asset_path.read_bytes()).decode("ascii")
        asset_urls[asset.asset_id] = f"data:{mime};base64,{b64}"
    return asset_urls, asset_hashes


def compute_expected_scene_hash(
    *,
    scene: Scene,
    alignment: AudioAlignment,
    script: Script,
    preset: StylePreset,
    cache: ProjectCachePaths,
    profile: str = "final",
    templates_dir: Path | None = None,
    preset_hash: str | None = None,
    template_fingerprints: dict[str, str] | None = None,
    asset_hashes: dict[str, str] | None = None,
) -> str:
    """Calcula o cache_hash determinístico esperado de uma cena (fonte única para render e detecção stale)."""
    t_dir = (templates_dir or (WORKSPACE_ROOT / "templates_video")).resolve()
    width, height, fps = _profile_dimensions(preset, profile)
    scene_words = alignment.get_word_range(scene.timing.start_word_id, scene.timing.end_word_id)
    scripture_ref = _resolve_scripture_ref(scene, script)
    effective_asset_hashes = asset_hashes if asset_hashes is not None else _compute_asset_hashes(scene, cache)
    effective_preset_hash = preset_hash or sha256_json(preset)

    audio_slice_hash = sha256_json(
        {
            "audio_sha256": alignment.audio_sha256,
            "words": [w.model_dump(mode="json") for w in scene_words],
            "profile": profile,
            "dimensions": [width, height, fps],
            "preset_hash": effective_preset_hash,
            "scripture_ref": scripture_ref.model_dump(mode="json") if scripture_ref else None,
        }
    )

    template_key = scene.template.value
    if template_fingerprints is not None and template_key in template_fingerprints:
        fingerprint = template_fingerprints[template_key]
    else:
        fingerprint = _templates_fingerprint(t_dir, template_key)
        if template_fingerprints is not None:
            template_fingerprints[template_key] = fingerprint

    template_ver = f"{scene.template_version}:{fingerprint[:12]}"
    return compute_scene_cache_hash(
        template_version=template_ver,
        scene_spec=scene,
        asset_hashes=effective_asset_hashes,
        audio_slice_hash=audio_slice_hash,
    )


def _resolve_scripture_ref(scene: Scene, script: Script) -> ScriptureRef | None:
    if scene.visual.scripture_ref_id:
        return script.get_scripture_ref(scene.visual.scripture_ref_id)
    if scene.template.value == "bible_quote_card" and script.scripture_refs:
        return script.scripture_refs[0]
    return None


def _compute_scene_frame_count(scene: Scene, fps: int) -> int:
    """Calcula número exato de frames usando fronteiras cumulativas para evitar drift A/V."""
    if scene.timing.resolved_start_ms is None or scene.timing.resolved_end_ms is None:
        raise ValueError(f"Cena '{scene.scene_id}' sem timing resolvido.")
    start_frame = int(round((scene.timing.resolved_start_ms / 1000.0) * fps))
    end_frame = int(round((scene.timing.resolved_end_ms / 1000.0) * fps))
    return max(1, end_frame - start_frame)


def _render_scene_with_page(
    *,
    page: Any,
    cdp: Any,
    stage_url: str,
    scene: Scene,
    preset: StylePreset,
    scene_words: list[WordTiming],
    scripture_ref: ScriptureRef | None,
    asset_urls: dict[str, str],
    format_type: str | None = None,
    captions_enabled: bool = True,
    width: int,
    height: int,
    fps: int,
    profile: str,
    output_mp4: Path,
) -> Path:
    """Renderiza uma cena frame a frame via Virtual Time + CDP direto para pipe do FFmpeg."""
    if scene.timing.resolved_start_ms is None or scene.timing.resolved_end_ms is None:
        raise ValueError(f"Cena '{scene.scene_id}' sem resolved_start_ms/resolved_end_ms.")

    duration_ms = scene.timing.resolved_end_ms - scene.timing.resolved_start_ms
    frame_count = _compute_scene_frame_count(scene, fps)

    if not page.url.startswith(stage_url):
        page.goto(stage_url, wait_until="load")
        page.wait_for_function("() => Boolean(window.__STUDIO__ && window.__STUDIO__.loadScene)")

    payload = {
        "scene": scene.model_dump(mode="json"),
        "preset": preset.model_dump(mode="json"),
        "words": [w.model_dump(mode="json") for w in scene_words],
        "duration_ms": duration_ms,
        "scene_start_ms": scene.timing.resolved_start_ms,
        "asset_urls": asset_urls,
        "show_safe_zones": False,
        "captions_enabled": captions_enabled,
        "format_type": format_type,
        "scripture_ref": scripture_ref.model_dump(mode="json") if scripture_ref else None,
    }
    page.evaluate("payload => window.__STUDIO__.loadScene(payload)", payload)

    output_mp4.parent.mkdir(parents=True, exist_ok=True)
    tmp_mp4 = output_mp4.with_suffix(".tmp.mp4")

    ffmpeg_cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "-framerate",
        str(fps),
        "-i",
        "pipe:0",
        "-vf",
        f"scale={width}:{height}:in_range=full:out_range=tv:flags=lanczos,format=yuv420p",
        "-r",
        str(fps),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast" if profile == "preview" else "medium",
        "-crf",
        "23" if profile == "preview" else "18",
        "-pix_fmt",
        "yuv420p",
        "-color_range",
        "tv",
        "-colorspace",
        "bt709",
        "-color_primaries",
        "bt709",
        "-color_trc",
        "bt709",
        "-an",
        str(tmp_mp4),
    ]

    proc = subprocess.Popen(
        ffmpeg_cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    assert proc.stdin is not None
    try:
        for frame_idx in range(frame_count):
            local_time_ms = (frame_idx / fps) * 1000.0
            page.evaluate("t => window.__STUDIO__.seek(t)", local_time_ms)
            shot = cdp.send("Page.captureScreenshot", {"format": "jpeg", "quality": 92})
            frame_bytes = base64.b64decode(shot["data"])
            proc.stdin.write(frame_bytes)
        proc.stdin.close()
    except BrokenPipeError as exc:
        stderr_out = proc.stderr.read().decode("utf-8", errors="replace") if proc.stderr else ""
        proc.wait(timeout=10)
        tmp_mp4.unlink(missing_ok=True)
        raise RuntimeError(
            f"Pipe FFmpeg interrompido ao renderizar '{scene.scene_id}': {stderr_out.strip()}"
        ) from exc
    except Exception:
        if proc.stdin and not proc.stdin.closed:
            proc.stdin.close()
        proc.terminate()
        proc.wait(timeout=10)
        tmp_mp4.unlink(missing_ok=True)
        raise

    stderr_bytes = proc.stderr.read() if proc.stderr else b""
    ret = proc.wait()
    if ret != 0:
        tmp_mp4.unlink(missing_ok=True)
        raise RuntimeError(
            f"FFmpeg falhou ao codificar '{scene.scene_id}' (exit={ret}): "
            f"{stderr_bytes.decode('utf-8', errors='replace').strip()}"
        )

    os.replace(tmp_mp4, output_mp4)
    return output_mp4


def render_scene_clip(
    scene: Scene,
    alignment: AudioAlignment,
    script: Script,
    preset: StylePreset,
    cache: ProjectCachePaths,
    *,
    profile: str = "final",
    templates_dir: Path | None = None,
    force: bool = False,
    format_type: str | None = None,
    captions_enabled: bool = True,
) -> tuple[Path, str, bool]:
    """Renderiza (ou recupera do cache SHA-256) o clipe MP4 isolado de uma cena e garante sua miniatura."""
    t_dir = (templates_dir or (WORKSPACE_ROOT / "templates_video")).resolve()
    width, height, fps = _profile_dimensions(preset, profile)
    scene_words = alignment.get_word_range(scene.timing.start_word_id, scene.timing.end_word_id)
    scripture_ref = _resolve_scripture_ref(scene, script)
    asset_urls, asset_hashes = _load_asset_urls(scene, cache)

    cache_hash = compute_expected_scene_hash(
        scene=scene,
        alignment=alignment,
        script=script,
        preset=preset,
        cache=cache,
        profile=profile,
        templates_dir=t_dir,
        asset_hashes=asset_hashes,
    )
    output_mp4 = cache.scene_video_path(scene.scene_id, profile=profile, cache_hash=cache_hash)
    thumb_path = cache.scene_thumb_path(scene.scene_id, cache_hash)
    if not force and output_mp4.is_file() and output_mp4.stat().st_size > 0:
        ensure_scene_thumbnail(output_mp4, thumb_path)
        return output_mp4, cache_hash, True

    with _TemplatesHTTPServer(t_dir) as server:
        stage_url = f"{server.base_url}/stage.html"
        with sync_playwright() as pw:
            browser = _launch_headless_browser(pw)
            try:
                context = browser.new_context(
                    viewport={"width": width, "height": height},
                    device_scale_factor=1,
                )
                page = context.new_page()
                cdp = context.new_cdp_session(page)
                _render_scene_with_page(
                    page=page,
                    cdp=cdp,
                    stage_url=stage_url,
                    scene=scene,
                    preset=preset,
                    scene_words=scene_words,
                    scripture_ref=scripture_ref,
                    asset_urls=asset_urls,
                    format_type=format_type,
                    captions_enabled=captions_enabled,
                    width=width,
                    height=height,
                    fps=fps,
                    profile=profile,
                    output_mp4=output_mp4,
                )
            finally:
                browser.close()

    ensure_scene_thumbnail(output_mp4, thumb_path, force=True)
    return output_mp4, cache_hash, False


def _concat_and_mux_final(
    scene_mp4s: list[Path],
    mixed_audio_wav: Path,
    final_mp4: Path,
    renders_dir: Path,
) -> Path:
    """Concatena clipes de cena via concat demuxer (-c copy) e muxa com áudio mixado."""
    renders_dir.mkdir(parents=True, exist_ok=True)
    concat_list = renders_dir / f".concat_{final_mp4.stem}.txt"
    concat_video = renders_dir / f".video_only_{final_mp4.stem}.mp4"
    tmp_final = final_mp4.with_suffix(".tmp.mp4")

    lines = [
        f"file '{mp4.resolve().as_posix()}'"
        for mp4 in scene_mp4s
    ]
    concat_list.write_text("\n".join(lines) + "\n", encoding="utf-8")

    try:
        proc_concat = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(concat_list),
                "-c",
                "copy",
                str(concat_video),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc_concat.returncode != 0:
            raise RuntimeError(
                f"FFmpeg concat falhou (exit={proc_concat.returncode}): {proc_concat.stderr.strip()}"
            )

        proc_mux = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(concat_video),
                "-i",
                str(mixed_audio_wav),
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-c:v",
                "copy",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-movflags",
                "+faststart",
                "-shortest",
                str(tmp_final),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if proc_mux.returncode != 0:
            raise RuntimeError(
                f"FFmpeg mux falhou (exit={proc_mux.returncode}): {proc_mux.stderr.strip()}"
            )
        os.replace(tmp_final, final_mp4)
        return final_mp4
    finally:
        concat_list.unlink(missing_ok=True)
        concat_video.unlink(missing_ok=True)
        tmp_final.unlink(missing_ok=True)


def render_project(
    slug: str,
    *,
    profile: str = "final",
    input_audio_path: Path | None = None,
    force: bool = False,
    settings: StudioSettings | None = None,
    storage: ProjectStorage | None = None,
    templates_dir: Path | None = None,
) -> RenderResult:
    """Executa o pipeline determinístico completo: áudio -> alinhamento -> cenas -> concat/mux -> QA."""
    cfg = settings or get_settings()
    store = storage or ProjectStorage(cfg.workspace_root / "projects")
    cache = get_project_cache(slug, cache_root=cfg.studio_cache_dir, ensure=True)
    t_dir = (templates_dir or (cfg.workspace_root / "templates_video")).resolve()

    manifest = store.load_manifest(slug)
    briefing = store.load_briefing(slug)
    script = store.load_script(slug)
    storyboard = store.load_storyboard(slug)
    preset = load_preset(
        manifest.preset_id,
        presets_dir=cfg.workspace_root / "config" / "style_presets",
    )

    # Checkpoint de Rigor Bíblico (AGENTS.md Regra 8)
    if not script.all_scripture_verified():
        raise ValueError(
            "Checkpoint de Rigor Bíblico reprovado: existem referências em scripture_refs[] "
            "com verified_by_human=False."
        )

    # 1) Áudio Primeiro ($0) + 2) Forced Alignment (reaproveita se já alinhado e inalterado)
    alignment: AudioAlignment | None = None
    narration_wav = cache.audio / "narration_master.wav"
    if (
        input_audio_path is None
        and not force
        and narration_wav.is_file()
        and narration_wav.stat().st_size > 0
        and store.exists(slug, "audio_alignment.json")
    ):
        existing_alignment = store.load_audio_alignment(slug)
        expected_pairs = [
            (seg.segment_id, tok)
            for seg in script.narration_segments
            for tok in tokenize_display_text(seg.display_text)
        ]
        actual_pairs = [(w.segment_id, w.text) for w in existing_alignment.words]
        if (
            sha256_file(narration_wav) == existing_alignment.audio_sha256
            and expected_pairs == actual_pairs
        ):
            alignment = existing_alignment

    if alignment is None:
        narration_wav, audio_mode = ensure_pilot_audio(
            script=script,
            cache_dir=cache.root,
            input_audio_path=input_audio_path,
            target_duration_sec=float(briefing.target_duration_sec),
        )
        alignment = align_audio_to_script(
            narration_wav,
            script,
            audio_source=audio_mode,
            audio_cache_relpath="audio/narration_master.wav",
            engine="auto",
        )
        store.save_audio_alignment(slug, alignment)

    raw_scenes = store.load_all_scenes(slug, storyboard=storyboard)
    resolved_scenes = resolve_scene_timings(raw_scenes, alignment)

    timing_report = validate_project_timing(resolved_scenes, alignment, preset)
    if not timing_report.ok:
        raise ValueError(
            "Falha na validação de timing do projeto: " + "; ".join(timing_report.errors)
        )

    # 3) SFX & Mixagem em Passo Único
    sfx_library, default_track = ensure_default_sfx_and_track(
        cache_dir=cache.root,
        workspace_root=cfg.workspace_root,
    )
    resolved_sfx_cues: list[ResolvedSfxCue] = []
    for scene in resolved_scenes:
        for cue in scene.sfx_cues:
            anchor = alignment.get_word(cue.anchor_word_id)
            sfx_path = sfx_library.get(cue.sfx_id)
            if sfx_path is None:
                # Fallback para SFX padrão de papel se ID customizado ainda não estiver na biblioteca
                sfx_path = sfx_library["paper_tear_01"]
            resolved_sfx_cues.append(
                ResolvedSfxCue(
                    sfx_id=cue.sfx_id,
                    path=sfx_path,
                    start_ms=max(0, anchor.start_ms + cue.offset_ms),
                    gain_db=cue.gain_db,
                )
            )

    music_track: Path | None = None
    if storyboard.music_enabled:
        if storyboard.music_track:
            ws_track = cfg.workspace_root / storyboard.music_track
            music_track = ws_track if ws_track.is_file() else default_track
        else:
            music_track = default_track

    mixed_audio_wav = cache.audio / "mixed_master.wav"
    mix_audio_single_pass(
        narration_wav=narration_wav,
        sfx_cues=resolved_sfx_cues,
        music_track=music_track,
        output_wav=mixed_audio_wav,
        preset=preset,
    )

    # 4) Render Nível 1 com cache granular SHA-256 (reutiliza 1 browser para todas as cenas em cache miss)
    width, height, fps = _profile_dimensions(preset, profile)
    scene_mp4s: dict[str, Path] = {}
    cache_hits: list[str] = []
    cache_misses: list[str] = []
    pending_renders: list[tuple[Scene, list[WordTiming], ScriptureRef | None, dict[str, str], Path, str]] = []
    updated_scenes: list[Scene] = []

    preset_hash = sha256_json(preset)
    template_fingerprints: dict[str, str] = {}

    for scene in resolved_scenes:
        scene_words = alignment.get_word_range(scene.timing.start_word_id, scene.timing.end_word_id)
        scripture_ref = _resolve_scripture_ref(scene, script)
        asset_urls, asset_hashes = _load_asset_urls(scene, cache)

        cache_hash = compute_expected_scene_hash(
            scene=scene,
            alignment=alignment,
            script=script,
            preset=preset,
            cache=cache,
            profile=profile,
            templates_dir=t_dir,
            preset_hash=preset_hash,
            template_fingerprints=template_fingerprints,
            asset_hashes=asset_hashes,
        )
        out_mp4 = cache.scene_video_path(scene.scene_id, profile=profile, cache_hash=cache_hash)
        scene_mp4s[scene.scene_id] = out_mp4

        if not force and out_mp4.is_file() and out_mp4.stat().st_size > 0:
            cache_hits.append(scene.scene_id)
        else:
            cache_misses.append(scene.scene_id)
            pending_renders.append((scene, scene_words, scripture_ref, asset_urls, out_mp4, cache_hash))

        updated_scenes.append(
            scene.model_copy(
                update={
                    "cache_hash": cache_hash,
                    "status": SceneStatus.RENDERED,
                }
            )
        )

    if pending_renders:
        with _TemplatesHTTPServer(t_dir) as server:
            stage_url = f"{server.base_url}/stage.html"
            with sync_playwright() as pw:
                browser = _launch_headless_browser(pw)
                try:
                    context = browser.new_context(
                        viewport={"width": width, "height": height},
                        device_scale_factor=1,
                    )
                    page = context.new_page()
                    cdp = context.new_cdp_session(page)
                    for scene, scene_words, scripture_ref, asset_urls, out_mp4, _ in pending_renders:
                        logger.info("Renderizando %s (%s %dx%d@%dfps)...", scene.scene_id, profile, width, height, fps)
                        _render_scene_with_page(
                            page=page,
                            cdp=cdp,
                            stage_url=stage_url,
                            scene=scene,
                            preset=preset,
                            scene_words=scene_words,
                            scripture_ref=scripture_ref,
                            asset_urls=asset_urls,
                            format_type=manifest.series.format_type.value,
                            captions_enabled=storyboard.captions_enabled,
                            width=width,
                            height=height,
                            fps=fps,
                            profile=profile,
                            output_mp4=out_mp4,
                        )
                finally:
                    browser.close()

    # Garante miniaturas reais 270x480 em STUDIO_CACHE_DIR/<slug>/thumbs/ para todas as cenas
    missed_set = set(cache_misses)
    for updated_scene in updated_scenes:
        mp4_path = scene_mp4s[updated_scene.scene_id]
        thumb_path = cache.scene_thumb_path(updated_scene.scene_id, updated_scene.cache_hash)
        ensure_scene_thumbnail(mp4_path, thumb_path, force=updated_scene.scene_id in missed_set)

    # Persiste cenas com timings resolvidos + cache_hash atualizado
    for updated_scene in updated_scenes:
        store.save_scene(slug, updated_scene)

    # 5) Concatenação -c copy + Mux Final
    ordered_scene_pairs = [(s.scene_id, scene_mp4s[s.scene_id]) for s in updated_scenes]
    final_mp4 = cache.final_video_path(profile=profile)
    _concat_and_mux_final(
        scene_mp4s=[p for _, p in ordered_scene_pairs],
        mixed_audio_wav=mixed_audio_wav,
        final_mp4=final_mp4,
        renders_dir=cache.renders,
    )

    # 6) QA Intermediário (ffprobe + Contact Sheet com Safe-Zones)
    metrics = inspect_video_ffprobe(final_mp4)
    contact_sheet_jpg = cache.contact_sheet_path(profile=profile)
    generate_contact_sheet(
        scene_mp4s=ordered_scene_pairs,
        output_jpg=contact_sheet_jpg,
        preset=preset,
        show_safe_zones=True,
    )

    # Atualiza gates no manifest.json
    updated_manifest = manifest.model_copy(
        update={
            "updated_at": datetime.now(timezone.utc).astimezone(),
            "gates": manifest.gates.model_copy(
                update={
                    "audio_aligned": True,
                    "qa_passed": bool(timing_report.ok and metrics["av_sync_diff_sec"] < 0.3),
                }
            ),
        }
    )
    store.save_manifest(slug, updated_manifest)

    return RenderResult(
        slug=slug,
        profile=profile,
        final_mp4=final_mp4,
        contact_sheet_jpg=contact_sheet_jpg,
        mixed_audio_wav=mixed_audio_wav,
        scene_mp4s=scene_mp4s,
        cache_hits=cache_hits,
        cache_misses=cache_misses,
        ffprobe_metrics=metrics,
        timing_report=timing_report,
    )
