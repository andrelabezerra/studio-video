# Arquitetura Técnica — Studio Video Pipeline

> Referências da Base de Conhecimento: `Wiki/wiki-design/concepts/video-estilo-vox-ia.md`, `edicao-video-dois-niveis-codigo-estudio.md`, `edicao-programatica-e-qa-multimodal-video.md` e `sources/voicestudio-clonagem-voz-local-elevenlabs.md`.

---

## 1. Visão Geral das Duas Macro-Fases

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ MACRO-FASE 1: CO-CRIAÇÃO GUIADA NA UI (LLM com contexto mínimo por nó)     │
│                                                                            │
│ [Nó Briefing] ──► Recomenda 1 dos 4 Formatos-Série + Tradução + Áudio      │
│       │                                                                    │
│       ▼                                                                    │
│ [Nó Roteiro]  ──► 3 Hooks (0–3s) + Roteiro Prosódico + scripture_refs[]    │
│       │                                                                    │
│       ▼                                                                    │
│ [GATE 1 — APROVAÇÃO HUMANA + CHECKPOINT BÍBLICO]                           │
│       │                                                                    │
│       ▼                                                                    │
│ Gera storyboard.json + distribution_pack (título, legenda, capa, fixado)   │
└────────────────────────────────────┬───────────────────────────────────────┘
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────────────┐
│ MACRO-FASE 2: PRODUÇÃO DETERMINÍSTICA (0 tokens LLM · Cache fora OneDrive) │
│                                                                            │
│ 1. ÁUDIO PRIMEIRO ($0)                                                     │
│    Gravação real (input.wav) OU TTS Local Isolado (XTTS-v2/F5-TTS)         │
│       └──► Normalizador Bíblico pré-TTS ──► Forced Alignment (WhisperX)    │
│       └──► audio_alignment.json (word_id, start_ms, end_ms)                │
│                                                                            │
│ 2. PRODUÇÃO VISUAL EM DOIS NÍVEIS (por cena isolada + cache SHA-256)       │
│    ├── Nível 1 ($0, ≥80% cenas): HTML/SVG/GSAP + Preview <iframe> ao vivo  │
│    ├── Imagens: Gemini PRO (Prompt Pack + dropzone | API) + rembg opcional │
│    └── Nível 2 (sob demanda): OpenRouter vídeo / Fal.ai 3D (com teto USD)  │
│                                                                            │
│ 3. RENDER FRAME-EXACT & MIXAGEM EM PASSO ÚNICO                             │
│    ├── Playwright Virtual Time (tl.time(f/30)) -> CDP -> pipe FFmpeg       │
│    ├── Render paralelo por cena (2,5–4s) -> concat demuxer (-c copy)       │
│    └── FFmpeg filter_complex: voz + SFX (adelay) + ducking + -14 LUFS      │
│                                                                            │
│ 4. QA INTERMEDIÁRIO & EXPORT                                               │
│    └── Safe-Zones 9:16 + Sync Check + Contact Sheet ──► final_9x16.mp4     │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Estratégia de Dois Níveis & Matriz de Provedores

| Camada | Padrão (MVP) | Alternativa Sob Demanda | Custo |
|---|---|---|---|
| **Co-criação** | LLM por nó ativo (prompt enxuto) | — | Mínimo de tokens |
| **Áudio Vocal** | Gravação real (`input.wav`) ou TTS Local Zero-Shot (venv isolado) | VoiceStudio local | `$0` |
| **Alinhamento** | Forced Alignment (`WhisperX` / `stable-ts` contra texto exato) | — | `$0` |
| **Motion (Nível 1)** | HTML/SVG/GSAP + Playwright CDP → FFmpeg | Layout de referência (`reference_layout`) | `$0` |
| **Imagens / Cutouts** | **Gemini PRO** (`gemini_hybrid` dropzone ou `gemini_api`) + `rembg` local | `OPENROUTER_API_KEY` (ex.: GPT Image 2) | `$0` extra / sob demanda |
| **Vídeo (Nível 2)** | Desligado por padrão (`ENABLE_TIER2_VIDEO=false`) | `OPENROUTER_API_KEY` (Hailuo 3 / Max / Grok) | Travado por teto USD |
| **3D (Imagem→3D)** | Desligado por padrão (`ENABLE_FAL_3D=false`) | `FAL_KEY` (só se cena exigir 3D) | Travado por teto USD |

---

## 3. Decisões Críticas para Windows (Anti-Gargalo)

