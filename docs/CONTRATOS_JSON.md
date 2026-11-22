# Contratos JSON Canônicos — Studio Video

> Todos os arquivos JSON abaixo ficam em `projects/<slug>/` (leves e versionáveis).
> Binários pesados (`.wav`, `.png`, `.mp4`, frames) são referenciados por caminho lógico/hash e armazenados em `STUDIO_CACHE_DIR` (fora do OneDrive).
> Todos os schemas são validados em runtime via Pydantic (*fail-fast*).

---

## 1. Mapa de Arquivos por Projeto (`projects/<slug>/`)

```text
projects/<slug>/
├── manifest.json           # Estado global, gates, lote/série, custos e métricas
├── briefing.json           # Ideia bruta, recomendação de formato-série e parâmetros
├── script.json             # 3 hooks, roteiro prosódico, scripture_refs e distribution_pack
├── audio_alignment.json    # Origem do áudio + lista word_id -> start_ms/end_ms
├── storyboard.json         # Ordem das cenas e configurações globais de composição
└── scenes/
    ├── scene_01.json       # Contrato isolado da Cena 1 (ancorado em word_id)
    └── scene_02.json       # Contrato isolado da Cena 2
```

---

## 2. `manifest.json` — Estado Global & Governança

```json
{
  "schema_version": "1.0.0",
  "slug": "2026-11-perdido-traducao-makarios",
  "title": "O que Jesus realmente disse em 'Bem-aventurados'",
  "created_at": "2026-11-21T17:30:00-03:00",
  "updated_at": "2026-11-21T17:45:00-03:00",
  "preset_id": "pastor-andre-biblico",
  "series": {
    "series_id": "perdido_traducao",
    "format_type": "perdido_traducao",
    "episode_number": 1,
    "batch_id": "retomada-lote-01"
  },
  "gates": {
    "briefing_approved": true,
    "scripture_verified": true,
    "script_gate_1_approved": true,
    "audio_aligned": false,
    "scenes_approved": false,
    "qa_passed": false
  },
  "cost_ledger": {
    "currency": "USD",
    "estimated_total": 0.0,
    "spent_total": 0.0,
    "cap_usd": 2.5,
    "items": []
  },
  "metrics_48h": {
    "published_at": null,
    "viewed_vs_swiped_pct": null,
    "avg_retention_pct": null,
    "comments_count": null
  }
}
```

---

## 3. `briefing.json` — Nó Briefing & Seletor de Série (UI)

```json
{
  "raw_idea": "Explicar que bem-aventurado em Mateus 5 não é só felicidade passageira",
  "seed_reference": "Mt 5:3",
  "bible_translation": "NVI",
  "target_duration_sec": 42,
  "audio_mode": "recorded",
  "human_seal_mode": "paper_cutout",
  "recommended_format": {
    "format_type": "perdido_traducao",
    "confidence": 0.94,
    "rationale": "O gancho central depende do termo grego makarios e do contraste com o sentido moderno de felicidade."
  },
  "selected_format_type": "perdido_traducao",
  "optional_reference_layout": null
}
```

Valores válidos:
- `selected_format_type`: `mapa_contexto | perdido_traducao | mito_vs_texto | conexao_at_nt`
- `audio_mode`: `recorded | xtts_v2 | f5_tts | voicestudio`
- `human_seal_mode`: `none | paper_cutout | real_clip_3s`

---

## 4. `script.json` — Nó Roteiro, 3 Hooks, Rigor Bíblico & Empacotamento

```json
{
  "selected_hook_id": "hook_2",
  "hooks": [
    {
      "id": "hook_1",
      "hook_type": "traducao",
      "spoken_text": "Você sempre leu Mateus cinco do jeito errado.",
      "visual_interrupt": "Rasgo de papel revelando o texto grego 'μακάριος' com marca-texto dourado."
    },
    {
      "id": "hook_2",
      "hook_type": "paradoxo",
      "spoken_text": "Jesus não prometeu felicidade fácil em Mateus cinco.",
      "visual_interrupt": "Carimbo terracota sobre 'felicidade' e recorte de pergaminho entrando."
    },
    {
      "id": "hook_3",
      "hook_type": "mito",
      "spoken_text": "Bem-aventurado não significa estar sempre sorrindo.",
      "visual_interrupt": "Palavra 'BEM-AVENTURADO' riscada e substituída por 'MAKÁRIOS'."
    }
  ],
  "narration_segments": [
    {
      "segment_id": "seg_01",
      "role": "hook",
      "display_text": "Jesus não prometeu felicidade fácil em Mateus 5.",
      "tts_text": "Jesus não prometeu felicidade fácil em Mateus, capítulo cinco."
    },
    {
      "segment_id": "seg_02",
      "role": "body",
      "display_text": "A palavra grega usada ali é makários.",
      "tts_text": "A palavra grega usada ali é macários."
    }
  ],
  "scripture_refs": [
    {
      "ref_id": "ref_01",
      "citation": "Mateus 5:3",
      "translation": "NVI",
      "exact_text": "Bem-aventurados os pobres em espírito, pois deles é o Reino dos céus.",
      "verified_by_human": true
    }
  ],
  "distribution_pack": {
    "shorts_title": "O que Jesus realmente quis dizer com 'Bem-aventurados'?",
    "caption_reels_tiktok": "No grego original, 'makários' muda completamente a forma de ler Mateus 5. Qual versículo você quer ver no próximo episódio?",
    "hashtags": ["#pastorandrebezerra", "#estudobiblico", "#mateus5", "#curiosidadesbiblicas"],
    "pinned_comment": "Texto base: Mateus 5:3 (NVI). Comenta aqui qual palavra bíblica você quer que eu explique no próximo vídeo!",
    "cover_spec": {
      "headline": "NÃO É SÓ FELICIDADE",
      "subheadline": "MATEUS 5 NO GREGO",
      "highlight_word": "FELICIDADE"
    }
  }
}
```

