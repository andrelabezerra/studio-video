/* ============================================================================
   Template 3: kinetic_captions (Tipografia Cinética Editorial Vox)
   - Blocos cinéticos de máx. 4–6 palavras (nunca "Hormozi" neon)
   - Alternância de alto impacto entre Carvão #181A1F e Pergaminho #F4EDE1
   - Badge Mono para termo original (grego/hebraico) ou contexto editorial
   - Marca-texto #E5A93C e sublinhado SVG no start_ms exato da palavra
   - Carimbo terracota #9E3B2E opcional (stamp_drop)
   ============================================================================ */

(function () {
  "use strict";

  function chunkKineticBlocks(words, maxWords, durationMs, fallbackText) {
    const limit = Math.max(4, Math.min(6, maxWords || 5));

    if (!words.length) {
      const syntheticTokens = String(fallbackText || "VOX BÍBLICO")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      const step = Math.max(180, Math.floor((durationMs - 400) / Math.max(1, syntheticTokens.length)));
      const synth = syntheticTokens.map((text, idx) => ({
        word_id: `syn_${idx}`,
        text,
        local_start_ms: 140 + idx * step,
        local_end_ms: 140 + (idx + 1) * step,
      }));
      return [{ words: synth, startMs: 0, endMs: durationMs + 100 }];
    }

    const groups = [];
    let current = [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      current.push(w);
      const endsPunct = /[.!?;:]$/.test(w.text);
      const chars = current.reduce((acc, item) => acc + item.text.length + 1, 0);
      if (current.length >= limit || (endsPunct && current.length >= 2) || (chars >= 28 && current.length >= 4)) {
        groups.push(current);
        current = [];
      }
    }
    if (current.length) groups.push(current);

    return groups.map((groupWords, idx) => {
      const next = groups[idx + 1];
      const startMs = idx === 0 ? 0 : Math.max(0, groupWords[0].local_start_ms - 55);
      const endMs = next ? Math.max(startMs + 250, next[0].local_start_ms - 55) : durationMs + 200;
      return { words: groupWords, startMs, endMs };
    });
  }

  function splitLexiconSubtext(subtext, headline, originalTerm) {
    const orig = String(originalTerm || "").trim();
    const raw = String(subtext || "").trim();
    if (orig) {
      return { tag: raw && !raw.includes(orig) ? raw.split("·")[0].trim() : "ORIGINAL", term: orig };
    }
    if (!raw && !headline) return null;
    if (raw.includes("·")) {
      const parts = raw.split("·").map((s) => s.trim()).filter(Boolean);
      return { tag: parts[0] || "TERMO", term: parts.slice(1).join(" · ") || headline || "" };
    }
    if (raw) {
      return { tag: "ORIGINAL", term: raw };
    }
    return { tag: "DESTAQUE", term: headline };
  }

  window.__STUDIO__.registerTemplate("kinetic_captions", function createKineticCaptions(ctx) {
    const { root, visual, preset, theme, words, durationMs, Math: M } = ctx;
    const minWordOpacity = theme === "carvao" || theme === "azul_marinho" ? 0.52 : 0.46;

    const maxPerBlock = (preset && preset.typography && preset.typography.max_words_per_kinetic_block) || 6;
    const headline = String(visual.headline || "").trim();
    const subtext = String(visual.subtext || "").trim();
    const hlIdSet = new Set(visual.highlight_word_ids || []);
    const headlineNorms = new Set(
      headline
        .split(/\s+/)
        .map((s) => M.normalizeToken(s))
        .filter((s) => s.length >= 4)
    );

    const blocks = chunkKineticBlocks(words, Math.min(5, maxPerBlock), durationMs, headline);
    const lexicon = splitLexiconSubtext(subtext, headline, visual.original_term);

    const showStamp =
      String(visual.transition_in || "").toLowerCase() === "stamp_drop" ||
      Boolean(visual.stamp_text);
    const stampLabel =
      visual.stamp_text ||
      (/mito/i.test(`${headline} ${subtext}`) ? "MITO" : /nunca|não|nao/i.test(headline) ? "ATENÇÃO" : "DESTAQUE");

    // Encontra instante do carimbo (âncora na 1ª highlight_word ou 220ms)
    let stampTriggerMs = 220;
    const firstHlWord = words.find((w) => hlIdSet.has(w.word_id));
    if (firstHlWord) {
      stampTriggerMs = Math.max(140, Math.min(firstHlWord.local_start_ms, durationMs * 0.45));
    }

    const blocksHtml = blocks
      .map((block, bIdx) => {
        const denseClass = block.words.length >= 5 || block.words.some((w) => w.text.length >= 12) ? " is-dense" : "";
        const wordsHtml = block.words
          .map((w, wIdx) => {
            const norm = M.normalizeToken(w.text);
            const isHl = hlIdSet.has(w.word_id) || (hlIdSet.size === 0 && headlineNorms.has(norm));
            const hlBar = isHl ? `<span class="kc-word-hl"></span>` : "";
            const underlineSvg = !isHl
              ? `<svg class="kc-word-underline" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
                   <path class="kc-ul-path" d="M2,6 Q50,2 98,7" fill="none" stroke="#E5A93C" stroke-width="5" stroke-linecap="round" />
                 </svg>`
              : "";
            return `<span class="kc-word" data-b="${bIdx}" data-w="${wIdx}" data-hl="${isHl ? "1" : "0"}">${hlBar}${M.escapeHtml(w.text)}${underlineSvg}</span>`;
          })
          .join("");
        return `<div class="kc-block${denseClass}" data-block="${bIdx}">${wordsHtml}</div>`;
      })
      .join("");

    // Só exibe anchor headline separadamente se ele trouxer síntese distinta do bloco único
    const showAnchorHeadline =
      headline.length > 0 &&
      (!lexicon || M.normalizeToken(headline) !== M.normalizeToken(lexicon.term));

    root.innerHTML = `
      <div class="kc-scene">
        ${
          lexicon
            ? `<div class="kc-lexicon-card">
                 <span class="kc-lex-tag">${M.escapeHtml(lexicon.tag)}</span>
                 <span class="kc-lex-divider"></span>
                 <span class="kc-lex-term">${M.escapeHtml(lexicon.term)}</span>
               </div>`
            : ""
        }

        ${showAnchorHeadline ? `<div class="kc-anchor-headline">${M.escapeHtml(headline)}</div>` : ""}

        <div class="kc-blocks-stage">
          ${blocksHtml}
        </div>

        <div class="kc-editorial-rail">
          <span class="kc-rail-badge">VOX · ANÁLISE</span>
          <span class="kc-rail-text">${M.escapeHtml(subtext || headline || "Leitura Editorial")}</span>
        </div>

        ${
          showStamp
            ? `<div class="vox-stamp kc-stamp" style="top:18px;right:12px;">${M.escapeHtml(stampLabel)}</div>`
            : ""
        }
      </div>
    `;

    const lexCard = root.querySelector(".kc-lexicon-card");
    const anchorEl = root.querySelector(".kc-anchor-headline");
    const railEl = root.querySelector(".kc-editorial-rail");
    const stampEl = root.querySelector(".kc-stamp");

    const blockEntries = blocks.map((block, bIdx) => {
      const el = root.querySelector(`.kc-block[data-block="${bIdx}"]`);
      const wordEntries = block.words.map((w, wIdx) => {
        const wEl = el.querySelector(`.kc-word[data-w="${wIdx}"]`);
        const hlEl = wEl.querySelector(".kc-word-hl");
        const ulPath = wEl.querySelector(".kc-ul-path");
        if (ulPath) {
          ulPath.style.strokeDasharray = "110";
          ulPath.style.strokeDashoffset = "110";
        }
        return {
          word: w,
          el: wEl,
          hlEl,
          ulPath,
          isHl: wEl.dataset.hl === "1",
        };
      });
      return { block, el, wordEntries };
    });

    return {
      seek(t) {
        // 1. Badge Mono de Termo Original
        if (lexCard) {
          const lp = M.expoOut(M.progress(t, 60, 320));
          lexCard.style.opacity = String(lp);
          lexCard.style.transform = `translate3d(${M.lerp(-38, 0, lp).toFixed(2)}px, 0, 0)`;
        }

        // 2. Anchor Headline editorial
        if (anchorEl) {
          const ap = M.power3Out(M.progress(t, 120, 300));
          anchorEl.style.opacity = String(ap);
          anchorEl.style.transform = `translate3d(0, ${M.lerp(20, 0, ap).toFixed(2)}px, 0)`;
        }

        // 3. Blocos cinéticos (4–6 palavras por bloco, troca limpa sincronizada à fala)
        blockEntries.forEach(({ block, el, wordEntries }) => {
          const isVisible = t >= block.startMs && t < block.endMs;
          if (!isVisible) {
            el.style.opacity = "0";
            el.style.pointerEvents = "none";
            el.style.transform = "translate3d(0, -50%, 0)";
            return;
          }

          // Saída sutil nos últimos 90ms do bloco (exceto no último)
          const fadeOut = block.endMs < durationMs
            ? 1 - M.progress(t, block.endMs - 90, 90)
            : 1;
          const blockIntro = M.power3Out(M.progress(t, block.startMs, 180));
          el.style.opacity = String((blockIntro * fadeOut).toFixed(3));
          el.style.transform = `translate3d(0, calc(-50% + ${M.lerp(18, 0, blockIntro).toFixed(2)}px), 0)`;

          wordEntries.forEach(({ word, el: wEl, hlEl, ulPath, isHl }) => {
            const wStart = Math.max(block.startMs, word.local_start_ms - 40);
            const enterP = M.backOut(M.progress(t, wStart, 220), 1.35);
            const revealP = M.progress(t, wStart, 110);
            const opacity = M.lerp(minWordOpacity, 1.0, revealP);
            const isSpeaking = t >= word.local_start_ms && t <= word.local_end_ms + 50;

            const ty = M.lerp(14, 0, enterP);
            const sc = M.lerp(0.96, isSpeaking ? 1.03 : 1.0, enterP);

            wEl.style.opacity = String(opacity.toFixed(3));
            wEl.style.transform = `translate3d(0, ${ty.toFixed(2)}px, 0) scale(${sc.toFixed(4)})`;

            if (isHl && hlEl) {
              const hlP = M.expoOut(M.progress(t, word.local_start_ms, 260));
              hlEl.style.transform = `scaleX(${hlP.toFixed(4)}) rotate(-0.8deg)`;
              wEl.classList.toggle("is-highlight-active", hlP > 0.35);
            } else if (ulPath) {
              // Sublinhado sutil apenas enquanto a palavra é falada
              const ulP = isSpeaking
                ? M.expoOut(M.progress(t, word.local_start_ms, Math.max(140, word.local_end_ms - word.local_start_ms)))
                : 0;
              ulPath.style.strokeDashoffset = String((110 * (1 - ulP)).toFixed(2));
              ulPath.style.opacity = isSpeaking ? "0.85" : "0";
            }
          });
        });

        // 4. Barra editorial inferior da cena
        if (railEl) {
          const rp = M.power3Out(M.progress(t, 220, 320));
          railEl.style.opacity = String(rp);
          railEl.style.transform = `translate3d(0, ${M.lerp(16, 0, rp).toFixed(2)}px, 0)`;
        }

        // 5. Carimbo terracota #9E3B2E (stamp_drop)
        if (stampEl) {
          const stP = M.backOut(M.progress(t, stampTriggerMs, 260), 1.7);
          const stOp = M.clamp(M.progress(t, stampTriggerMs, 90), 0, 1);
          stampEl.style.opacity = String(stOp.toFixed(3));
          stampEl.style.transform =
            `scale(${M.lerp(1.9, 1.0, stP).toFixed(4)}) rotate(${M.lerp(-18, -7.5, stP).toFixed(2)}deg)`;
        }
      },
    };
  });
})();
