# Studio Video — AI Video Studio Pipeline (`@pastorandrebezerra`)

Aplicação local assistida por IA para produção completa de vídeos verticais **9:16 (1080×1920 @ 30fps)** no estilo editorial **Vox Bíblico** para YouTube Shorts, Instagram Reels e TikTok — do rascunho da ideia até o `.mp4` final narrado, animado, mixado e empacotado para publicação.

---

## Como o Sistema Opera

1. **Macro-Fase 1 — Co-criação Guiada (Human-in-the-Loop na UI):**
   - Você inicia um novo vídeo no canvas local (`localhost:8740`) digitando uma ideia ou versículo.
   - A interface ajuda a escolher entre os **4 Formatos-Série Replicáveis** (*Mapa & Contexto*, *Perdido na Tradução*, *Mito vs. Texto*, *Conexão AT→NT*), gera **3 variações de Hook (0–3s)**, monta o roteiro prosódico, valida as referências bíblicas (`scripture_refs`) e trava o **Gate 1**.
2. **Macro-Fase 2 — Produção Determinística em Dois Níveis (0 tokens de LLM):**
   - **Áudio Primeiro (`$0`):** gravação real do Pastor André (`input.wav`) ou clonagem vocal local zero-shot + *forced alignment* palavra-por-palavra (`WhisperX` / `stable-ts`).
   - **Nível 1 — Código Puro (`$0`):** templates dinâmicos HTML/SVG/GSAP (*Paper Collage*, *Cartão de Versículo*, *Tipografia Cinética*, *Mapa/Timeline SVG*) com preview ao vivo em `<iframe>` e render frame-exact via CDP → pipe FFmpeg.
   - **Nível 2 — Generativo Cirúrgico (sob demanda):** imagens via Gemini PRO (*Prompt Pack* + dropzone ou API) e, opcionalmente por cena, vídeo via OpenRouter ou 3D via Fal.ai com controle rígido de custo.
   - **Mixagem & Empacotamento:** FFmpeg em passo único (voz + SFX de papel nos cortes + trilha com *ducking* + `-14 LUFS`) + `distribution_pack` (título Shorts, legenda/hashtags, comentário fixado e capa PNG).

---

## Documentação Norteadora (Fase 0)

| Documento | Escopo |
|---|---|
| [AGENTS.md](AGENTS.md) | Regras operacionais do projeto, economia de tokens e isolamento de cache/segredos |
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md) | Arquitetura de software, pipeline Windows/FFmpeg, áudio local, UI estilo Neo Stitch e QA |
| [docs/ESTILO_VOX_BIBLICO.md](docs/ESTILO_VOX_BIBLICO.md) | Bíblia visual do canal `@pastorandrebezerra`, 4 formatos-série, hooks, safe-zones e lote piloto |
| [docs/CONTRATOS_JSON.md](docs/CONTRATOS_JSON.md) | Schemas JSON canônicos (ancorados em `word_id`) e contratos da UI |
| [config/style_presets/pastor-andre-biblico.json](config/style_presets/pastor-andre-biblico.json) | Preset operacional 9:16 (paleta, tipografia, safe-zones, mixagem e séries) |

---

## Roadmap de Implementação (Plano v4.2)

- [x] **Fase 0 — Documentação Viva & Preset:** regras operacionais, bíblia visual Vox Bíblico, contratos JSON e preset padrão.
- [x] **Fase 1 — Vertical Slice (Motor + Vídeo Piloto #1):** backend core (cache fora do OneDrive), Pydantic, *forced alignment*, 3 templates GSAP dinâmicos, compositor CDP→FFmpeg e mixer `-14 LUFS` gerando o 1º MP4 9:16 real.
- [x] **Fase 2 — Cockpit Localhost estilo Neo Stitch + Co-criação:** FastAPI + SSE + `React 19 / React Flow 12` em `localhost:8740` (Briefing/Série → Roteiro & 3 Hooks → Áudio → Cenas com preview ao vivo `<iframe>` + safe-zones + dropzone Gemini PRO + Regenerar Cena → Render & `distribution_pack`).
- [x] **Fase 2.5 — Polimento do Cockpit Reativo (Inspiração ComfyUI, 1 vídeo por padrão):** detecção visual de nós desatualizados (`stale`) + botão **"Executar Pendentes"**, miniaturas reais dentro dos nós de cena (`thumbs/`), clonagem de workflow (**"Novo Episódio deste Estilo"**), grupo recolhível de cenas e atalhos de teclado.
- [x] **Fase 3 — TTS Local Zero-Shot & Normalizador Bíblico:** adaptador `tts_local_service.py` em venv isolado (suporte a CPU/GPU ou gravação própria `input.wav`) reutilizando `normalize_biblical_text` + integração de *forced alignment* real (`WhisperX`/`stable-ts`).
- [x] **Fase 4 — Escala Controlada, Fila & Nível 2 Cirúrgico:** painel lateral de Fila & Histórico (1 vídeo por padrão; lote sob demanda), manifesto de templates plugáveis (`timeline_map` SVG), conectores opcionais OpenRouter vídeo / Fal.ai 3D sob teto USD, comentários com pin na cena e `metrics_48h`.
