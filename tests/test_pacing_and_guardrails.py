"""Testes de regressão das lições aprendidas: agrupamento narrativo, multi-beats, anti-placeholder e QA de pacing."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest
from pydantic import ValidationError

from backend.core.cache import get_project_cache
from backend.core.config import load_preset
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
    NarrationSegment,
    ProjectManifest,
    RecommendedFormat,
    Scene,
    SceneBeat,
    SceneTemplate,
    SceneTiming,
    SceneVisual,
    Script,
    ScriptureRef,
    SegmentRole,
    SeriesMetadata,
    TransitionIn,
    WordTiming,
)
from backend.models.validation import find_placeholder_match, is_forbidden_bureaucratic_stamp
from backend.services.alignment_service import tokenize_display_text
from backend.services.cocreation_service import (
    _build_segments_from_ready_script,
    generate_storyboard_and_scenes,
)
from backend.services.compositor_service import render_scene_clip
from backend.services.qa_service import validate_project_content, validate_project_timing


def _build_parable_27_segments_script() -> tuple[ProjectManifest, Briefing, Script]:
    """Reproduz o cenário crítico real: 27 segmentos com fragmentos de 1–3 palavras (~236 palavras)."""
    raw_segments = [
        ("seg_01", SegmentRole.HOOK, "Imagine um homem que devia tanto dinheiro que jamais conseguiria pagar sua dívida."),
        ("seg_02", SegmentRole.BODY, "Ele foi levado diante do rei,"),
        ("seg_03", SegmentRole.BODY, "e o rei ordenou que tudo o que ele possuía fosse vendido para pagar o que"),
        ("seg_04", SegmentRole.BODY, "devia."),
        ("seg_05", SegmentRole.BODY, "Desesperado, aquele homem se ajoelhou e pediu misericórdia."),
        ("seg_06", SegmentRole.BODY, "E sabe o que o rei fez?"),
        ("seg_07", SegmentRole.BODY, "Perdoou toda a dívida!"),
        ("seg_08", SegmentRole.BODY, "Ele saiu dali livre."),
        ("seg_09", SegmentRole.BODY, "Sua dívida havia sido completamente cancelada."),
        ("seg_10", SegmentRole.PIVOT, "Mas, pouco depois, encontrou um homem que lhe devia uma pequena quantia."),
        ("seg_11", SegmentRole.BODY, "Aquele homem implorou, pediu paciência e prometeu pagar."),
        ("seg_12", SegmentRole.PIVOT, "Mas o homem que acabara de receber misericórdia agarrou seu companheiro pelo pescoço e mandou prendê-lo"),
        ("seg_13", SegmentRole.BODY, "até que pagasse tudo."),
        ("seg_14", SegmentRole.BODY, "Quando o rei soube disso, ficou indignado e perguntou:"),
        ("seg_15", SegmentRole.BODY, '"Eu não perdoei toda a sua dívida?'),
        ("seg_16", SegmentRole.BODY, 'Você não deveria ter tido misericórdia do seu companheiro, assim como eu tive de você?"'),
        ("seg_17", SegmentRole.BODY, "E existe uma pergunta que precisamos fazer:"),
        ("seg_18", SegmentRole.BODY, "Como alguém pode receber tanto perdão e oferecer tão pouco perdão?"),
        ("seg_19", SegmentRole.BODY, "Nós somos rápidos para lembrar o quanto fomos feridos,"),
        ("seg_20", SegmentRole.PIVOT, "mas será que nos lembramos do quanto fomos perdoados?"),
        ("seg_21", SegmentRole.BODY, "Não podemos querer viver debaixo da misericórdia de Deus enquanto tratamos as pessoas apenas com a"),
        ("seg_22", SegmentRole.BODY, "lógica da cobrança."),
        ("seg_23", SegmentRole.BODY, "Quem compreendeu o tamanho da graça que recebeu não pode continuar vivendo como se nunca tivesse"),
        ("seg_24", SegmentRole.BODY, "precisado dela."),
        ("seg_25", SegmentRole.BODY, "Você não precisa fingir que não foi ferido."),
        ("seg_26", SegmentRole.APPLICATION, "Mas precisa permitir que o perdão que recebeu de Cristo transforme a maneira como lida com"),
        ("seg_27", SegmentRole.APPLICATION, "quem feriu você."),
    ]
    now = datetime(2026, 11, 22, 12, 0, tzinfo=timezone.utc)
    manifest = ProjectManifest(
        slug="parabola-perdao-teste",
        title="Você foi perdoado, mas consegue perdoar?",
        created_at=now,
        updated_at=now,
        series=SeriesMetadata(
            series_id="conexao_at_nt",
            format_type=FormatType.CONEXAO_AT_NT,
            episode_number=1,
        ),
    )
    briefing = Briefing(
        raw_idea=" ".join(text for _, _, text in raw_segments),
        seed_reference="Mateus 18:21–35",
        bible_translation="NVI",
        target_duration_sec=75,
        audio_mode=AudioMode.RECORDED,
        human_seal_mode=HumanSealMode.PAPER_CUTOUT,
        recommended_format=RecommendedFormat(
            format_type=FormatType.CONEXAO_AT_NT,
            confidence=0.9,
            rationale="Parábola bíblica de perdão.",
        ),
        selected_format_type=FormatType.CONEXAO_AT_NT,
    )
    script = Script(
        selected_hook_id="hook_1",
        hooks=[
            HookOption(
                id="hook_1",
                hook_type=HookType.PARADOXO,
                spoken_text="Você foi perdoado, mas consegue perdoar?",
                visual_interrupt="Contador de dívida impagável em fundo carvão.",
            )
        ],
        narration_segments=[
            NarrationSegment(segment_id=sid, role=role, display_text=txt, tts_text=txt)
            for sid, role, txt in raw_segments
        ],
        scripture_refs=[
            ScriptureRef(
                ref_id="ref_01",
                citation="Mateus 18:32–33",
                translation="NVI",
                exact_text=(
                    "Servo mau, cancelei toda a sua dívida porque você me implorou. "
                    "Você não devia ter tido misericórdia do seu conservo como eu tive de você?"
                ),
                verified_by_human=True,
            )
        ],
        distribution_pack=DistributionPack(
            shorts_title="Você foi perdoado, mas consegue perdoar?",
            caption_reels_tiktok="A parábola do credor incompassivo em Mateus 18.",
            hashtags=["#pastorandrebezerra", "#mateus18"],
            pinned_comment="Texto base: Mateus 18:21–35.",
            cover_spec=CoverSpec(headline="PERDOADO PARA PERDOAR", highlight_word="PERDOAR"),
        ),
    )
    return manifest, briefing, script


def _build_synthetic_alignment(script: Script, *, total_ms: int = 80_000) -> AudioAlignment:
    words: list[WordTiming] = []
    tokens_all = [
        (seg.segment_id, tok)
        for seg in script.narration_segments
        for tok in tokenize_display_text(seg.display_text)
    ]
    step = total_ms / len(tokens_all)
    for idx, (seg_id, tok) in enumerate(tokens_all, start=1):
        start_ms = int(round((idx - 1) * step))
        end_ms = max(start_ms + 10, int(round(idx * step)) - 10)
        end_ms = min(total_ms, end_ms)
        words.append(
            WordTiming(
                word_id=f"w_{idx:04d}",
                segment_id=seg_id,
                text=tok,
                start_ms=start_ms,
                end_ms=end_ms,
                confidence=0.98,
            )
        )
    return AudioAlignment(
        audio_source=AudioMode.RECORDED,
        audio_cache_relpath="audio/narration_master.wav",
        audio_sha256="deadbeef",
        sample_rate_hz=48000,
        duration_ms=total_ms,
        alignment_engine="deterministic",
        words=words,
    )


def test_ready_script_segmentation_eliminates_orphan_fragments() -> None:
    parable = (
        "Imagine um homem que devia tanto dinheiro que jamais conseguiria pagar sua dívida. "
        "Ele foi levado diante do rei, e o rei ordenou que tudo o que ele possuía fosse vendido para pagar o que devia. "
        "Desesperado, aquele homem se ajoelhou e pediu misericórdia. "
        "E sabe o que o rei fez? Perdoou toda a dívida! Ele saiu dali livre. "
        "Não podemos querer viver debaixo da misericórdia de Deus enquanto tratamos as pessoas apenas com a lógica da cobrança."
    )
    segments = _build_segments_from_ready_script(parable)
    assert len(segments) >= 4
    # Nenhum segmento órfão de 1–3 palavras
    for _, _, text in segments:
        assert len(text.split()) >= 5, f"Segmento órfão encontrado: '{text}'"


def test_storyboard_groups_27_segments_into_fluid_multibeat_scenes() -> None:
    preset = load_preset("pastor-andre-biblico")
    manifest, briefing, script = _build_parable_27_segments_script()

    storyboard, scenes = generate_storyboard_and_scenes(
        manifest=manifest,
        briefing=briefing,
        script=script,
        preset=preset,
    )

    # Meta permanente: ~10–14 cenas fluidas (metade das 27 originais)
    assert 10 <= len(scenes) <= 14
    assert storyboard.scene_ids == [s.scene_id for s in scenes]

    # Cobertura contígua 100% das palavras e zero micro-cenas (< 6 palavras)
    alignment = _build_synthetic_alignment(script, total_ms=80_000)
    word_index = {w.word_id: i for i, w in enumerate(alignment.words)}
    assert scenes[0].timing.start_word_id == "w_0001"
    assert scenes[-1].timing.end_word_id == f"w_{len(alignment.words):04d}"

    expected_cursor = 0
    for scene in scenes:
        s_idx = word_index[scene.timing.start_word_id]
        e_idx = word_index[scene.timing.end_word_id]
        assert s_idx == expected_cursor
        word_count = e_idx - s_idx + 1
        assert word_count >= 6, f"{scene.scene_id} tem apenas {word_count} palavras"
        expected_cursor = e_idx + 1

        # Cada cena fluida precisa de beats internos ancorados no seu próprio intervalo
        assert len(scene.visual.beats) >= 2, f"{scene.scene_id} sem beats[] multi-beat"
        for beat in scene.visual.beats:
            assert beat.anchor_word_id is not None
            b_idx = word_index[beat.anchor_word_id]
            assert s_idx <= b_idx <= e_idx

        # Zero selo burocrático
        assert not is_forbidden_bureaucratic_stamp(scene.visual.stamp_text)

    # Verifica uso do novo motor editorial_motion com composições variadas
    assert any(s.template == SceneTemplate.EDITORIAL_MOTION for s in scenes)
    compositions = {s.visual.composition for s in scenes if s.template == SceneTemplate.EDITORIAL_MOTION}
    assert len(compositions) >= 4

    # Validação de QA aprova o storyboard agrupado com zero erros
    from backend.services.alignment_service import resolve_scene_timings

    resolved = resolve_scene_timings(scenes, alignment)
    report = validate_project_timing(resolved, alignment, preset, script=script)
    assert report.ok, f"Erros inesperados no QA: {report.errors}"
    assert report.pacing_summary["scene_count"] == len(scenes)
    assert report.pacing_summary["beats_total"] >= len(scenes) * 2
    assert report.pacing_summary["micro_scene_ids"] == []


def test_fail_fast_anti_placeholder_and_ptbr_todo_no_false_positive(tmp_path: Path) -> None:
    # 1) Palavra comum PT-BR "todo"/"TODO" em contexto editorial NÃO deve disparar falso positivo
    assert find_placeholder_match("PERDOOU TODO O DÉBITO") is None
    assert find_placeholder_match("Em todo tempo o Senhor é fiel.") is None
    assert find_placeholder_match("De todo o teu coração.") is None

    # 2) Placeholders reais devem ser detectados imediatamente
    for bad in (
        "[Conferir texto exato de Mateus 18:21–35 (KJA) antes da aprovação do Gate 1.]",
        "[TODO: preencher versículo]",
        "TODO: revisar texto antes de publicar",
        "Texto com TBD pendente",
        "[Inserir citação bíblica]",
        "{{headline_placeholder}}",
        "Lorem ipsum dolor sit amet",
    ):
        assert find_placeholder_match(bad) is not None, f"Deveria bloquear: {bad}"

    # 3) ScriptureRef com verified_by_human=True + placeholder -> ValidationError Fail-Fast
    with pytest.raises(ValidationError, match="Placeholder proibido"):
        ScriptureRef(
            ref_id="ref_01",
            citation="Mateus 18:21–35",
            translation="KJA",
            exact_text="[Conferir texto exato de Mateus 18:21–35 (KJA) antes da aprovação do Gate 1.]",
            verified_by_human=True,
        )

    # Em rascunho (verified_by_human=False) pode existir antes da revisão humana,
    # mas all_scripture_verified() retorna False e validate_project_content bloqueia!
    draft_ref = ScriptureRef(
        ref_id="ref_01",
        citation="Mateus 18:21–35",
        translation="KJA",
        exact_text="[Conferir texto exato de Mateus 18:21–35 (KJA) antes da aprovação do Gate 1.]",
        verified_by_human=False,
    )
    assert draft_ref.verified_by_human is False

    # 4) SceneVisual rejeita placeholders em headline, subtext, beats e motion_data
    with pytest.raises(ValidationError, match="Placeholder proibido"):
        SceneVisual(headline="[Conferir título]")

    with pytest.raises(ValidationError, match="Placeholder proibido"):
        SceneVisual(
            headline="PERDÃO REAL",
            motion_data={"quote_body": "[Conferir texto exato de Mateus 18]"},
        )

    with pytest.raises(ValidationError, match="Placeholder proibido"):
        SceneVisual(
            headline="PERDÃO REAL",
            beats=[SceneBeat(beat_id="b1", progress=0.5, headline="TODO: escrever beat")],
        )

    # 5) Selo burocrático "TEXTO VERIFICADO" é proibido no schema
    with pytest.raises(ValidationError, match="Selo burocrático proibido"):
        SceneVisual(headline="MATEUS 18", stamp_text="TEXTO VERIFICADO")

    # 6) Compositor bloqueia Fail-Fast se script.scripture_refs ainda tiver placeholder
    _, _, clean_script = _build_parable_27_segments_script()
    dirty_script = clean_script.model_copy(update={"scripture_refs": [draft_ref]})
    alignment = _build_synthetic_alignment(dirty_script, total_ms=80_000)
    preset = load_preset("pastor-andre-biblico")
    scene = Scene(
        scene_id="scene_01",
        order=1,
        tier=1,
        template=SceneTemplate.EDITORIAL_MOTION,
        timing=SceneTiming(
            start_word_id="w_0001",
            end_word_id="w_0015",
            resolved_start_ms=0,
            resolved_end_ms=5000,
        ),
        visual=SceneVisual(headline="PERDOOU TODO O DÉBITO", composition="forgiveness_seal"),
    )
    assert len(validate_project_content(dirty_script, [scene])) >= 1
    cache = get_project_cache("dirty-check", cache_root=tmp_path, ensure=True)
    with pytest.raises(ValueError, match="Placeholder proibido"):
        render_scene_clip(scene, alignment, dirty_script, preset, cache, profile="preview")


def test_multibeat_schema_and_qa_pacing_checks() -> None:
    preset = load_preset("pastor-andre-biblico")

    # Valida novos enums (editorial_motion + novas TransitionIn + SceneBeat + motion_data)
    rich_scene = Scene(
        scene_id="scene_01",
        order=1,
        tier=1,
        template=SceneTemplate.EDITORIAL_MOTION,
        template_version="2.0.0",
        timing=SceneTiming(
            start_word_id="w_0001",
            end_word_id="w_0012",
            resolved_start_ms=0,
            resolved_end_ms=6500,
        ),
        visual=SceneVisual(
            background_theme="carvao",
            headline="DÍVIDA IMPAGÁVEL",
            subtext="MATEUS 18:21–35",
            transition_in=TransitionIn.EDITORIAL_WIPE,
            camera_motion="cinematic_push",
            composition="debt_scale",
            atmosphere="dramatic_spotlight",
            beats=[
                SceneBeat(
                    beat_id="b1",
                    anchor_word_id="w_0001",
                    progress=0.0,
                    headline="DEZ MIL TALENTOS",
                    emphasis="gold",
                    visual_action="weigh_debt",
                    camera_shift="push_in",
                ),
                SceneBeat(
                    beat_id="b2",
                    anchor_word_id="w_0007",
                    progress=0.5,
                    headline="IMPOSSÍVEL PAGAR",
                    emphasis="terracotta",
                    visual_action="tilt_scale",
                    camera_shift="tilt_drama",
                ),
            ],
            motion_data={"left_label": "10.000 talentos", "right_label": "100 denários"},
        ),
    )
    assert rich_scene.template == SceneTemplate.EDITORIAL_MOTION
    assert rich_scene.visual.transition_in == TransitionIn.EDITORIAL_WIPE

    # Beat sem anchor_word_id nem progress falha
    with pytest.raises(ValidationError, match="anchor_word_id ou progress"):
        SceneBeat(beat_id="b_bad", headline="SEM ANCORA")

    # beat_id duplicado falha
    with pytest.raises(ValidationError, match="beat_id duplicado"):
        SceneVisual(
            beats=[
                SceneBeat(beat_id="b1", progress=0.1),
                SceneBeat(beat_id="b1", progress=0.6),
            ]
        )

    # QA: beat com anchor_word_id fora do intervalo da cena -> erro Fail-Fast
    words = [
        WordTiming(
            word_id=f"w_{i:04d}",
            segment_id="seg_01",
            text=f"palavra{i}",
            start_ms=(i - 1) * 500,
            end_ms=i * 500 - 20,
        )
        for i in range(1, 21)
    ]
    alignment = AudioAlignment(
        audio_source=AudioMode.RECORDED,
        audio_cache_relpath="audio/narration_master.wav",
        audio_sha256="abc",
        sample_rate_hz=48000,
        duration_ms=10_000,
        alignment_engine="deterministic",
        words=words,
    )
    scene_bad_beat = Scene(
        scene_id="scene_01",
        order=1,
        tier=1,
        template=SceneTemplate.EDITORIAL_MOTION,
        timing=SceneTiming(
            start_word_id="w_0001",
            end_word_id="w_0010",
            resolved_start_ms=0,
            resolved_end_ms=5000,
        ),
        visual=SceneVisual(
            headline="TESTE",
            beats=[SceneBeat(beat_id="b1", anchor_word_id="w_0015")],
        ),
    )
    scene_02 = Scene(
        scene_id="scene_02",
        order=2,
        tier=1,
        template=SceneTemplate.PAPER_COLLAGE,
        timing=SceneTiming(
            start_word_id="w_0011",
            end_word_id="w_0020",
            resolved_start_ms=5000,
            resolved_end_ms=10_000,
        ),
        visual=SceneVisual(headline="CENA DOIS"),
    )
    bad_beat_report = validate_project_timing([scene_bad_beat, scene_02], alignment, preset)
    assert not bad_beat_report.ok
    assert any("fora do intervalo da cena" in err for err in bad_beat_report.errors)

    # QA: micro-cena (2 palavras, 1.0s) -> erro Fail-Fast
    micro_scenes = [
        Scene(
            scene_id="scene_01",
            order=1,
            tier=1,
            template=SceneTemplate.KINETIC_CAPTIONS,
            timing=SceneTiming(
                start_word_id="w_0001",
                end_word_id="w_0002",
                resolved_start_ms=0,
                resolved_end_ms=1000,
            ),
            visual=SceneVisual(headline="MICRO"),
        ),
        Scene(
            scene_id="scene_02",
            order=2,
            tier=1,
            template=SceneTemplate.EDITORIAL_MOTION,
            timing=SceneTiming(
                start_word_id="w_0003",
                end_word_id="w_0020",
                resolved_start_ms=1000,
                resolved_end_ms=10_000,
            ),
            visual=SceneVisual(
                headline="LONGA SEM BEATS",
                composition="narrative_arc",
            ),
        ),
    ]
    micro_report = validate_project_timing(micro_scenes, alignment, preset)
    assert not micro_report.ok
    assert "scene_01" in micro_report.pacing_summary["micro_scene_ids"]
    assert any("micro-cena fragmentada" in err for err in micro_report.errors)
    assert any("sem beats[] internos" in w for w in micro_report.warnings)

    # QA: excesso de cortes rápidos (> 40% das cenas < 2.5s em vídeo com >= 6 cenas) -> erro Fail-Fast
    words_60 = [
        WordTiming(
            word_id=f"w_{i:04d}",
            segment_id="seg_01",
            text=f"tok{i}",
            start_ms=(i - 1) * 200,
            end_ms=i * 200 - 10,
        )
        for i in range(1, 61)
    ]
    align_60 = AudioAlignment(
        audio_source=AudioMode.RECORDED,
        audio_cache_relpath="audio/narration_master.wav",
        audio_sha256="abc60",
        sample_rate_hz=48000,
        duration_ms=12_000,
        alignment_engine="deterministic",
        words=words_60,
    )
    choppy_scenes = [
        Scene(
            scene_id=f"scene_{idx:02d}",
            order=idx,
            tier=1,
            template=SceneTemplate.KINETIC_CAPTIONS,
            timing=SceneTiming(
                start_word_id=f"w_{(idx - 1) * 10 + 1:04d}",
                end_word_id=f"w_{idx * 10:04d}",
                resolved_start_ms=(idx - 1) * 2000,
                resolved_end_ms=idx * 2000,
            ),
            visual=SceneVisual(headline=f"CENA {idx}"),
        )
        for idx in range(1, 7)
    ]
    choppy_report = validate_project_timing(choppy_scenes, align_60, preset)
    assert not choppy_report.ok
    assert any("Excesso de cortes rápidos" in err for err in choppy_report.errors)


def test_api_blocks_verified_placeholder_at_put_script_and_gate1(tmp_path: Path) -> None:
    from fastapi.testclient import TestClient

    from backend.core.config import WORKSPACE_ROOT, load_settings
    from backend.core.storage import ProjectStorage
    from backend.server import create_app

    settings = load_settings(
        workspace_root=WORKSPACE_ROOT,
        env_overrides={"STUDIO_CACHE_DIR": str(tmp_path / "cache")},
        allow_custom_cache=True,
    )
    storage = ProjectStorage(tmp_path / "projects")
    app = create_app(settings=settings, storage=storage)

    with TestClient(app) as client:
        r_create = client.post(
            "/api/projects",
            json={
                "title": "Teste Anti Placeholder",
                "raw_idea": "Parábola do credor incompassivo em Mateus 18:21-35 sobre perdão.",
                "seed_reference": "Mateus 18:21-35",
            },
        )
        assert r_create.status_code == 200
        slug = r_create.json()["manifest"]["slug"]

        r_gen = client.post(f"/api/projects/{slug}/script/generate", json={"use_llm": False})
        assert r_gen.status_code == 200
        script_data = r_gen.json()["script"]

        # Tentar marcar verified_by_human=True mantendo "[Conferir ...]" -> HTTP 422 Fail-Fast!
        script_data["scripture_refs"][0]["verified_by_human"] = True
        r_put_bad = client.put(f"/api/projects/{slug}/script", json=script_data)
        assert r_put_bad.status_code == 422

        # Gate 1 também continua bloqueado com HTTP 422
        r_gate_bad = client.post(f"/api/projects/{slug}/script/approve")
        assert r_gate_bad.status_code == 422

