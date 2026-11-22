# Bíblia Editorial & Visual — Vox Bíblico (`@pastorandrebezerra`)

> Diretriz de estilo, ritmo, retenção e identidade para a retomada do canal **Pastor André Bezerra** (`https://www.youtube.com/@pastorandrebezerra`) em YouTube Shorts, Instagram Reels e TikTok.

---

## 1. Identidade Editorial (Anti-Genérico / Anti-Slop)

O canal combina **jornalismo explicativo visual estilo Vox** com **profundidade bíblica acessível** e autoridade pastoral real.

**O que É:**
- Colagem editorial tátil (*paper collage*), pergaminho texturizado, gravuras/ilustrações recortadas com sombra real, mapas históricos e tipografia de revista/documentário.
- Ritmo ágil, claro e informativo que responde a uma pergunta real em menos de 50 segundos.
- Linguagem direta, respeitosa e rigorosa com o texto bíblico.

**O que NÃO É (proibido):**
- Slides estáticos com cara de PowerPoint ou imagens de IA genéricas trocando em *crossfade* lento.
- Legenda neon pulando palavra por palavra no centro da tela (estilo "Hormozi" conflita com a sobriedade editorial Vox).
- Saudações longas (*"Olá pessoal, paz do Senhor, no vídeo de hoje..."*) ou despedidas genéricas que derrubam a retenção.
- **Fragmentação frenética (1 frase curta = 1 cena):** nunca criar micro-cenas de 1–3 palavras ou cortes a cada 1–2 segundos.
- **Modelo burocrático de cartão estático com selo `"TEXTO VERIFICADO"`:** proibido renderizar carimbos cartoriais/burocráticos sobre versículos ou qualquer texto placeholder entre colchetes (`[Conferir ...]`, `[TODO]`, `TBD`). Versículos devem aparecer em composições editoriais limpas, vivas e orgânicas.

---

## 2. Os 4 Formatos-Série Replicáveis

Todo novo vídeo deve ser classificado em um dos 4 formatos abaixo (a UI recomenda automaticamente com base no tema/versículo digitado):

| `format_type` | Nome da Série | Quando recomendar | Sequência Padrão de Cenas (35–48s) | Templates Nível 1 Principais |
|---|---|---|---|---|
| `mapa_contexto` | **Mapa & Contexto** | Temas com cidades, rotas, distâncias, impérios ou arqueologia (ex.: viagem de Paulo, Cafarnaum, Babilônia) | Hook visual de mapa → Contexto histórico → Zoom de rota/distância → Versículo-chave → Aplicação direta | `timeline_map`, `paper_collage`, `bible_quote_card` |
| `perdido_traducao` | **Perdido na Tradução** | Palavras originais em hebraico ou grego cujo sentido se perde na leitura rápida (ex.: *shalom*, *metanoia*, *agape*, *makarios*) | Hook de contraste verbal → Termo original transliterado + marca-texto → Uso no texto bíblico → Mudança de sentido → Aplicação | `kinetic_captions`, `bible_quote_card`, `paper_collage` |
| `mito_vs_texto` | **Mito vs. Texto** | Frases atribuídas à Bíblia que não estão lá ou interpretações populares distorcidas | Hook provocativo ("A Bíblia nunca disse isso") → Carimbo de mito → Texto bíblico destacado → Explicação contextual → Fechamento | `paper_collage`, `bible_quote_card`, `kinetic_captions` |
| `conexao_at_nt` | **Conexão AT → NT** | Profecias, símbolos ou paralelos entre Antigo e Novo Testamento (ex.: Páscoa → Cruz, Tabernáculo → João 1) | Hook de paralelo surpreendente → Linha do tempo AT → Salto temporal NT → Cartão de versículo espelhado → Aplicação | `timeline_map`, `bible_quote_card`, `paper_collage` |

---

## 3. Engenharia de Retenção (Alvo: 35–48 segundos)

