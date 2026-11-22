# AGENTS.md — Governança Operacional do Projeto Studio Video

> Regras obrigatórias para o Antigravity neste workspace (`Studio Video`).
> Este projeto **não** usa `CLAUDE.md` — toda diretriz operacional vive aqui e em `docs/`.

---

## 1. Missão e Contexto

Construir e operar o **AI Video Studio Pipeline**, uma aplicação local assistida por IA para retomada de alto impacto do canal **Pastor André Bezerra** (`https://www.youtube.com/@pastorandrebezerra`), produzindo vídeos verticais **9:16 (1080×1920 @ 30fps)** no estilo editorial **Vox Bíblico** para YouTube Shorts, Instagram Reels e TikTok.

Referências da Base de Conhecimento (`Wiki/wiki-design/`):
- `concepts/video-estilo-vox-ia.md` (3 regras operacionais Vox: áudio primeiro, uma imagem por clipe, gate antes de animar)
- `concepts/edicao-video-dois-niveis-codigo-estudio.md` (Nível 1 código puro vs. Nível 2 generativo cirúrgico)
- `concepts/edicao-programatica-e-qa-multimodal-video.md` (render programático, ducking, QA por frames)
- `sources/voicestudio-clonagem-voz-local-elevenlabs.md` (clonagem de voz local gratuita)

---

## 2. Regras Invioláveis

1. **Segredos somente no `.env` local (Secrets Vault):**
   - Nunca gravar chaves literais (`GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `FAL_KEY`) em código, JSON, logs ou documentação.
   - Carregar exclusivamente via variáveis de ambiente (`os.getenv(...)`) e mascarar em qualquer saída de log.
2. **Cache e Mídia Fora do OneDrive (Windows P0):**
   - Este workspace reside no OneDrive. **Nunca** salvar frames, vídeos intermediários, bancos SQLite ativos ou renders temporários dentro do workspace.
   - Todos os artefatos binários temporários devem ir para `STUDIO_CACHE_DIR` (`%LOCALAPPDATA%\StudioVideo\cache`). O workspace guarda apenas código, docs, presets e JSONs leves.
3. **Economia Estrita de Tokens (Contexto Isolado por Nó/Cena):**
   - A Fase 1 (Co-criação) trabalha em JSON compacto por etapa (`briefing` → `script` → `storyboard`).
   - Ao refinar um hook ou regenerar a Cena `N`, carregar **somente** o JSON daquele nó/cena + `config/style_presets/pastor-andre-biblico.json`. Nunca reenviar o projeto inteiro no prompt.
   - A Fase 2 (Produção) é **100% determinística (0 tokens de LLM)** durante TTS, *forced alignment*, renderização Playwright/FFmpeg e mixagem.
4. **Custo-Mínimo Primeiro (Hierarquia de Provedores):**
   - **Áudio:** `$0` (gravação real `input.wav` ou TTS local zero-shot em venv isolado + *forced alignment* local).
   - **Animação (≥80% das cenas):** `$0` (Nível 1 — HTML/SVG/GSAP + Playwright headless + FFmpeg).
   - **Imagens:** Gemini PRO (via Modo Híbrido *Prompt Pack + dropzone* ou API oficial `GEMINI_API_KEY`).
   - **Nível 2 Vídeo / 3D:** `OPENROUTER_API_KEY` e `FAL_KEY` ficam **desligados por padrão** e só rodam mediante aprovação explícita na UI respeitando `MAX_COST_PER_VIDEO_USD`.
5. **Contrato `word_id`-Anchored (Sem Timings Fixos):**
   - Cenas, marca-texto e cues de SFX devem referenciar `start_word_id` / `end_word_id` derivados do *forced alignment*, nunca segundos digitados manualmente no roteiro.
6. **Fail-Fast & Teto Anti-Spinning:**
   - Capturar exceções específicas, validar fronteiras com Pydantic e interromper em caso de erro irrecuperável.
   - Máximo de **2 tentativas consecutivas** de autocorreção por erro de teste/render antes de reportar causa raiz e pedir alinhamento humano.
7. **Governança Vertical Slice (Anti-Ferramentismo):**
   - Seguir o plano `v4.1` estritamente por fase.
   - Não adicionar Nível 2 vídeo, Fal.ai 3D ou pins colaborativos antes de validar o **Vídeo Piloto #1 (Fase 1)** e o **Cockpit estilo Neo Stitch funcional (Fase 2)**.
8. **Checkpoint de Rigor Bíblico:**
   - Nenhuma produção avança para geração de áudio sem validação humana do campo `scripture_refs[]` e da tradução bíblica configurada.

---

## 3. Mapa Rápido de Documentação (Leia só o que a tarefa exige)

| Arquivo | Quando consultar |
|---|---|
| `docs/ARQUITETURA.md` | Fluxo das 2 macro-fases, render CDP→FFmpeg, áudio local, UI React Flow e topologia Trabalhador/Supervisor |
| `docs/ESTILO_VOX_BIBLICO.md` | Identidade visual, 4 formatos-série, regras de hook (0–3s), safe-zones 9:16 e prosódia bíblica |
| `docs/CONTRATOS_JSON.md` | Schemas canônicos (`manifest`, `briefing`, `script`, `audio_alignment`, `storyboard`, `scene_XX`) |
| `config/style_presets/pastor-andre-biblico.json` | Tokens de cor, tipografia, safe-zones, duração alvo e parâmetros de mixagem (`-14 LUFS`) |