### 3.1 Isolamento do OneDrive (`STUDIO_CACHE_DIR`)
- O workspace do projeto reside no OneDrive; gravar centenas de frames, áudios WAV ou renders intermediários ali provoca *file locks*, sincronização infinita e corrupção.
- **Regra:** O workspace contém apenas código, documentação, presets e metadados JSON (`projects/<slug>/*.json`). Todo binário gerado ou em cache vive em `%LOCALAPPDATA%\StudioVideo\cache\<slug>\`.

### 3.2 Motor de Render Nível 1: Virtual Time + Pipe Direto (Zero PNG em Disco)
- **Problema evitado:** Chamar `page.screenshot()` gravando 1.800 PNGs em disco (60s @ 30fps) estrangula I/O e `requestAnimationFrame` gera *jitter* de tempo.
- **Solução adotada:**
  1. Cada template em `templates_video/` expõe `window.__STUDIO__.seek(timeMs)` sobre uma timeline GSAP pausada (`gsap.timeline({ paused: true })`).
  2. O compositor avança deterministicamente `frame = 0..N-1` (`timeMs = (frame / 30) * 1000`), captura via **CDP `Page.captureScreenshot`** (JPEG q=92 em memória) e envia direto via `stdin` (`-f image2pipe`) para o **FFmpeg**.
  3. **Render por cena em paralelo:** cada cena (2,5–4s) gera seu clipe isolado `scene_XX.mp4` com chave de cache SHA-256; o vídeo completo apenas concatena (`concat demuxer -c copy`), tornando a **regeneração pontual de 1 cena** questão de segundos.
  4. **Dois perfis de render:** Preview rápido (`540×960 @ 15fps`) ou preview ao vivo via `<iframe>` na UI, e Export final (`1080×1920 @ 30fps`, `yuv420p`, H.264 com `h264_nvenc`/`qsv` quando disponível ou `libx264`).

### 3.3 Áudio Agnóstico, Normalizador Bíblico e Forced Alignment
- **Origem agnóstica:** O pipeline exige apenas um WAV limpo (`24kHz/48kHz mono`) vindo de gravação do Pastor André (`input.wav`) **ou** do motor TTS local. Em máquinas sem GPU NVIDIA (CPU-only), o fallback imediato e mais ágil continua sendo a gravação real ou motores leves em CPU.
- **Isolamento de dependências:** Motores TTS neurais (XTTS-v2 / F5-TTS) exigem PyTorch/CUDA específicos; por isso rodam em **subprocesso com venv isolado** (`TTS_VENV_PYTHON`), nunca contaminando o ambiente enxuto do FastAPI/Playwright.
- **Normalizador Pré-TTS Obrigatório (Reuso):** Antes de sintetizar voz, o texto passa por `normalize_biblical_text()` (já implementado em `backend/services/alignment_service.py` — não duplicar), expandindo referências (`"Jo 3:16"` → `"João, capítulo três, versículo dezesseis"`) e fatiando sentenças em blocos ≤ 180 caracteres.
- **Forced Alignment (`WhisperX` / `stable-ts`):** Em vez de transcrição livre (que sofre drift de 100–300ms e erra nomes como *Melquisedeque* ou *Cafarnaum*), o alinhamento forçado casa o áudio contra o texto exato do roteiro (~20–40ms de precisão).

### 3.4 Integração Prática com Gemini PRO (`ImageProvider` Dual)
Como a assinatura web Gemini PRO não implica cota gratuita ilimitada de API, o sistema oferece dois modos transparentes:
1. **`gemini_hybrid` (Padrão custo `$0`):** Para cada cena que precisa de arte *paper collage*, o sistema gera um **Prompt Pack** já ajustado ao estilo Vox Bíblico e abre um *dropzone* no nó da cena na UI (ou monitora pasta local). Ao arrastar a imagem baixada do Gemini PRO, o backend faz automaticamente *smart crop/resize* 9:16, recorte de fundo opcional via `rembg` local (para virar *paper cutout* em camada) e registra no cache SHA-256.
2. **`gemini_api` / `openrouter` (Automático):** Consome `GEMINI_API_KEY` (`google-genai`) ou `OPENROUTER_API_KEY` respeitando o teto `MAX_COST_PER_SCENE_USD`.

### 3.5 Mixagem FFmpeg em Passo Único
Na montagem final, todas as trilhas de áudio são consolidadas em um único `filter_complex`:
- Faixa 1: Narração principal (limpa, referência do *sidechain*).
- Faixa 2: Cues de SFX táteis (`music/sfx/`: rasgo de papel, carimbo, folhear) posicionados exatamente via `adelay` nos `start_ms` das trocas de cena.
- Faixa 3: Trilha contextual (`music/tracks/`) atenuada automaticamente durante a fala via `sidechaincompress` (*ducking* real).
- Saída normalizada com `loudnorm` em **`-14 LUFS` / `-1.0 dBTP`** (padrão Shorts/Reels/TikTok).

---

## 4. Interface Localhost estilo Neo Stitch (`localhost:8740`)

Inspirada na ergonomia do `Neo Stitch` (`React 19 + React Flow 12` + backend Python local):
- **Canvas de Nós (Estado Leve):** `FastAPI` + arquivos JSON são a fonte da verdade; o canvas recebe progresso em tempo real via **SSE (`EventSource`)** e nunca guarda blobs/frames dentro de `nodes[].data`.
- **Topologia dos 5 Tipos de Nó:**
  1. `BriefingNode`: entrada de ideia/versículo + recomendação assistida dos **4 Formatos-Série** + parâmetros do lote.
  2. `ScriptNode`: seleção entre **3 Hooks (0–3s)**, editor de roteiro prosódico, caixa de refino pontual (envia só o nó para a IA), **Checkpoint Bíblico (`scripture_refs`)** e botão **Gate 1**.
  3. `AudioNode`: upload de gravação ou disparo do TTS local + player + status do *forced alignment* palavra-por-palavra.
  4. `SceneNode` (1 nó por cena 9:16): **miniatura real 9:16 (`thumbs/scene_XX.jpg` em `STUDIO_CACHE_DIR`)** dentro do card, **preview ao vivo em `<iframe>` HTML/GSAP** sincronizado com o trecho de áudio, badge Nível 1/2, custo (`$0.00`), *dropzone* Gemini PRO, toggle de **Safe-Zones 9:16**, ações rápidas (**Aprovar**, **Regenerar Cena**, **Alternar Nível**) e comentários por pin `(x%, y%, time_ms)` (Fase 4).
  5. `RenderNode`: resumo de custos, checagem QA, render `.mp4` 1080×1920 e painel copiável do **`distribution_pack`** (título, legenda, comentário fixado e capa PNG).
- **Ergonomia Reativa (Fase 2.5 — inspiração ComfyUI, 1 vídeo por padrão):**
  - **Execução Reativa (`stale` + "Executar Pendentes"):** A API calcula dinamicamente quais nós ficaram desatualizados após uma edição (`audio_stale`, `stale_scene_ids[]`, `render_stale`). A UI destaca os nós afetados e o botão **"Executar Pendentes"** reprocessa apenas o necessário do vídeo ativo.
  - **Clonagem de Workflow:** Ação **"Novo Episódio deste Estilo"** cria 1 único novo projeto herdando preset, formato-série, tradução, duração alvo, modo de áudio e sequência de templates.
  - **Grupo Recolhível & Atalhos:** Bloco de cenas recolhível com filtro (`Todas | Pendentes | Aprovadas`) e atalhos de estúdio (`Ctrl+Enter`, `A`, `R`, `Espaço`, `Esc`).
  - **Escala Controlada (Fase 4):** Fila de execução lateral e manifesto de templates plugáveis; operação padrão continua sempre focada em **1 vídeo por vez**, com lote multi-vídeo apenas sob adição explícita do usuário.

---

## 5. Topologia Trabalhador vs. Supervisor e Cache

| Papel | Responsabilidade | Regra de Governança |
|---|---|---|
| **Trabalhadores** | `cocreation_service`, `tts_local_service`, `alignment_service`, `asset_service`, `compositor_service`, `audio_mixer_service` | 1 responsabilidade por arquivo (SRP); sem validação silenciosa |
| **Supervisores** | `schema_validator` (Pydantic), `timing_checker` (cobertura de `word_id` e duração alvo 35–48s), `qa_service` (safe-zones, sync áudio/vídeo e *contact sheet*) | Teto máximo de **2 ciclos de autocorreção** antes de escalar para decisão humana |

**Fórmula de Cache Granular por Cena:**
```text
scene_hash = sha256(template_version + canonical_scene_json + input_asset_hashes + audio_slice_hash)
```
Se `scene_hash` não mudou e `scene_XX.mp4` existe em `STUDIO_CACHE_DIR`, a cena é reutilizada instantaneamente com custo `$0` e tempo `0s`.

---

## 6. Estrutura de Diretórios Consolidada (SRP)

```text
Studio Video/
├── AGENTS.md                           # Governança Antigravity
├── README.md                           # Visão geral e roadmap
├── .env.example                        # Template de variáveis locais
├── .gitignore                          # Proteção de segredos e mídia pesada
├── pyproject.toml                      # Dependências Python via uv (Fase 1)
├── docs/                               # Documentação viva (Fase 0)
│   ├── ARQUITETURA.md
│   ├── ESTILO_VOX_BIBLICO.md
│   └── CONTRATOS_JSON.md
├── config/
│   └── style_presets/
│       └── pastor-andre-biblico.json   # Preset editorial 9:16
├── assets/                             # Biblioteca editorial reutilizável
│   ├── voice_samples/                  # Amostra .wav do Pastor André
│   ├── textures/                       # Pergaminho, papel craft, halftone, grão
│   └── references/                     # Referências Vox / layouts sob demanda
├── music/
│   ├── tracks/                         # Trilhas instrumentais contextuais
│   └── sfx/                            # SFX táteis (rasgo, carimbo, folhear)
├── backend/                            # FastAPI + Pipeline Determinístico (Fases 1–4)
│   ├── server.py
│   ├── core/                           # config.py, storage.py, cache.py
│   ├── models/                         # Schemas Pydantic
│   ├── services/                       # Serviços SRP (1 por etapa)
│   └── api/                            # Rotas REST + SSE
├── templates_video/                    # Templates Nível 1 HTML/SVG/GSAP (Fase 1+)
├── app/                                # UI React 19 + React Flow 12 (Fase 2)
└── projects/                           # Somente JSONs leves por slug
```
