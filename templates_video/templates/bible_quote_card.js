/* ============================================================================
   Template 2: bible_quote_card (Citação Bíblica Editorial — Redesign Limpo)
   - ELIMINA o visual burocrático e o selo padrão "TEXTO VERIFICADO"
   - Prancha documental leve com filete dourado animado via SVG (stroke-dashoffset)
   - Referência editorial discreta em Azul-Marinho/Dourado + aspas com paralaxe
   - Marcador-texto dourado #E5A93C sincronizado às palavras + suporte a beats[]
   - 100% retrocompatível com projetos anteriores (ex: piloto-makarios)
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
    const { root, visual, preset, words, beats, durationMs, scriptureRef, assetEntry, imageLayout, Math: M } = ctx;
    const useInlineCard = Boolean(assetEntry && imageLayout === "card");
    const fitStyle = visual.image_fit === "contain" ? "object-fit:contain;" : "object-fit:cover;";
    const opStyle = `opacity:${M.clamp(Number(visual.image_opacity) || 1.0, 0.1, 1.0)};`;

    // Jamais renderiza o selo burocrático "TEXTO VERIFICADO" (rejeitado pelo usuário).
    // Só exibe nota/selo editorial se o diretor passar explicitamente show_stamp=true e stamp_text válido.
    const rawStamp = String(visual.stamp_text || "").trim();
    const isForbidden = window.__STUDIO__ && window.__STUDIO__.isForbiddenSeal(rawStamp);
    const showCustomNote = visual.show_stamp === true && rawStamp.length > 0 && !isForbidden;

    const citationLabel = resolveCitationLabel(scriptureRef, visual, preset);
    const verseText = resolveVerseText(scriptureRef, visual, words);
    const footerKicker =
      visual.headline && M.normalizeToken(visual.headline) !== M.normalizeToken(citationLabel)
        ? visual.headline
        : visual.original_term || visual.subtext || "Leitura no Contexto Original";

    // Mapeia palavras-chave de highlight_word_ids -> timing local exato
    const hlIdSet = new Set(visual.highlight_word_ids || []);
    const hlTimingByNorm = Object.create(null);
    words.forEach((w) => {
      if (hlIdSet.has(w.word_id)) {
        const key = M.normalizeToken(w.text);
        if (key && hlTimingByNorm[key] === undefined) {
          hlTimingByNorm[key] = Math.max(360, w.local_start_ms);
        }
      }
    });

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

    if (!tokenPlans.some((p) => p.highlight)) {
      let matchedHeadline = false;
      tokenPlans.forEach((p, idx) => {
        if (headlineNorms.has(p.norm)) {
          p.highlight = true;
          p.highlightStartMs = 480 + idx * 110;
          matchedHeadline = true;
        }
      });

      if (!matchedHeadline && tokenPlans.length > 0) {
        const candidates = tokenPlans.filter((p) => p.norm.length >= 5);
        const picks = (candidates.length ? candidates : tokenPlans).slice(0, Math.min(3, tokenPlans.length));
        const step = Math.max(260, Math.min(520, (durationMs - 900) / Math.max(1, picks.length)));
        picks.forEach((p, i) => {
          p.highlight = true;
          p.highlightStartMs = Math.round(480 + i * step);
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
      <div class="bq-scene bq-editorial-clean">
        <div class="bq-watermark-quote bq-watermark-open" aria-hidden="true">“</div>
        <div class="bq-watermark-quote bq-watermark-close" aria-hidden="true">”</div>

        <article class="bq-editorial-sheet">
          <!-- Filete editorial dourado desenhado ao vivo (esquerda + topo) -->
          <svg class="bq-frame-svg" viewBox="0 0 800 840" preserveAspectRatio="none" aria-hidden="true">
            <path class="bq-frame-path" d="M 8,832 L 8,8 L 280,8" fill="none" stroke="#E5A93C" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1120" stroke-dashoffset="1120" />
          </svg>

          <div class="bq-ref-bar">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5V5.5Z" stroke="#E5A93C" stroke-width="2.2" stroke-linejoin="round"/>
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke="#E5A93C" stroke-width="2.2"/>
            </svg>
            <span>${M.escapeHtml(citationLabel)}</span>
          </div>

          ${
            useInlineCard
              ? `<div class="tpl-inline-media-card" style="height:260px;">
                   <div class="tpl-inline-media-inner">
                     <img class="tpl-inline-media-img" style="${fitStyle}${opStyle}" src="${M.escapeHtml(assetEntry.url)}" alt="${M.escapeHtml(citationLabel)}" />
                   </div>
                 </div>`
              : ""
          }

          <blockquote class="bq-verse-text" style="font-size:${useInlineCard ? Math.min(44, fitVerseFontSize(verseText)) : fitVerseFontSize(verseText)}px;">
            ${verseHtml}
          </blockquote>

          <div class="bq-footer">
            <div class="bq-footer-rule"><div class="bq-footer-rule-fill"></div></div>
            <div class="bq-footer-row">
              <div class="bq-footer-kicker">${M.escapeHtml(footerKicker)}</div>
              ${showCustomNote ? `<div class="bq-footer-note-pill">${M.escapeHtml(rawStamp)}</div>` : ""}
            </div>
          </div>
        </article>
      </div>
    `;

    const wmOpen = root.querySelector(".bq-watermark-open");
    const wmClose = root.querySelector(".bq-watermark-close");
    const sheetEl = root.querySelector(".bq-editorial-sheet");
    const framePath = root.querySelector(".bq-frame-path");
    const refBar = root.querySelector(".bq-ref-bar");
    const footerEl = root.querySelector(".bq-footer");
    const footerKickerEl = root.querySelector(".bq-footer-kicker");
    const footerRuleFill = root.querySelector(".bq-footer-rule-fill");
    const wordEls = Array.from(root.querySelectorAll(".bq-word"));
    const inlineImg = root.querySelector(".tpl-inline-media-img");

    return {
      seek(t, pGlobal, beatState, tReal) {
        const tm = Number.isFinite(tReal) ? tReal : t;

        // 1. Aspas gigantes em marca d'água com paralaxe contínua
        const wmP = M.power3Out(M.progress(tm, 40, 520));
        wmOpen.style.opacity = String(wmP);
        wmOpen.style.transform = `translate3d(${M.lerp(-24, 20, pGlobal).toFixed(2)}px, ${M.lerp(-18, 16, pGlobal).toFixed(2)}px, 0)`;
        wmClose.style.opacity = String(wmP);
        wmClose.style.transform = `translate3d(${M.lerp(22, -20, pGlobal).toFixed(2)}px, ${M.lerp(18, -16, pGlobal).toFixed(2)}px, 0)`;

        // 2. Prancha editorial limpa com flutuação respiratória contínua
        const sheetP = M.power3Out(M.progress(tm, 80, 480));
        const breatheY = Math.sin(pGlobal * Math.PI * 2) * 5;
        sheetEl.style.opacity = String(M.clamp(M.progress(tm, 60, 220), 0, 1));
        sheetEl.style.transform =
          `translate3d(0, ${(M.lerp(42, 0, sheetP) + breatheY).toFixed(2)}px, 0) scale(${M.lerp(0.96, 1.0, sheetP).toFixed(4)})`;

        // 3. Filete dourado SVG desenhando ao longo da cena
        const frameP = M.expoOut(M.progress(tm, 100, Math.min(2000, durationMs * 0.65)));
        framePath.style.strokeDashoffset = String((1120 * (1 - frameP)).toFixed(1));

        // 4. Barra de referência
        const refP = M.expoOut(M.progress(tm, 160, 340));
        refBar.style.opacity = String(refP);
        refBar.style.transform = `translate3d(${M.lerp(-28, 0, refP).toFixed(2)}px, 0, 0)`;

        // 5. Revelação editorial suave das palavras + marca-texto #E5A93C progressivo
        const staggerPerWord = Math.min(38, Math.max(18, (durationMs * 0.42) / Math.max(1, wordEls.length)));
        wordEls.forEach((wEl, idx) => {
          const wStart = 200 + idx * staggerPerWord;
          const wP = M.power3Out(M.progress(tm, wStart, 240));
          wEl.style.opacity = String(M.lerp(0.15, 1.0, wP).toFixed(3));
          wEl.style.transform = `translate3d(0, ${M.lerp(14, 0, wP).toFixed(2)}px, 0)`;

          const plan = tokenPlans[idx];
          if (plan && plan.highlight) {
            const hlEl = wEl.querySelector(".bq-word-hl");
            if (hlEl) {
              const hlP = M.expoOut(M.progress(tm, plan.highlightStartMs, 380));
              hlEl.style.transform = `scaleX(${hlP.toFixed(4)}) rotate(-0.6deg)`;
            }
          }
        });

        // 6. Rodapé com evolução por beats (se houver)
        if (inlineImg && window.__STUDIO__ && typeof window.__STUDIO__.evaluateImageTransform === "function") {
          const imgTf = window.__STUDIO__.evaluateImageTransform(visual, pGlobal, tm, durationMs);
          inlineImg.style.transform = imgTf.css;
        }
        const footP = M.power3Out(M.progress(tm, 480, 360));
        footerEl.style.opacity = String(footP);
        footerEl.style.transform = `translate3d(0, ${M.lerp(14, 0, footP).toFixed(2)}px, 0)`;
        footerRuleFill.style.transform = `scaleX(${M.expoOut(M.progress(tm, 420, Math.min(1600, durationMs * 0.55))).toFixed(4)})`;

        if (beatState && beatState.hasBeats && beatState.activeBeat && beatState.activeBeat.headline && footerKickerEl) {
          const nextText = beatState.activeBeat.headline;
          if (footerKickerEl.dataset.lastText !== nextText) {
            footerKickerEl.textContent = nextText;
            footerKickerEl.dataset.lastText = nextText;
          }
        }
      },
    };
  });
})();