### 3.1 Hook Dual Obrigatório (0s a 3s)
- **Regra de ouro:** Zero introdução, zero logo animada, zero cumprimento. Começa no conflito ou na curiosidade.
- **Verbal:** Máximo **8 palavras**, criando *curiosity gap* imediato.
- **Visual (*pattern interrupt* nos primeiros 1,5s):** Entrada tátil imediata (recorte de papel surgindo com sombra + som de rasgo/carimbo + palavra-âncora com marcador-texto).
- **Co-criação:** A IA sempre propõe **3 variações de Hook** (`mito`, `paradoxo`, `traducao` ou `mapa`) para escolha humana na UI.

### 3.2 Corpo Explicativo & Ritmo Fluido Multi-Beat (Lição Aprendida Obrigatória)
- **Agrupamento narrativo em blocos de 4s a 8s:** Em vez de cortar a cena a cada frase curta (erro que gera 25+ micro-cenas cansativas), cada cena deve cobrir **1 ideia narrativa completa (4s a 8s, podendo ir até ~9s em clímax com 3 beats)**.
  - Vídeos curtos (35–48s): **~8 a 10 cenas**.
  - Vídeos narrativos / parábolas (60–85s): **~10 a 14 cenas** (nunca micro-cenas de 1–3 palavras).
- **Animação contínua via `beats[]` internos:** Dinamismo não vem de cortar a cena a cada 1,5s, mas de evoluir a mesma cena em **2 a 4 `beats[]` ancorados em `word_id`** (mudança de destaque tipográfico, desenho SVG progressivo, deslocamento sutil de câmera, resposta de luz/atmosfera).
- **Micro-viradas (*open loops*):** A cada 8–12 segundos, introduzir um pivô narrativo (*"Mas olha o que o texto diz logo depois..."*, *"Só que no grego a palavra muda tudo..."*).
- **Liberdade visual além de templates repetitivos:** Priorizar `editorial_motion` (composições SVG coreografadas como `debt_scale`, `forgiveness_seal`, `dramatic_split`, `rhetorical_question`, `grace_illumination`, `narrative_arc`, `counter_impact`, `scripture_spotlight`) alternado com `paper_collage`, `timeline_map`, `kinetic_captions` e `bible_quote_card` limpo — nunca repetir a mesma composição em cenas consecutivas.

### 3.3 Fechamento sem Queda de Retenção (últimos 5–8s)
- **Aplicação fundida à conclusão:** Entregar o insight prático em 1 frase memorável sem sinalizar "agora vou encerrar o vídeo".
- **CTA limpo (últimos 2–3s):** Uma pergunta curta que convida a comentar ou loop contínuo para o início, acompanhado de assinatura visual discreta (`@pastorandrebezerra`).

---

## 4. Sistema Visual 9:16 (1080×1920 @ 30fps)

### 4.1 Paleta Editorial Fechada
Definida em `config/style_presets/pastor-andre-biblico.json`:
- **Base Pergaminho:** `#F4EDE1` (fundo principal claro com textura de papel/grão sutil)
- **Base Noturna / Carvão:** `#181A1F` (cenas de contraste dramático e textos principais)
- **Destaque Vox (Dourado Ocre):** `#E5A93C` (marca-texto animado, setas, sublinhados, bordas de ênfase)
- **Acento Histórico (Azul-Marinho):** `#1E3A5F` (mapas, cabeçalhos editoriais, tags de série)
- **Acento de Contraste (Terracota):** `#9E3B2E` (carimbos "MITO", alertas históricos, pinos de mapa)

### 4.2 Tipografia & Regras Anti-Slop
- **Display / Títulos:** Serif editorial forte (`Playfair Display` ou `Fraunces`, peso 700–800) para autoridade documental.
- **Corpo / UI / Legendas:** Sans geométrica limpa (`Inter` ou `DM Sans`, peso 500–700).
- **Termos Originais / Datas / Referências:** Monospace editorial (`JetBrains Mono` ou `IBM Plex Mono`).
- **Limite rígido em tela:** Máximo **4 a 6 palavras** por bloco cinético; legendas alinhadas à paleta (fundo pergaminho/carvão sutil), nunca texto colado nas bordas.

