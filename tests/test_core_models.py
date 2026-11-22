"""Testes unitários dos schemas Pydantic, config, cache e storage atômico."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest
from pydantic import ValidationError

from backend.core.cache import (
    compute_scene_cache_hash,
    get_project_cache,
    sha256_file,
    sha256_json,
)
from backend.core.config import (
    WORKSPACE_ROOT,
    load_preset,
    load_settings,
    mask_secret,
    resolve_cache_dir,
)
from backend.core.storage import ProjectStorage
from backend.models import (
    AudioAlignment,
    AudioMode,
    Briefing,
    CoverSpec,
    DistributionPack,
    FormatType,
    HookOption,
    HookType,
    HumanSealMode,
    ImageProvider,
    NarrationSegment,
    ProjectManifest,
    RecommendedFormat,
    ReviewPin,
    Scene,
    SceneAsset,
    SceneStatus,
    SceneTemplate,
    SceneTiming,
    SceneVisual,
    Script,
    ScriptureRef,
    SegmentRole,
    SeriesMetadata,
    SfxCue,
    Storyboard,
    TransitionIn,
    WordTiming,
)


def _sample_scene(*, resolved_start_ms: int | None = 2950, resolved_end_ms: int | None = 6420) -> Scene:
    return Scene(
        scene_id="scene_02",
        order=2,
        status=SceneStatus.DRAFT,
        tier=1,
        template=SceneTemplate.PAPER_COLLAGE,
        template_version="1.0.0",
        timing=SceneTiming(
            start_word_id="w_0010",
            end_word_id="w_0021",
            resolved_start_ms=resolved_start_ms,
            resolved_end_ms=resolved_end_ms,
        ),
        visual=SceneVisual(
            background_theme="pergaminho",
            headline="MAKÁRIOS",
            subtext="Grego · Mateus 5",
            highlight_word_ids=["w_0016"],
            transition_in=TransitionIn.PAPER_TEAR,
            camera_motion="subtle_zoom_in",
        ),
        assets=[
            SceneAsset(
                asset_id="img_pergaminho_grego",
                provider=ImageProvider.GEMINI_HYBRID,
                prompt="Editorial Vox style paper collage cutout",
                apply_rembg=True,
                cache_relpath="assets/scene_02_cutout.png",
            )
        ],
        sfx_cues=[
            SfxCue(
                sfx_id="paper_tear_01",
                anchor_word_id="w_0010",
                offset_ms=-60,
                gain_db=-6.0,
            )
        ],
        review_pins=[
            ReviewPin(
                pin_id="pin_01",
                x_pct=52.0,
                y_pct=38.5,
                time_ms=1200,
                note="Subir recorte 40px",
                resolved=False,
            )
        ],
        cost_usd=0.0,
    )


def test_load_preset_pastor_andre_biblico() -> None:
    preset = load_preset("pastor-andre-biblico")
    assert preset.preset_id == "pastor-andre-biblico"
    assert preset.video.width == 1080
    assert preset.video.height == 1920
    assert preset.video.fps == 30
    assert preset.safe_zones_px.content_box(1080, 1920) == (64, 220, 920, 1500)
    assert preset.palette.vox_gold == "#E5A93C"
    assert preset.cost_guardrails.tier2_video_enabled_by_default is False
    spec = preset.get_format_spec(FormatType.PERDIDO_TRADUCAO)
    assert spec.label == "Perdido na Tradução"


def test_load_preset_rejects_path_traversal() -> None:
    with pytest.raises(ValueError):
        load_preset("../pastor-andre-biblico")


def test_config_expands_localappdata_and_blocks_workspace_or_onedrive(tmp_path: Path) -> None:
    # Bloqueia explicitamente cache dentro do workspace
    with pytest.raises(ValueError, match="dentro do workspace"):
        resolve_cache_dir(str(WORKSPACE_ROOT / "cache_proibido"), create=False)

    # Bloqueia explicitamente caminho sob OneDrive
    fake_onedrive = Path("C:/Users/tester/OneDrive/StudioCache")
    with pytest.raises(ValueError, match="OneDrive"):
        resolve_cache_dir(str(fake_onedrive), create=False)

    # Permite explicitamente em teste quando allow_custom_cache=True
    allowed = resolve_cache_dir(str(tmp_path / "cache_ok"), allow_custom_cache=True)
    assert allowed.is_dir()

    # Expande variável de ambiente Windows (%CUSTOM_TEST_CACHE%)
    settings = load_settings(
        env_overrides={
            "STUDIO_CACHE_DIR": str(tmp_path / "expanded_cache"),
            "GEMINI_API_KEY": "AIzaSySecretTestValue123456",
            "OPENROUTER_API_KEY": "sk-or-v1-secret987654321",
            "FAL_KEY": "fal-secret-key-0001",
            "ENABLE_TIER2_VIDEO": "false",
        },
        allow_custom_cache=True,
    )
    assert settings.studio_cache_dir == (tmp_path / "expanded_cache").resolve()
    assert settings.studio_cache_dir.is_dir()

    # Garante mascaramento absoluto de segredos em repr/str/safe_summary
    rendered_repr = repr(settings)
    assert "AIzaSySecretTestValue123456" not in rendered_repr
    assert "sk-or-v1-secret987654321" not in rendered_repr
    assert "fal-secret-key-0001" not in rendered_repr
    assert "AIz***" in rendered_repr
    assert mask_secret(None) == "<unset>"
    assert mask_secret("short") == "***"


def test_config_rejects_unexpanded_windows_env_var() -> None:
    with pytest.raises(ValueError, match="não expandida"):
        resolve_cache_dir(r"%VAR_INEXISTENTE_XYZ%\StudioVideo", create=False)


def test_models_fail_fast_validation() -> None:
    # tier inválido
    with pytest.raises(ValidationError):
        Scene(
            scene_id="scene_01",
            order=1,
            tier=3,  # type: ignore[arg-type]
            template=SceneTemplate.KINETIC_CAPTIONS,
            timing=SceneTiming(start_word_id="w_0001", end_word_id="w_0002"),
            visual=SceneVisual(),
        )

    # tier=1 com template tier2_video
    with pytest.raises(ValidationError):
        Scene(
            scene_id="scene_01",
            order=1,
            tier=1,
            template=SceneTemplate.TIER2_VIDEO,
            timing=SceneTiming(start_word_id="w_0001", end_word_id="w_0002"),
            visual=SceneVisual(),
        )

    # start_ms > end_ms em WordTiming
    with pytest.raises(ValidationError):
        WordTiming(
            word_id="w_0001",
            segment_id="seg_01",
            text="Jesus",
            start_ms=500,
            end_ms=400,
        )

    # resolved_start_ms > resolved_end_ms em SceneTiming
    with pytest.raises(ValidationError):
        SceneTiming(
            start_word_id="w_0001",
            end_word_id="w_0005",
            resolved_start_ms=3000,
            resolved_end_ms=2500,
        )

    # Apenas um dos resolved_* preenchido
    with pytest.raises(ValidationError):
        SceneTiming(
            start_word_id="w_0001",
            end_word_id="w_0005",
            resolved_start_ms=1000,
            resolved_end_ms=None,
        )

    # selected_hook_id inexistente em Script
    with pytest.raises(ValidationError):
        Script(
            selected_hook_id="hook_99",
            hooks=[
                HookOption(
                    id="hook_1",
                    hook_type=HookType.TRADUCAO,
                    spoken_text="Texto curto",
                    visual_interrupt="Rasgo de papel",
                )
            ],
            narration_segments=[
                NarrationSegment(
                    segment_id="seg_01",
                    role=SegmentRole.HOOK,
                    display_text="Texto curto",
                    tts_text="Texto curto",
                )
            ],
            distribution_pack=DistributionPack(
                shorts_title="Título",
                caption_reels_tiktok="Legenda",
                cover_spec=CoverSpec(headline="CAPA"),
            ),
        )


def test_audio_alignment_helpers_and_monotonic_validation() -> None:
    alignment = AudioAlignment(
        audio_source=AudioMode.RECORDED,
        audio_cache_relpath="audio/narration_master.wav",
        audio_sha256="abc123",
        sample_rate_hz=48000,
        duration_ms=2000,
        alignment_engine="whisperx",
        words=[
            WordTiming(word_id="w_0001", segment_id="seg_01", text="Jesus", start_ms=100, end_ms=450),
            WordTiming(word_id="w_0002", segment_id="seg_01", text="não", start_ms=460, end_ms=650),
            WordTiming(word_id="w_0003", segment_id="seg_01", text="prometeu", start_ms=660, end_ms=1200),
        ],
    )
    assert alignment.get_word("w_0002").text == "não"
    sliced = alignment.get_word_range("w_0001", "w_0003")
    assert [w.word_id for w in sliced] == ["w_0001", "w_0002", "w_0003"]

    with pytest.raises(ValueError, match="invertido"):
        alignment.get_word_range("w_0003", "w_0001")

    with pytest.raises(ValidationError):
        AudioAlignment(
            audio_source=AudioMode.RECORDED,
            audio_cache_relpath="audio/narration_master.wav",
            audio_sha256="abc123",
            sample_rate_hz=48000,
            duration_ms=1000,
            alignment_engine="whisperx",
            words=[
                WordTiming(word_id="w_0001", segment_id="seg_01", text="A", start_ms=100, end_ms=1500),
            ],
        )


def test_cache_hashing_and_project_paths(tmp_path: Path) -> None:
    sample_file = tmp_path / "sample.bin"
    sample_file.write_bytes(b"studio-video-vox-biblico")
    file_hash = sha256_file(sample_file)
    assert len(file_hash) == 64

    assert sha256_json({"b": 2, "a": 1}) == sha256_json({"a": 1, "b": 2})

    scene = _sample_scene()
    h1 = compute_scene_cache_hash(
        "1.0.0", scene, {"img_pergaminho_grego": file_hash}, "audio-slice-hash-1"
    )
    # Alterar status ou review_pins não deve invalidar cache de render
    scene_approved = scene.model_copy(
        update={"status": SceneStatus.APPROVED, "cache_hash": h1, "review_pins": []}
    )
    h2 = compute_scene_cache_hash(
        "1.0.0", scene_approved, {"img_pergaminho_grego": file_hash}, "audio-slice-hash-1"
    )
    assert h1 == h2

    # Alterar headline deve invalidar cache
    scene_changed = scene.model_copy(
        update={"visual": scene.visual.model_copy(update={"headline": "NOVO TÍTULO"})}
    )
    h3 = compute_scene_cache_hash(
        "1.0.0", scene_changed, {"img_pergaminho_grego": file_hash}, "audio-slice-hash-1"
    )
    assert h3 != h1

    cache = get_project_cache("piloto-makarios", cache_root=tmp_path)
    assert cache.scenes.is_dir()
    assert cache.audio.is_dir()
    assert cache.assets.is_dir()
    assert cache.renders.is_dir()
    assert cache.qa.is_dir()
    assert cache.final_video_path().name == "final_9x16.mp4"
    assert cache.contact_sheet_path().name == "contact_sheet.jpg"

    with pytest.raises(ValueError, match="fora do diretório de cache"):
        cache.resolve_relpath("../../escape.txt")


def test_storage_atomic_roundtrip_all_contracts(tmp_path: Path) -> None:
    storage = ProjectStorage(projects_root=tmp_path / "projects")
    slug = "2026-11-perdido-traducao-makarios"
    now = datetime(2026, 11, 21, 17, 30, tzinfo=timezone.utc)

    manifest = ProjectManifest(
        slug=slug,
        title="O que Jesus realmente disse em 'Bem-aventurados'",
        created_at=now,
        updated_at=now,
        series=SeriesMetadata(
            series_id="perdido_traducao",
            format_type=FormatType.PERDIDO_TRADUCAO,
            episode_number=1,
            batch_id="retomada-lote-01",
        ),
    )
    briefing = Briefing(
        raw_idea="Explicar que bem-aventurado em Mateus 5 não é só felicidade passageira",
        seed_reference="Mt 5:3",
        bible_translation="NVI",
        target_duration_sec=42,
        audio_mode=AudioMode.RECORDED,
        human_seal_mode=HumanSealMode.PAPER_CUTOUT,
        recommended_format=RecommendedFormat(
            format_type=FormatType.PERDIDO_TRADUCAO,
            confidence=0.94,
            rationale="Gancho centrado no termo grego makarios.",
        ),
        selected_format_type=FormatType.PERDIDO_TRADUCAO,
    )
    script = Script(
        selected_hook_id="hook_2",
        hooks=[
            HookOption(
                id="hook_1",
                hook_type=HookType.TRADUCAO,
                spoken_text="Você sempre leu Mateus cinco do jeito errado.",
                visual_interrupt="Rasgo de papel revelando o texto grego.",
            ),
            HookOption(
                id="hook_2",
                hook_type=HookType.PARADOXO,
                spoken_text="Jesus não prometeu felicidade fácil em Mateus cinco.",
                visual_interrupt="Carimbo terracota sobre felicidade.",
            ),
        ],
        narration_segments=[
            NarrationSegment(
                segment_id="seg_01",
                role=SegmentRole.HOOK,
                display_text="Jesus não prometeu felicidade fácil em Mateus 5.",
                tts_text="Jesus não prometeu felicidade fácil em Mateus, capítulo cinco.",
            )
        ],
        scripture_refs=[
            ScriptureRef(
                ref_id="ref_01",
                citation="Mateus 5:3",
                translation="NVI",
                exact_text="Bem-aventurados os pobres em espírito, pois deles é o Reino dos céus.",
                verified_by_human=True,
            )
        ],
        distribution_pack=DistributionPack(
            shorts_title="O que Jesus realmente quis dizer com 'Bem-aventurados'?",
            caption_reels_tiktok="No grego original, makários muda tudo.",
            hashtags=["#pastorandrebezerra", "#estudobiblico"],
            pinned_comment="Texto base: Mateus 5:3 (NVI).",
            cover_spec=CoverSpec(
                headline="NÃO É SÓ FELICIDADE",
                subheadline="MATEUS 5 NO GREGO",
                highlight_word="FELICIDADE",
            ),
        ),
    )
    alignment = AudioAlignment(
        audio_source=AudioMode.RECORDED,
        audio_cache_relpath="audio/narration_master.wav",
        audio_sha256="e3b0c442",
        sample_rate_hz=48000,
        duration_ms=41280,
        alignment_engine="whisperx",
        words=[
            WordTiming(word_id="w_0010", segment_id="seg_01", text="Jesus", start_ms=2950, end_ms=3400),
            WordTiming(word_id="w_0021", segment_id="seg_01", text="makários", start_ms=5900, end_ms=6420),
        ],
    )
    scene_02 = _sample_scene()
    storyboard = Storyboard(
        fps=30,
        width=1080,
        height=1920,
        music_track="music/tracks/editorial_contemplative_01.mp3",
        scene_ids=["scene_02"],
    )

    storage.save_manifest(slug, manifest)
    storage.save_briefing(slug, briefing)
    storage.save_script(slug, script)
    storage.save_audio_alignment(slug, alignment)
    storage.save_storyboard(slug, storyboard)
    storage.save_scene(slug, scene_02)

    assert storage.list_projects() == [slug]
    assert storage.load_manifest(slug) == manifest
    assert storage.load_briefing(slug) == briefing
    assert storage.load_script(slug) == script
    assert storage.load_script(slug).all_scripture_verified() is True
    assert storage.load_audio_alignment(slug) == alignment
    assert storage.load_storyboard(slug) == storyboard
    assert storage.load_all_scenes(slug, storyboard=storyboard) == [scene_02]
    assert not list(storage.project_dir(slug).glob("*.tmp"))
