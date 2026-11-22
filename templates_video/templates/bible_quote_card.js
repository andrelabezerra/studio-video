/* ============================================================================
   Template 2: bible_quote_card (Cartão Editorial de Versículo Vox Bíblico)
   - Cartão inclinado (-1.4deg) com borda rasgada SVG e sombra multicamadas
   - Barra de referência em Azul-Marinho #1E3A5F (ex.: Mateus 5:3 · NVI)
   - Marcador-texto dourado #E5A93C animado progressivamente nas palavras-chave
   - Aspas tipográficas gigantes em marca d'água + micro-paralaxe contínua
   ============================================================================ */

(function () {
  "use strict";

  function fitVerseFontSize(text) {
    const len = String(text || "").length;
    if (len <= 62) return 56;
    if (len <= 95) return 49;
    if (len <= 135) return 43;
    return 37;
  }

  function resolveVerseText(scriptureRef, visual, words) {
    if (scriptureRef && typeof scriptureRef.exact_text === "string" && scriptureRef.exact_text.trim()) {
      return scriptureRef.exact_text.trim();
    }
    if (words && words.length > 0) {
      return words.map((w) => w.text).join(" ").trim();
    }
    return visual.headline || "Bem-aventurados os pobres em espírito, pois deles é o Reino dos céus.";
  }

  function resolveCitationLabel(scriptureRef, visual, preset) {
    const defaultTr = (preset && preset.default_bible_translation) || "NVI";
    if (scriptureRef && scriptureRef.citation) {
      const tr = scriptureRef.translation || defaultTr;
      return `${scriptureRef.citation} · ${tr}`;
    }
    if (visual.subtext) return visual.subtext;
    if (visual.headline) return `${visual.headline} · ${defaultTr}`;
    return `TEXTO BÍBLICO · ${defaultTr}`;
  }

  window.__STUDIO__.registerTemplate("bible_quote_card", function createBibleQuoteCard(ctx) {
    const { root, visual, preset, words, durationMs, scriptureRef, Math: M } = ctx;

    const citationLabel = resolveCitationLabel(scriptureRef, visual, preset);
    const verseText = resolveVerseText(scriptureRef, visual, words);
    const footerKicker =
      visual.headline && M.normalizeToken(visual.headline) !== M.normalizeToken(citationLabel)
        ? visual.headline
        : visual.subtext || "Leitura no Contexto Original";

    // Mapeia palavras-chave de highlight_word_ids -> timing local exato
    const hlIdSet = new Set(visual.highlight_word_ids || []);
    const hlTimingByNorm = Object.create(null);
    words.forEach((w) => {
      if (hlIdSet.has(w.word_id)) {
        const key = M.normalizeToken(w.text);
        if (key && hlTimingByNorm[key] === undefined) {
          hlTimingByNorm[key] = Math.max(380, w.local_start_ms);
        }
      }
    });

    // Também checa palavras do headline caso highlight_word_ids não coincida diretamente com o texto do versículo
    const headlineNorms = new Set(
      String(visual.headline || "")
        .split(/\s+/)
        .map((s) => M.normalizeToken(s))
        .filter((s) => s.length >= 4)
    );

    const verseTokens = verseText.split(/\s+/).filter(Boolean);
    const tokenPlans = verseTokens.map((tok, idx) => {
      const norm = M.normalizeToken(tok);
      const isDirectHl = norm && hlTimingByNorm[norm] !== undefined;
      return {
        text: tok,
        norm,
        idx,
        highlight: isDirectHl,
        highlightStartMs: isDirectHl ? hlTimingByNorm[norm] : null,
      };
    });

    // Fallback inteligente se highlight_word_ids não casou textualmente com o versículo
    if (!tokenPlans.some((p) => p.highlight)) {
      let matchedHeadline = false;
      tokenPlans.forEach((p, idx) => {
        if (headlineNorms.has(p.norm)) {
          p.highlight = true;
          p.highlightStartMs = 520 + idx * 110;
          matchedHeadline = true;
        }
      });

      if (!matchedHeadline && tokenPlans.length > 0) {
        // Destaca os primeiros 1–3 termos substantivos fortes do versículo progressivamente
        const candidates = tokenPlans.filter((p) => p.norm.length >= 5);
        const picks = (candidates.length ? candidates : tokenPlans).slice(0, Math.min(3, tokenPlans.length));
        const step = Math.max(260, Math.min(480, (durationMs - 900) / Math.max(1, picks.length)));
        picks.forEach((p, i) => {
          p.highlight = true;
          p.highlightStartMs = Math.round(520 + i * step);
        });
      }
    }

    const verseHtml = tokenPlans
      .map((p, idx) => {
        const hlSpan = p.highlight ? `<span class="bq-word-hl" data-hl-idx="${idx}"></span>` : "";
        return `<span class="bq-word" data-idx="${idx}">${hlSpan}${M.escapeHtml(p.text)}</span>`;
      })
      .join("");

    root.innerHTML = `
      <div class="bq-scene">
        <div class="bq-watermark-quote bq-watermark-open" aria-hidden="true">“</div>
        <div class="bq-watermark-quote bq-watermark-close" aria-hidden="true">”</div>

        <div class="bq-back-card" aria-hidden="true"></div>

        <div class="bq-card-shadow">
          <div class="vox-tape bq-tape-top"></div>
          <article class="bq-card-surface">
            <!-- Marcas editoriais sutis de registro -->
            <svg class="bq-margin-marks" viewBox="0 0 788 700" preserveAspectRatio="none" aria-hidden="true">
              <path d="M12,26 L12,12 L26,12 M762,12 L776,12 L776,26 M12,674 L12,688 L26,688 M762,688 L776,688 L776,674"
                    fill="none" stroke="#1E3A5F" stroke-width="2" opacity="0.22" />
            </svg>

            <div class="bq-ref-bar">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5V5.5Z" stroke="#E5A93C" stroke-width="2.2" stroke-linejoin="round"/>
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke="#E5A93C" stroke-width="2.2"/>
              </svg>
              <span>${M.escapeHtml(citationLabel)}</span>
            </div>

            <blockquote class="bq-verse-text" style="font-size:${fitVerseFontSize(verseText)}px;">
              ${verseHtml}
            </blockquote>

            <div class="bq-footer">
              <div class="bq-footer-kicker">${M.escapeHtml(footerKicker)}</div>
              <div class="bq-footer-seal">TEXTO VERIFICADO</div>
            </div>
          </article>
        </div>
      </div>
    `;

    const wmOpen = root.querySelector(".bq-watermark-open");
    const wmClose = root.querySelector(".bq-watermark-close");
    const backCard = root.querySelector(".bq-back-card");
    const cardShadow = root.querySelector(".bq-card-shadow");
    const tapeTop = root.querySelector(".bq-tape-top");
    const refBar = root.querySelector(".bq-ref-bar");
    const footerEl = root.querySelector(".bq-footer");
    const wordEls = Array.from(root.querySelectorAll(".bq-word"));

    return {
      seek(t, pGlobal) {
        // 1. Aspas gigantes em marca d'água com micro-paralaxe contínua
        const wmP = M.power3Out(M.progress(t, 40, 520));
        wmOpen.style.opacity = String(wmP);
        wmOpen.style.transform = `translate3d(${M.lerp(-24, 14, pGlobal).toFixed(2)}px, ${M.lerp(-18, 12, pGlobal).toFixed(2)}px, 0)`;
        wmClose.style.opacity = String(wmP);
        wmClose.style.transform = `translate3d(${M.lerp(22, -16, pGlobal).toFixed(2)}px, ${M.lerp(18, -14, pGlobal).toFixed(2)}px, 0)`;

        // 2. Cartão de apoio azul-marinho atrás (inclinação oposta para profundidade tátil)
        const backP = M.backOut(M.progress(t, 60, 440), 1.2);
        const backRot = M.lerp(5.2, 2.0, backP) - pGlobal * 0.6;
        backCard.style.opacity = String(M.clamp(M.progress(t, 40, 220), 0, 1));
        backCard.style.transform =
          `translate3d(${M.lerp(30, 12, backP).toFixed(2)}px, ${M.lerp(54, 14, backP).toFixed(2)}px, 0) rotate(${backRot.toFixed(2)}deg)`;

        // 3. Cartão principal de versículo inclinado (-1.4deg) com entrada back.out + micro-paralaxe
        const cardP = M.backOut(M.progress(t, 100, 480), 1.35);
        const cardY = M.lerp(90, 0, cardP) + Math.sin(pGlobal * Math.PI) * -6;
        const cardScale = M.lerp(0.90, 1.0, cardP);
        const cardRot = M.lerp(-4.0, -1.4, cardP) + Math.sin(pGlobal * Math.PI * 1.2) * 0.25;
        cardShadow.style.opacity = String(M.clamp(M.progress(t, 80, 200), 0, 1));
        cardShadow.style.transform =
          `translate3d(0, ${cardY.toFixed(2)}px, 0) scale(${cardScale.toFixed(4)}) rotate(${cardRot.toFixed(2)}deg)`;

        // 4. Fita crepe superior
        const tapeP = M.expoOut(M.progress(t, 280, 220));
        tapeTop.style.opacity = String(tapeP);
        tapeTop.style.transform = `translate3d(0, ${M.lerp(-22, 0, tapeP).toFixed(2)}px, 0) rotate(-2.2deg)`;

        // 5. Barra de referência Azul-Marinho #1E3A5F
        const refP = M.expoOut(M.progress(t, 220, 340));
        refBar.style.opacity = String(refP);
        refBar.style.transform = `translate3d(${M.lerp(-36, 0, refP).toFixed(2)}px, 0, 0)`;

        // 6. Revelação editorial suave das palavras + marcador-texto #E5A93C progressivo
        const staggerPerWord = Math.min(34, 420 / Math.max(1, wordEls.length));
        wordEls.forEach((wEl, idx) => {
          const wStart = 240 + idx * staggerPerWord;
          const wP = M.power3Out(M.progress(t, wStart, 220));
          wEl.style.opacity = String(wP);
          wEl.style.transform = `translate3d(0, ${M.lerp(16, 0, wP).toFixed(2)}px, 0)`;

          const plan = tokenPlans[idx];
          if (plan && plan.highlight) {
            const hlEl = wEl.querySelector(".bq-word-hl");
            if (hlEl) {
              const hlP = M.expoOut(M.progress(t, plan.highlightStartMs, 360));
              hlEl.style.transform = `scaleX(${hlP.toFixed(4)}) rotate(-0.6deg)`;
            }
          }
        });

        // 7. Rodapé do cartão
        const footP = M.power3Out(M.progress(t, 520, 340));
        footerEl.style.opacity = String(footP);
        footerEl.style.transform = `translate3d(0, ${M.lerp(14, 0, footP).toFixed(2)}px, 0)`;
      },
    };
  });
})();