### 4.3 Safe-Zones Unificadas (Shorts + Reels + TikTok)
Para publicar o mesmo `.mp4` nas 3 plataformas sem cortar texto ou ícones:
- **Topo livre (barra de status / câmera / busca):** `≥ 220 px` (`y < 220`)
- **Base livre (título, áudio, descrição, barra inferior):** `≥ 420 px` (`y > 1500`)
- **Lateral direita livre (botões curtir/comentar/compartilhar):** `≥ 160 px` (`x > 920`)
- **Margem lateral esquerda mínima:** `≥ 64 px` (`x < 64`)
- **Área útil nobre garantida:** `x: 64..920` (`856 px`) × `y: 220..1500` (`1280 px`).

### 4.4 Biblioteca de Efeitos Dinâmicos & Motor Cinematográfico (Nível 1)
1. **Editorial Motion Multi-Beat (`editorial_motion`):** Composições SVG coreografadas (`stroke-dashoffset` desenhando ao vivo, balança de dívida `debt_scale`, decreto e selo orgânico `forgiveness_seal`, contraste `dramatic_split`, pergunta monumental `rhetorical_question`, luz `grace_illumination`, arco narrativo `narrative_arc`, contador `counter_impact`, citação limpa `scripture_spotlight`) guiadas por `beats[]` e `motion_data`.
2. **Atmosfera Viva & Câmera Contínua:** Grão de papel determinístico, partículas/parallax sutil, iluminação/vinheta dinâmica (`warm_paper`, `dramatic_spotlight`, `grace_glow`, `ink_vignette`) e câmera viva (`cinematic_push`, `editorial_glide`, `beat_reactive`) que nunca congelam no meio da cena.
3. **Paper Collage Multicamadas:** Fundo de textura craft/pergaminho com movimento sutil + recortes com borda rasgada em SVG + `drop-shadow` realista + entrada com *overshoot* suave.
4. **Citação Bíblica Editorial Limpa (Zero Cartão Burocrático):** Referência canônica (`Livro Cap:Vers · Tradução`) com destaque progressivo na frase central — **estritamente proibido** exibir selo `"TEXTO VERIFICADO"` ou qualquer texto placeholder (`[Conferir ...]`).
5. **Transições Cinematográficas:** `editorial_wipe`, `cross_motion`, `zoom_through`, `ink_wash`, `paper_tear`, `whip_pan` e `stamp_drop` sincronizadas com SFX.

---

## 5. Voz, Selo Humano e Rigor Bíblico

- **Prosódia de Roteiro (para voz real ou TTS):** Frases curtas de **6 a 12 palavras**, pontuação clara para pausas respiratórias e ausência de abreviações soltas no texto falado.
- **Selo Humano do Pastor André:** Para evitar a percepção impessoal de "canal dark", cada vídeo pode incluir um **slot opcional de presença humana**: recorte fotográfico editorial do Pastor André em *paper collage* no hook/fechamento ou um clipe real curto (3s) nos episódios-âncora.
- **Checkpoint de Rigor Bíblico (obrigatório antes do Gate 1):**
  - Tradução padrão configurável no `.env` e preset (padrão inicial: `NVI`, editável por vídeo para `ARA`/`NAA`).
  - Todo versículo citado deve constar em `scripture_refs[]` com texto exato conferido pelo Pastor André antes de gerar áudio.

---

## 6. Estratégia de Retomada (Anti-Cold-Start)

- **Lote Piloto de Lançamento:** Produzir **8 a 12 vídeos** (2 a 3 de cada um dos 4 formatos-série) antes de reativar as publicações, garantindo cadência firme de **3 a 5 vídeos por semana** nas 3 primeiras semanas.
- **Empacotamento Multi-Plataforma (`distribution_pack`):** Todo projeto entrega, junto ao `.mp4`, título Shorts (≤60 chars), legenda curta + 3–5 hashtags (Reels/TikTok), comentário fixado (versículo completo + gancho do próximo episódio) e capa PNG limpa (3–4 palavras no centro seguro).
- **Loop de Métricas (48h pós-publicação):** Registrar no projeto `viewed_vs_swiped_pct`, `avg_retention_pct` e `comments_count` cruzados com `format_type` + `hook_type` para dobrar a produção nos formatos vencedores.