---

## 5. `audio_alignment.json` — Metrônomo Palavra-por-Palavra

Gerado na Fase 2/3 a partir do áudio aprovado + *forced alignment* (`WhisperX` / `stable-ts`):

```json
{
  "audio_source": "recorded",
  "audio_cache_relpath": "audio/narration_master.wav",
  "audio_sha256": "e3b0c442...",
  "sample_rate_hz": 48000,
  "duration_ms": 41280,
  "alignment_engine": "whisperx",
  "words": [
    { "word_id": "w_0001", "segment_id": "seg_01", "text": "Jesus", "start_ms": 120, "end_ms": 490, "confidence": 0.98 },
    { "word_id": "w_0002", "segment_id": "seg_01", "text": "não", "start_ms": 500, "end_ms": 680, "confidence": 0.97 },
    { "word_id": "w_0003", "segment_id": "seg_01", "text": "prometeu", "start_ms": 690, "end_ms": 1180, "confidence": 0.99 }
  ]
}
```

---

## 6. `scenes/scene_XX.json` — Contrato Isolado de Cena (Ancorado em `word_id`)

> Regra de economia de tokens: ao regenerar ou ajustar a Cena 02, a IA lê **somente** `scenes/scene_02.json` + o trecho correspondente de `audio_alignment.json` + o preset.

```json
{
  "scene_id": "scene_02",
  "order": 2,
  "status": "draft",
  "tier": 1,
  "template": "paper_collage",
  "template_version": "1.0.0",
  "timing": {
    "start_word_id": "w_0010",
    "end_word_id": "w_0021",
    "resolved_start_ms": 2950,
    "resolved_end_ms": 6420
  },
  "visual": {
    "background_theme": "pergaminho",
    "headline": "MAKÁRIOS",
    "subtext": "Grego · Mateus 5",
    "highlight_word_ids": ["w_0016"],
    "transition_in": "paper_tear",
    "camera_motion": "subtle_zoom_in",
    "reference_layout_asset": null
  },
  "assets": [
    {
      "asset_id": "img_pergaminho_grego",
      "provider": "gemini_hybrid",
      "prompt": "Editorial Vox style paper collage cutout of an ancient Greek papyrus scroll with warm sepia ink, torn paper edges, isolated on plain cream background, no readable modern text",
      "apply_rembg": true,
      "cache_relpath": "assets/scene_02_cutout.png",
      "sha256": null
    }
  ],
  "sfx_cues": [
    {
      "sfx_id": "paper_tear_01",
      "anchor_word_id": "w_0010",
      "offset_ms": -60,
      "gain_db": -6.0
    }
  ],
  "review_pins": [
    {
      "pin_id": "pin_01",
      "x_pct": 52.0,
      "y_pct": 38.5,
      "time_ms": 1200,
      "note": "Subir o recorte 40px para dar mais respiro à legenda",
      "resolved": false
    }
  ],
  "cache_hash": null,
  "cost_usd": 0.0
}
```

Valores válidos:
- `status`: `draft | approved | needs_revision | rendered | discarded`
- `tier`: `1` (Código Puro HTML/SVG/GSAP) ou `2` (Vídeo Generativo / 3D sob demanda)
- `template`: `paper_collage | bible_quote_card | kinetic_captions | timeline_map | tier2_video`
- `transition_in`: `cut | paper_tear | whip_pan | stamp_drop`

---

## 7. `storyboard.json` — Índice Leve da Linha do Tempo

```json
{
  "fps": 30,
  "width": 1080,
  "height": 1920,
  "music_track": "music/tracks/editorial_contemplative_01.mp3",
  "music_enabled": true,
  "captions_enabled": true,
  "scene_ids": ["scene_01", "scene_02", "scene_03"]
}
```

---

## 8. Contrato Calculado em Runtime (`GET /api/projects/{slug}` — Fase 2.5)

> Estes campos são **calculados em memória** pelo backend a partir do estado em disco e de `STUDIO_CACHE_DIR`. **Não** são persistidos nos arquivos `.json` de `projects/<slug>/` para evitar duplicação de estado.

```json
{
  "pipeline_status": {
    "audio_stale": false,
    "stale_scene_ids": ["scene_02"],
    "render_stale": true,
    "pending_count": 2
  },
  "scene_runtime": {
    "scene_01": {
      "is_stale": false,
      "has_clip": true,
      "thumbnail_url": "/api/projects/<slug>/media/thumbs/scene_01.jpg"
    },
    "scene_02": {
      "is_stale": true,
      "has_clip": false,
      "thumbnail_url": null
    }
  }
}
```

Endpoints complementares da Fase 2.5 (operam sobre **1 vídeo por padrão**):
- `POST /api/projects/{slug}/run-pending` (`{"profile": "preview" | "final"}`): executa via SSE apenas as etapas pendentes/desatualizadas do projeto atual.
- `POST /api/projects/{slug}/clone-workflow` (`{"title": str, "raw_idea": str, "seed_reference"?: str}`): cria 1 único novo projeto herdando série, tradução, duração alvo, modo de áudio, selo humano e perfil de templates.
