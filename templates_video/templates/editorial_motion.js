/* ============================================================================
   Template: editorial_motion (Palco Cinematográfico Livre Multi-Beats)
   - 100% Determinístico em seek(tEffective, pGlobal, beatState, tReal)
   - Zero CSS animations/transitions, zero rAF, 100% Offline
   - Estritamente dentro das Safe-Zones 9:16 (x: 76..908, y: 294..1314)
   - 8 Composições Coreografadas via SVG + Tipografia Cinética + motion_data:
     1) counter_impact      — Contador monumental animado + escala de impacto
     2) debt_scale          — Balança SVG articulada com desproporção & beats
     3) forgiveness_seal    — Pergaminho de dívida riscado com tinta viva + selo orgânico
     4) dramatic_split      — Split-screen vertical diagonal com foco dinâmico por beats
     5) rhetorical_question — Pergunta retórica monumental com `?` SVG e marca-texto
     6) scripture_spotlight — Citação bíblica editorial limpa (ZERO selo burocrático)
     7) grace_illumination  — Correntes que se partem + raios dourados de graça
     8) narrative_arc       — Arco dramático contínuo em 3 atos sincronizados a beats
   ============================================================================ */

(function () {
  "use strict";

  function fitFont(text, base, min, thresholds) {
    const len = String(text || "").trim().length;
    const t1 = thresholds[0] || 18;
    const t2 = thresholds[1] || 32;
    const t3 = thresholds[2] || 48;
    if (len <= t1) return base;
    if (len <= t2) return Math.max(min, Math.round(base * 0.84));
    if (len <= t3) return Math.max(min, Math.round(base * 0.70));
    return min;
  }

  function resolveComposition(visual, motionData, scriptureRef) {
    const raw = String((visual && visual.composition) || "auto").toLowerCase().trim();
    const valid = [
      "debt_scale",
      "forgiveness_seal",
      "dramatic_split",
      "rhetorical_question",
      "grace_illumination",
      "narrative_arc",
      "counter_impact",
      "scripture_spotlight",
    ];
    if (valid.indexOf(raw) !== -1) return raw;

    // Auto-detecção inteligente
    if (scriptureRef && scriptureRef.exact_text) return "scripture_spotlight";
    const md = motionData || {};
    if (md.counter_to !== undefined || md.counter_from !== undefined) return "counter_impact";
    if (md.top_title || md.bottom_title) return "dramatic_split";
    if (md.left_label || md.right_label) return "debt_scale";
    if (Array.isArray(md.steps) && md.steps.length >= 2) return "narrative_arc";

    const bag = `${visual.headline || ""} ${visual.subtext || ""} ${visual.original_term || ""}`.toLowerCase();
    if (/\?/.test(visual.headline || "")) return "rhetorical_question";
    if (/perd[aã]o|cancelad|livre|decreto/.test(bag)) return "forgiveness_seal";
    if (/gra[cç]a|luz|transform|corrente/.test(bag)) return "grace_illumination";
    if (/balan[cç]a|d[ií]vida|peso|cobr/.test(bag)) return "debt_scale";
    if (/vs\b|versus|contraste|enquanto/.test(bag)) return "dramatic_split";
    return "narrative_arc";
  }

  function accentColorForEmphasis(emphasis, isDark) {
    if (emphasis === "terracotta") return isDark ? "#E86A58" : "#9E3B2E";
    if (emphasis === "navy") return isDark ? "#7EA6D8" : "#1E3A5F";
    if (emphasis === "light") return isDark ? "#FAF6EE" : "#181A1F";
    return "#E5A93C";
  }

  function buildBeatIndicatorHtml(beats, M) {
    if (!beats || beats.length <= 1) return "";
    return `
      <div class="em-beat-dots" aria-hidden="true">
        ${beats
          .map(
            (b, i) =>
              `<span class="em-beat-dot" data-beat-dot="${i}" title="${M.escapeHtml(b.beat_id)}"></span>`
          )
          .join("")}
      </div>
    `;
  }

  function updateBeatDots(root, beatState) {
    const dots = root.querySelectorAll(".em-beat-dot");
    dots.forEach((el, i) => {
      el.classList.toggle("is-active", beatState.hasBeats && i === beatState.activeIndex);
      el.classList.toggle("is-done", beatState.hasBeats && i < beatState.activeIndex);
    });
  }

  function applyBeatTextSwap(el, targetText, prevText, beatState, M) {
    if (!el || !targetText) return;
    if (el.dataset.lastText !== targetText) {
      el.textContent = targetText;
      el.dataset.lastText = targetText;
    }
    if (beatState && beatState.hasBeats && prevText && prevText !== targetText) {
      const p = M.power3Out(M.progress(beatState.localT, 0, 340));
      el.style.opacity = String(M.lerp(0.25, 1.0, p).toFixed(3));
      el.style.transform = `translate3d(0, ${M.lerp(14, 0, p).toFixed(2)}px, 0)`;
    }
  }

  function highlightWordsHtml(text, emphasisList, hlWordsNorm, M) {
    const tokens = String(text || "").trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return "";
    const empSet = new Set(
      (Array.isArray(emphasisList) ? emphasisList : [])
        .map((w) => M.normalizeToken(w))
        .filter(Boolean)
    );
    return tokens
      .map((tok, idx) => {
        const norm = M.normalizeToken(tok);
        const isHl = empSet.has(norm) || (hlWordsNorm && hlWordsNorm.has(norm));
        return `<span class="em-kword${isHl ? " is-hl" : ""}" data-kw-idx="${idx}">${isHl ? '<span class="em-kword-bar"></span>' : ""}${M.escapeHtml(tok)}</span>`;
      })
      .join(" ");
  }

  /* ==========================================================================
     1) COMPOSIÇÃO: counter_impact (Escala Numérica Monumental + Contraste)
     ========================================================================== */
  function mountCounterImpact(ctx) {
    const { root, visual, theme, beats, motionData: md, durationMs, Math: M } = ctx;
    const isDark = theme === "carvao" || theme === "azul_marinho";

    const counterFrom = Number.isFinite(Number(md.counter_from)) ? Number(md.counter_from) : 0;
    const counterTo = Number.isFinite(Number(md.counter_to)) ? Number(md.counter_to) : 10000;
    const prefix = String(md.counter_prefix || "");
    const suffix = String(md.counter_suffix || "");
    const unitLabel = String(md.unit_label || visual.original_term || "ESCALA BÍBLICA").toUpperCase();
    const compareValue = md.compare_value !== undefined && md.compare_value !== null ? String(md.compare_value) : "";
    const compareLabel = String(md.compare_label || visual.subtext || "IMPOSSÍVEL PAGAR");
    const footnote = String(md.footnote || "");
    const baseHeadline = String(visual.headline || "UMA DÍVIDA IMPAGÁVEL");
    const baseSubtext = String(visual.subtext || "Mateus 18:21–35");

    const strokePrimary = isDark ? "#F4EDE1" : "#1E3A5F";

    root.innerHTML = `
      <div class="em-scene em-counter-scene">
        <div class="em-top-bar">
          <span class="em-kicker-pill">${M.escapeHtml(baseSubtext)}</span>
          ${buildBeatIndicatorHtml(beats, M)}
        </div>

        <div class="em-counter-hero">
          <svg class="em-counter-svg" viewBox="0 0 760 520" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <!-- Anéis radiais gravados -->
            <circle class="em-ring-outer" cx="380" cy="245" r="210" fill="none" stroke="${strokePrimary}" stroke-opacity="0.16" stroke-width="2" stroke-dasharray="8 8" />
            <circle class="em-ring-arc" cx="380" cy="245" r="188" fill="none" stroke="#E5A93C" stroke-width="6" stroke-linecap="round"
                    stroke-dasharray="1182" stroke-dashoffset="1182" transform="rotate(-90 380 245)" />
            <circle class="em-ring-inner" cx="380" cy="245" r="154" fill="none" stroke="#9E3B2E" stroke-opacity="0.45" stroke-width="2.5" stroke-dasharray="4 7" />

            <!-- Marcas radiais de bússola / relógio editorial -->
            <g class="em-ticks" stroke="${strokePrimary}" stroke-opacity="0.32" stroke-width="2">
              <line x1="380" y1="22" x2="380" y2="42" />
              <line x1="380" y1="448" x2="380" y2="468" />
              <line x1="156" y1="245" x2="176" y2="245" />
              <line x1="584" y1="245" x2="604" y2="245" />
            </g>

            <!-- Barras horizontais de escala na base -->
            <rect x="80" y="476" width="600" height="14" rx="7" fill="${strokePrimary}" fill-opacity="0.14" />
            <rect class="em-scale-fill" x="80" y="476" width="600" height="14" rx="7" fill="#E5A93C" />
            <rect class="em-scale-compare" x="80" y="498" width="22" height="8" rx="4" fill="#9E3B2E" />
          </svg>

          <div class="em-counter-readout">
            <div class="em-counter-unit">${M.escapeHtml(unitLabel)}</div>
            <div class="em-counter-digits">${M.escapeHtml(prefix + M.formatNumberPtBr(counterFrom) + suffix)}</div>
            ${compareValue ? `<div class="em-counter-compare-pill">${M.escapeHtml(compareValue)} · ${M.escapeHtml(compareLabel)}</div>` : `<div class="em-counter-compare-pill">${M.escapeHtml(compareLabel)}</div>`}
          </div>
        </div>

        <div class="em-bottom-copy">
          <h1 class="em-headline" style="font-size:${fitFont(baseHeadline, 66, 44, [18, 28, 42])}px;">${M.escapeHtml(baseHeadline)}</h1>
          <div class="em-accent-rule"><div class="em-accent-rule-fill"></div></div>
          ${footnote ? `<p class="em-footnote">${M.escapeHtml(footnote)}</p>` : ""}
        </div>
      </div>
    `;

    const kickerEl = root.querySelector(".em-kicker-pill");
    const ringOuter = root.querySelector(".em-ring-outer");
    const ringArc = root.querySelector(".em-ring-arc");
    const ringInner = root.querySelector(".em-ring-inner");
    const scaleFill = root.querySelector(".em-scale-fill");
    const scaleCompare = root.querySelector(".em-scale-compare");
    const digitsEl = root.querySelector(".em-counter-digits");
    const unitEl = root.querySelector(".em-counter-unit");
    const comparePill = root.querySelector(".em-counter-compare-pill");
    const headlineEl = root.querySelector(".em-headline");
    const ruleFill = root.querySelector(".em-accent-rule-fill");
    const footnoteEl = root.querySelector(".em-footnote");

    return {
      seek(t, pGlobal, beatState, tReal) {
        const tm = Number.isFinite(tReal) ? tReal : t;
        updateBeatDots(root, beatState);

        // Evolução de texto pelos beats
        const activeHead = (beatState.activeBeat && beatState.activeBeat.headline) || baseHeadline;
        const prevHead = (beatState.prevBeat && beatState.prevBeat.headline) || baseHeadline;
        const activeSub = (beatState.activeBeat && beatState.activeBeat.subtext) || baseSubtext;
        const prevSub = (beatState.prevBeat && beatState.prevBeat.subtext) || baseSubtext;
        applyBeatTextSwap(headlineEl, activeHead, prevHead, beatState, M);
        applyBeatTextSwap(kickerEl, activeSub, prevSub, beatState, M);

        // Contador animado determinístico (cresce forte na primeira metade e pulsa no beat 2)
        const countDur = Math.min(2600, durationMs * 0.58);
        const countP = M.power3Out(M.progress(tm, 160, countDur));
        const currVal = M.lerp(counterFrom, counterTo, countP);
        digitsEl.textContent = `${prefix}${M.formatNumberPtBr(currVal)}${suffix}`;

        const beat2Active = beatState.activeIndex >= 1 || pGlobal > 0.52;
        const beat2Pulse = beat2Active ? 1 + Math.sin(M.clamp(beatState.transitionP, 0, 1) * Math.PI) * 0.06 : 1;
        digitsEl.style.transform = `scale(${(M.lerp(0.86, 1.0, countP) * beat2Pulse).toFixed(4)})`;
        digitsEl.style.opacity = String(M.clamp(M.progress(tm, 80, 260), 0, 1));

        // Anéis SVG continuamente vivos
        ringArc.style.strokeDashoffset = String((1182 * (1 - M.clamp(countP * 0.94 + pGlobal * 0.06, 0, 1))).toFixed(1));
        ringOuter.setAttribute("transform", `rotate(${(pGlobal * 32).toFixed(2)} 380 245)`);
        ringInner.setAttribute("transform", `rotate(${(-pGlobal * 48).toFixed(2)} 380 245)`);

        // Barras de escala
        const barP = M.expoOut(M.progress(tm, 260, Math.min(2000, durationMs * 0.55)));
        scaleFill.setAttribute("width", String((600 * barP).toFixed(1)));
        const cmpStart = beats.length > 1 ? beats[1].startMs : durationMs * 0.45;
        const cmpP = M.backOut(M.progress(tm, cmpStart, 460), 1.35);
        scaleCompare.style.opacity = String(M.clamp(cmpP, 0, 1));
        comparePill.style.opacity = String(M.clamp(M.progress(tm, cmpStart - 80, 320), 0, 1));
        comparePill.style.transform = `translate3d(0, ${M.lerp(18, 0, M.clamp(cmpP, 0, 1)).toFixed(2)}px, 0)`;

        const unitP = M.power3Out(M.progress(tm, 100, 320));
        unitEl.style.opacity = String(unitP);

        const ruleP = M.expoOut(M.progress(tm, 320, 680));
        ruleFill.style.transform = `scaleX(${ruleP.toFixed(4)})`;
        ruleFill.style.background = accentColorForEmphasis(beatState.activeBeat && beatState.activeBeat.emphasis, isDark);

        if (footnoteEl) {
          const fp = M.power3Out(M.progress(tm, 520, 420));
          footnoteEl.style.opacity = String(fp);
        }
      },
    };
  }

  /* ==========================================================================
     2) COMPOSIÇÃO: debt_scale (Balança Editorial SVG Articulada & Desproporção)
     ========================================================================== */
  function mountDebtScale(ctx) {
    const { root, visual, theme, beats, motionData: md, durationMs, Math: M } = ctx;
    const isDark = theme === "carvao" || theme === "azul_marinho";

    const leftLabel = String(md.left_label || "10.000 TALENTOS");
    const leftSub = String(md.left_sub || "Dívida impagável");
    const rightLabel = String(md.right_label || "100 DENÁRIOS");
    const rightSub = String(md.right_sub || "Pequena quantia");
    const verdictLabel = String(md.verdict_label || visual.original_term || "");
    const tiltDir = String(md.tilt_direction || "left").toLowerCase() === "right" ? 1 : -1;
    const resolveBalanced = Boolean(md.resolve_to_balanced);
    const baseHeadline = String(visual.headline || "PESO DESPROPORCIONAL");
    const baseSubtext = String(visual.subtext || "Mateus 18:23–25");

    const inkColor = isDark ? "#F4EDE1" : "#181A1F";
    const navyColor = isDark ? "#7EA6D8" : "#1E3A5F";
    const cardBg = isDark ? "#232836" : "#FAF6EE";
    const isRightHeavy = tiltDir > 0;

    // Contraste alto em tema escuro (carvão/azul_marinho) e claro (pergaminho)
    const heavyAccent = isDark ? "#F59E8E" : "#9E3B2E";
    const lightAccent = isDark ? "#F2C96B" : "#1E3A5F";
    const heavyBorder = isDark ? "#E87A68" : "#9E3B2E";
    const lightBorder = "#E5A93C";

    const leftBorder = isRightHeavy ? lightBorder : heavyBorder;
    const rightBorder = isRightHeavy ? heavyBorder : lightBorder;
    const leftSubColor = isRightHeavy ? lightAccent : heavyAccent;
    const rightSubColor = isRightHeavy ? heavyAccent : lightAccent;
    const leftPinFill = isRightHeavy ? navyColor : "#9E3B2E";
    const rightPinFill = isRightHeavy ? "#9E3B2E" : navyColor;

    const heavyStackSvg = `
      <rect x="-52" y="96" width="104" height="28" rx="4" fill="#9E3B2E" stroke="#E5A93C" stroke-width="2" />
      <rect x="-42" y="66" width="84" height="26" rx="4" fill="#B54839" stroke="#E5A93C" stroke-width="2" />
      <rect x="-30" y="38" width="60" height="24" rx="4" fill="#E5A93C" stroke="#181A1F" stroke-width="2" />
    `;
    const lightWeightSvg = `
      <circle cx="0" cy="108" r="14" fill="#E5A93C" stroke="#181A1F" stroke-width="2" />
    `;

    root.innerHTML = `
      <div class="em-scene em-scale-scene">
        <div class="em-top-bar">
          <span class="em-kicker-pill">${M.escapeHtml(baseSubtext)}</span>
          ${buildBeatIndicatorHtml(beats, M)}
        </div>

        <div class="em-scale-stage">
          <svg class="em-scale-svg" viewBox="0 0 780 560" xmlns="http://www.w3.org/2000/svg" aria-label="Balança editorial de proporção">
            <!-- Grade de medida sutil -->
            <g stroke="${navyColor}" stroke-opacity="0.14" stroke-width="1.2" stroke-dasharray="5 6">
              <line x1="60" y1="140" x2="720" y2="140" />
              <line x1="60" y1="280" x2="720" y2="280" />
              <line x1="60" y1="420" x2="720" y2="420" />
              <line x1="390" y1="40" x2="390" y2="500" />
            </g>

            <!-- Arco de ângulo de desequilíbrio -->
            <path class="em-angle-arc" d="M 310,165 A 85,85 0 0,1 470,165" fill="none" stroke="#E5A93C" stroke-width="3" stroke-dasharray="220" stroke-dashoffset="220" />

            <!-- Coluna e Base Arquitetônica da Balança -->
            <path class="em-scale-pillar" d="M 390,115 L 390,468" fill="none" stroke="${inkColor}" stroke-width="10" stroke-linecap="round" stroke-dasharray="380" stroke-dashoffset="380" />
            <path class="em-scale-base" d="M 270,486 L 510,486 L 484,462 L 296,462 Z" fill="${navyColor}" stroke="#E5A93C" stroke-width="2.5" />
            <rect x="242" y="486" width="296" height="16" rx="4" fill="${inkColor}" />

            <!-- Travessão Pivotante (centro em 390, 156) -->
            <g class="em-scale-beam" transform="translate(390, 156) rotate(0)">
              <line x1="-220" y1="0" x2="220" y2="0" stroke="#E5A93C" stroke-width="9" stroke-linecap="round" />
              <circle cx="-220" cy="0" r="9" fill="${leftPinFill}" stroke="${cardBg}" stroke-width="3" />
              <circle cx="220" cy="0" r="9" fill="${rightPinFill}" stroke="${cardBg}" stroke-width="3" />
              <circle cx="0" cy="0" r="18" fill="${inkColor}" stroke="#E5A93C" stroke-width="5" />
              <circle cx="0" cy="0" r="6" fill="#E5A93C" />
            </g>

            <!-- Prato Esquerdo (posição calculada dinamicamente mantendo verticalidade!) -->
            <g class="em-pan-left" transform="translate(170, 156)">
              <line x1="0" y1="0" x2="-68" y2="128" stroke="${inkColor}" stroke-opacity="0.72" stroke-width="2.5" />
              <line x1="0" y1="0" x2="68" y2="128" stroke="${inkColor}" stroke-opacity="0.72" stroke-width="2.5" />
              <line x1="0" y1="0" x2="0" y2="128" stroke="${inkColor}" stroke-opacity="0.4" stroke-width="1.5" />
              <!-- Peso coerente com tilt_direction -->
              <g class="em-weight-stack-left">
                ${isRightHeavy ? lightWeightSvg : heavyStackSvg}
              </g>
              <path d="M -82,128 Q 0,162 82,128 Z" fill="${navyColor}" stroke="#E5A93C" stroke-width="3" />
              <!-- Placa de Rótulo Esquerdo -->
              <g transform="translate(0, 174)">
                <rect x="-132" y="0" width="264" height="66" rx="8" fill="${cardBg}" stroke="${leftBorder}" stroke-width="2.5" />
                <text x="0" y="28" text-anchor="middle" font-family="Georgia, serif" font-size="20" font-weight="800" fill="${isDark ? "#FAF6EE" : "#181A1F"}">${M.escapeHtml(leftLabel.slice(0, 22))}</text>
                <text x="0" y="50" text-anchor="middle" font-family="Consolas, monospace" font-size="14" font-weight="700" fill="${leftSubColor}">${M.escapeHtml(leftSub.slice(0, 28))}</text>
              </g>
            </g>

            <!-- Prato Direito -->
            <g class="em-pan-right" transform="translate(610, 156)">
              <line x1="0" y1="0" x2="-68" y2="128" stroke="${inkColor}" stroke-opacity="0.72" stroke-width="2.5" />
              <line x1="0" y1="0" x2="68" y2="128" stroke="${inkColor}" stroke-opacity="0.72" stroke-width="2.5" />
              <line x1="0" y1="0" x2="0" y2="128" stroke="${inkColor}" stroke-opacity="0.4" stroke-width="1.5" />
              <!-- Peso coerente com tilt_direction -->
              <g class="em-weight-stack-right">
                ${isRightHeavy ? heavyStackSvg : lightWeightSvg}
              </g>
              <path d="M -82,128 Q 0,162 82,128 Z" fill="${navyColor}" stroke="#E5A93C" stroke-width="3" />
              <!-- Placa de Rótulo Direito -->
              <g transform="translate(0, 174)">
                <rect x="-132" y="0" width="264" height="66" rx="8" fill="${cardBg}" stroke="${rightBorder}" stroke-width="2.5" />
                <text x="0" y="28" text-anchor="middle" font-family="Georgia, serif" font-size="20" font-weight="800" fill="${isDark ? "#FAF6EE" : "#181A1F"}">${M.escapeHtml(rightLabel.slice(0, 22))}</text>
                <text x="0" y="50" text-anchor="middle" font-family="Consolas, monospace" font-size="14" font-weight="700" fill="${rightSubColor}">${M.escapeHtml(rightSub.slice(0, 28))}</text>
              </g>
            </g>
          </svg>
          ${verdictLabel ? `<div class="em-scale-verdict">${M.escapeHtml(verdictLabel)}</div>` : ""}
        </div>

        <div class="em-bottom-copy">
          <h1 class="em-headline" style="font-size:${fitFont(baseHeadline, 62, 42, [18, 28, 42])}px;">${M.escapeHtml(baseHeadline)}</h1>
          <div class="em-accent-rule"><div class="em-accent-rule-fill"></div></div>
        </div>
      </div>
    `;

    const kickerEl = root.querySelector(".em-kicker-pill");
    const pillar = root.querySelector(".em-scale-pillar");
    const angleArc = root.querySelector(".em-angle-arc");
    const beam = root.querySelector(".em-scale-beam");
    const panLeft = root.querySelector(".em-pan-left");
    const panRight = root.querySelector(".em-pan-right");
    const weightLeft = root.querySelector(".em-weight-stack-left");
    const weightRight = root.querySelector(".em-weight-stack-right");
    const verdictEl = root.querySelector(".em-scale-verdict");
    const headlineEl = root.querySelector(".em-headline");
    const ruleFill = root.querySelector(".em-accent-rule-fill");

    return {
      seek(t, pGlobal, beatState, tReal) {
        const tm = Number.isFinite(tReal) ? tReal : t;
        updateBeatDots(root, beatState);

        const activeHead = (beatState.activeBeat && beatState.activeBeat.headline) || baseHeadline;
        const prevHead = (beatState.prevBeat && beatState.prevBeat.headline) || baseHeadline;
        const activeSub = (beatState.activeBeat && beatState.activeBeat.subtext) || baseSubtext;
        const prevSub = (beatState.prevBeat && beatState.prevBeat.subtext) || baseSubtext;
        applyBeatTextSwap(headlineEl, activeHead, prevHead, beatState, M);
        applyBeatTextSwap(kickerEl, activeSub, prevSub, beatState, M);

        // Desenho inicial da coluna e arco
        const drawP = M.expoOut(M.progress(tm, 80, 560));
        pillar.style.strokeDashoffset = String((380 * (1 - drawP)).toFixed(1));
        angleArc.style.strokeDashoffset = String((220 * (1 - M.expoOut(M.progress(tm, 380, 740)))).toFixed(1));

        // Física determinística da balança reagindo aos beats (100% coerente com o lado da pilha pesada)
        const firstAct = (beats[0] && beats[0].visual_action) || "";
        const act = (beatState.activeBeat && beatState.activeBeat.visual_action) || "";
        const startsBalanced = firstAct === "balance";
        const tiltIntro = M.power3Out(M.progress(tm, 280, 960));

        let targetDeg = startsBalanced ? 0 : tiltDir * 14.5 * tiltIntro;

        if (beatState.activeIndex >= 1) {
          const b1P = M.power3Out(M.progress(beatState.localT, 0, 620));
          if (act === "balance" || act === "cancel_debt" || resolveBalanced) {
            targetDeg = M.lerp(tiltDir * 16, 0, b1P);
          } else if (act === "flip_scale") {
            // Se começou equilibrado, tomba para o lado pesado (tiltDir); se já estava inclinado, acentua o peso
            targetDeg = startsBalanced
              ? M.lerp(0, tiltDir * 16.5, b1P)
              : M.lerp(tiltDir * 14.5, tiltDir * 18.5, b1P);
          } else {
            // hold_tilt / peso crescente no beat 2/3 sempre mantendo o lado pesado para baixo
            const startDeg = beatState.activeIndex >= 2 ? tiltDir * 16.5 : (startsBalanced ? 0 : tiltDir * 14.5);
            const endDeg = tiltDir * (beatState.activeIndex >= 2 ? 18.5 : 16.5);
            targetDeg = M.lerp(startDeg, endDeg, b1P);
          }
        }

        // Micro-oscilação física contínua (pêndulo vivo durante toda a cena de 6–8s)
        const sway = Math.sin(pGlobal * Math.PI * 3.5) * 1.4;
        const deg = targetDeg + sway;
        const rad = (deg * Math.PI) / 180;
        const halfLen = 220;
        const cx = 390;
        const cy = 156;

        const lx = cx - Math.cos(rad) * halfLen;
        const ly = cy - Math.sin(rad) * halfLen;
        const rx = cx + Math.cos(rad) * halfLen;
        const ry = cy + Math.sin(rad) * halfLen;

        beam.setAttribute("transform", `translate(${cx}, ${cy}) rotate(${deg.toFixed(2)})`);
        panLeft.setAttribute("transform", `translate(${lx.toFixed(1)}, ${ly.toFixed(1)})`);
        panRight.setAttribute("transform", `translate(${rx.toFixed(1)}, ${ry.toFixed(1)})`);

        // Pesos pousando com impacto nos pratos (se começa balanceado, a pilha pesada cai no Beat 2!)
        const heavyStart = startsBalanced && beats.length >= 2 ? beats[1].startMs : 240;
        const lightStart = startsBalanced ? 260 : 520;
        const wLeftStart = isRightHeavy ? lightStart : heavyStart;
        const wRightStart = isRightHeavy ? heavyStart : lightStart;
        const wLeftP = M.backOut(M.progress(tm, wLeftStart, 480), 1.3);
        const wRightP = M.backOut(M.progress(tm, wRightStart, 480), 1.3);
        weightLeft.style.opacity = String(M.clamp(M.progress(tm, wLeftStart, 180), 0, 1));
        weightLeft.setAttribute("transform", `translate(0, ${M.lerp(-28, 0, wLeftP).toFixed(1)})`);
        weightRight.style.opacity = String(M.clamp(M.progress(tm, wRightStart, 180), 0, 1));
        weightRight.setAttribute("transform", `translate(0, ${M.lerp(-28, 0, wRightP).toFixed(1)})`);

        if (verdictEl) {
          const vStart = beats.length >= 2 ? beats[beats.length - 1].startMs : durationMs * 0.62;
          const vP = M.backOut(M.progress(tm, vStart, 420), 1.4);
          verdictEl.style.opacity = String(M.clamp(M.progress(tm, vStart, 200), 0, 1));
          verdictEl.style.transform = `translate3d(0, ${M.lerp(20, 0, vP).toFixed(2)}px, 0) scale(${M.lerp(0.92, 1.0, vP).toFixed(3)})`;
        }

        ruleFill.style.transform = `scaleX(${M.expoOut(M.progress(tm, 260, 620)).toFixed(4)})`;
        ruleFill.style.background = accentColorForEmphasis(beatState.activeBeat && beatState.activeBeat.emphasis, isDark);
      },
    };
  }

  /* ==========================================================================
     3) COMPOSIÇÃO: forgiveness_seal (Decreto + Risco de Tinta Viva + Selo Orgânico)
     ========================================================================== */
  function mountForgivenessSeal(ctx) {
    const { root, visual, theme, beats, motionData: md, durationMs, Math: M } = ctx;
    const isDark = theme === "carvao" || theme === "azul_marinho";

    const docTitle = String(md.doc_title || "REGISTRO DA DÍVIDA").toUpperCase();
    const debtAmount = String(md.debt_amount || visual.original_term || "10.000 TALENTOS");
    const debtLines = Array.isArray(md.debt_lines) && md.debt_lines.length
      ? md.debt_lines.map((s) => String(s))
      : ["Dívida impagável diante do rei", "Sentença: venda de todos os bens"];
    const stampWord = String(md.stamp_word || "PERDOADA").toUpperCase();
    const releaseText = String(md.release_text || "Completamente cancelada. Ele saiu livre.");
    const baseHeadline = String(visual.headline || "TODA A DÍVIDA CANCELADA");
    const baseSubtext = String(visual.subtext || "Mateus 18:27");

    root.innerHTML = `
      <div class="em-scene em-forgive-scene">
        <div class="em-top-bar">
          <span class="em-kicker-pill">${M.escapeHtml(baseSubtext)}</span>
          ${buildBeatIndicatorHtml(beats, M)}
        </div>

        <div class="em-scroll-stage">
          <!-- Ondas de luz dourada de libertação (irradiam atrás do pergaminho) -->
          <svg class="em-grace-ripples" viewBox="0 0 780 620" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle class="em-ripple em-ripple-1" cx="390" cy="310" r="140" fill="none" stroke="#E5A93C" stroke-width="4" opacity="0" />
            <circle class="em-ripple em-ripple-2" cx="390" cy="310" r="140" fill="none" stroke="#E5A93C" stroke-width="2.5" opacity="0" />
            <circle class="em-ripple em-ripple-3" cx="390" cy="310" r="140" fill="none" stroke="#FAF6EE" stroke-width="1.8" opacity="0" />
          </svg>

          <!-- Folha de Pergaminho Tátil com Risco de Tinta Viva -->
          <div class="em-scroll-card-shadow">
            <div class="em-scroll-card">
              <div class="em-scroll-header">
                <span class="em-scroll-doc-tag">${M.escapeHtml(docTitle)}</span>
                <span class="em-scroll-ornament">✦</span>
              </div>

              <div class="em-scroll-amount-wrap">
                <div class="em-scroll-amount">${M.escapeHtml(debtAmount)}</div>
                <!-- Traço duplo orgânico de tinta viva riscando a dívida -->
                <svg class="em-strike-svg" viewBox="0 0 640 120" preserveAspectRatio="none" aria-hidden="true">
                  <path class="em-strike-1" d="M 18,92 C 165,68 380,44 622,22" fill="none" stroke="#9E3B2E" stroke-width="11" stroke-linecap="round" filter="url(#vox-ink-edge)" stroke-dasharray="660" stroke-dashoffset="660" />
                  <path class="em-strike-2" d="M 32,26 C 210,54 415,74 612,96" fill="none" stroke="#E5A93C" stroke-width="8" stroke-linecap="round" filter="url(#vox-ink-edge)" stroke-dasharray="660" stroke-dashoffset="660" />
                </svg>
              </div>

              <div class="em-scroll-lines">
                ${debtLines.slice(0, 3).map((ln, i) => `<div class="em-scroll-line" data-line="${i}">${M.escapeHtml(ln)}</div>`).join("")}
              </div>

              <!-- Selo Orgânico de Cera Dourada / Terracota (ZERO visual burocrático!) -->
              <div class="em-wax-seal-wrap">
                <svg class="em-wax-seal-svg" viewBox="0 0 220 220" xmlns="http://www.w3.org/2000/svg">
                  <path d="M110,10 C128,12 146,18 162,28 C178,38 190,54 198,72 C206,90 208,110 204,130 C200,150 188,168 172,182 C156,196 134,206 110,208 C86,210 62,200 44,186 C26,172 16,152 12,130 C8,108 12,84 22,64 C32,44 50,28 70,18 C84,12 96,9 110,10 Z"
                        fill="#E5A93C" stroke="#9E3B2E" stroke-width="5" filter="url(#vox-stamp-grunge)" />
                  <circle cx="110" cy="110" r="76" fill="none" stroke="#181A1F" stroke-width="2.5" stroke-dasharray="5 4" opacity="0.6" />
                  <text x="110" y="102" text-anchor="middle" font-family="Georgia, serif" font-size="23" font-weight="900" fill="#181A1F" letter-spacing="1.5">${M.escapeHtml(stampWord.slice(0, 12))}</text>
                  <text x="110" y="130" text-anchor="middle" font-family="Consolas, monospace" font-size="13" font-weight="800" fill="#9E3B2E" letter-spacing="2">GRAÇA TOTAL</text>
                </svg>
              </div>
            </div>
          </div>

          <div class="em-release-banner">${M.escapeHtml(releaseText)}</div>
        </div>

        <div class="em-bottom-copy">
          <h1 class="em-headline" style="font-size:${fitFont(baseHeadline, 60, 42, [18, 28, 42])}px;">${M.escapeHtml(baseHeadline)}</h1>
          <div class="em-accent-rule"><div class="em-accent-rule-fill"></div></div>
        </div>
      </div>
    `;

    const kickerEl = root.querySelector(".em-kicker-pill");
    const scrollShadow = root.querySelector(".em-scroll-card-shadow");
    const strike1 = root.querySelector(".em-strike-1");
    const strike2 = root.querySelector(".em-strike-2");
    const lineEls = Array.from(root.querySelectorAll(".em-scroll-line"));
    const sealWrap = root.querySelector(".em-wax-seal-wrap");
    const releaseBanner = root.querySelector(".em-release-banner");
    const ripples = Array.from(root.querySelectorAll(".em-ripple"));
    const headlineEl = root.querySelector(".em-headline");
    const ruleFill = root.querySelector(".em-accent-rule-fill");

    const cancelStartMs = beats.length >= 2 ? beats[1].startMs : Math.round(durationMs * 0.36);
    const releaseStartMs = beats.length >= 3 ? beats[2].startMs : Math.round(durationMs * 0.66);

    return {
      seek(t, pGlobal, beatState, tReal) {
        const tm = Number.isFinite(tReal) ? tReal : t;
        updateBeatDots(root, beatState);

        const activeHead = (beatState.activeBeat && beatState.activeBeat.headline) || baseHeadline;
        const prevHead = (beatState.prevBeat && beatState.prevBeat.headline) || baseHeadline;
        const activeSub = (beatState.activeBeat && beatState.activeBeat.subtext) || baseSubtext;
        const prevSub = (beatState.prevBeat && beatState.prevBeat.subtext) || baseSubtext;
        applyBeatTextSwap(headlineEl, activeHead, prevHead, beatState, M);
        applyBeatTextSwap(kickerEl, activeSub, prevSub, beatState, M);

        // Pergaminho entra com peso tátil e flutua suavemente
        const introP = M.backOut(M.progress(tm, 60, 520), 1.25);
        const floatY = Math.sin(pGlobal * Math.PI * 2.2) * 5;
        const floatRot = -1.2 + Math.cos(pGlobal * Math.PI * 1.8) * 0.5;
        scrollShadow.style.opacity = String(M.clamp(M.progress(tm, 40, 220), 0, 1));
        scrollShadow.style.transform =
          `translate3d(0, ${(M.lerp(64, 0, introP) + floatY).toFixed(2)}px, 0) scale(${M.lerp(0.92, 1.0, introP).toFixed(4)}) rotate(${floatRot.toFixed(2)}deg)`;

        // Linhas da dívida surgem sequencialmente e perdem opacidade após cancelamento
        const fadeAfterCancel = M.lerp(1.0, 0.38, M.progress(tm, cancelStartMs + 220, 480));
        lineEls.forEach((el, idx) => {
          const lp = M.power3Out(M.progress(tm, 260 + idx * 180, 320));
          el.style.opacity = String((lp * fadeAfterCancel).toFixed(3));
          el.style.transform = `translate3d(${M.lerp(-20, 0, lp).toFixed(1)}px, 0, 0)`;
        });

        // Traço duplo de tinta viva riscando a dívida no Beat 2
        const s1P = M.expoOut(M.progress(tm, cancelStartMs, 420));
        const s2P = M.expoOut(M.progress(tm, cancelStartMs + 180, 420));
        strike1.style.strokeDashoffset = String((660 * (1 - s1P)).toFixed(1));
        strike2.style.strokeDashoffset = String((660 * (1 - s2P)).toFixed(1));

        // Selo orgânico de cera pousa logo após o risco
        const sealStart = cancelStartMs + 260;
        const sealP = M.backOut(M.progress(tm, sealStart, 360), 1.55);
        sealWrap.style.opacity = String(M.clamp(M.progress(tm, sealStart, 140), 0, 1));
        sealWrap.style.transform =
          `scale(${M.lerp(1.65, 1.0, sealP).toFixed(4)}) rotate(${M.lerp(-22, -8, sealP).toFixed(2)}deg)`;

        // Ondas concêntricas de graça contínuas após o selo
        ripples.forEach((rip, idx) => {
          const age = tm - (sealStart + idx * 240);
          if (age <= 0) {
            rip.setAttribute("opacity", "0");
            return;
          }
          const cyc = ((age % 1800) + 1800) % 1800 / 1800;
          rip.setAttribute("r", String(M.lerp(135, 360, cyc).toFixed(1)));
          rip.setAttribute("opacity", String(((1 - cyc) * 0.55).toFixed(3)));
        });

        // Faixa de libertação no Beat 3
        const relP = M.power3Out(M.progress(tm, releaseStartMs, 420));
        releaseBanner.style.opacity = String(relP);
        releaseBanner.style.transform = `translate3d(0, ${M.lerp(22, 0, relP).toFixed(2)}px, 0)`;

        ruleFill.style.transform = `scaleX(${M.expoOut(M.progress(tm, 260, 620)).toFixed(4)})`;
        ruleFill.style.background = accentColorForEmphasis(beatState.activeBeat && beatState.activeBeat.emphasis, isDark);
      },
    };
  }

  /* ==========================================================================
     4) COMPOSIÇÃO: dramatic_split (Split-Screen Vertical Cinematográfico)
     ========================================================================== */
  function mountDramaticSplit(ctx) {
    const { root, visual, theme, beats, motionData: md, durationMs, Math: M } = ctx;
    const isDark = theme === "carvao" || theme === "azul_marinho";

    const topTag = String(md.top_tag || "RECEBEU").toUpperCase();
    const topTitle = String(md.top_title || "PERDÃO IMENSURÁVEL");
    const topSub = String(md.top_sub || "Uma dívida impagável cancelada");
    const topTone = String(md.top_tone || "gold").toLowerCase();

    const bottomTag = String(md.bottom_tag || "COBROU").toUpperCase();
    const bottomTitle = String(md.bottom_title || "PEQUENA QUANTIA");
    const bottomSub = String(md.bottom_sub || "A lógica dura da cobrança");
    const bottomTone = String(md.bottom_tone || "terracotta").toLowerCase();

    const symbol = String(md.divider_symbol || "VS");
    const baseHeadline = String(visual.headline || "O CONTRASTE");
    const baseSubtext = String(visual.subtext || "Mateus 18:28–30");

    root.innerHTML = `
      <div class="em-scene em-split-scene">
        <div class="em-top-bar">
          <span class="em-kicker-pill">${M.escapeHtml(baseSubtext)}</span>
          ${buildBeatIndicatorHtml(beats, M)}
        </div>

        <div class="em-split-stack">
          <!-- Painel Superior -->
          <div class="em-split-panel em-split-top tone-${M.escapeHtml(topTone)}">
            <div class="em-split-panel-tag">${M.escapeHtml(topTag)}</div>
            <div class="em-split-panel-title" style="font-size:${fitFont(topTitle, 54, 36, [16, 26, 38])}px;">${M.escapeHtml(topTitle)}</div>
            <div class="em-split-panel-sub">${M.escapeHtml(topSub)}</div>
          </div>

          <!-- Divisória Diagonal SVG Animada + Emblema Central -->
          <div class="em-split-divider-wrap">
            <svg class="em-split-divider-svg" viewBox="0 0 832 88" preserveAspectRatio="none" aria-hidden="true">
              <path class="em-split-line" d="M 10,66 L 822,22" fill="none" stroke="#E5A93C" stroke-width="6" stroke-linecap="round" stroke-dasharray="840" stroke-dashoffset="840" />
            </svg>
            <div class="em-split-badge">${M.escapeHtml(symbol)}</div>
          </div>

          <!-- Painel Inferior -->
          <div class="em-split-panel em-split-bottom tone-${M.escapeHtml(bottomTone)}">
            <div class="em-split-panel-tag">${M.escapeHtml(bottomTag)}</div>
            <div class="em-split-panel-title" style="font-size:${fitFont(bottomTitle, 54, 36, [16, 26, 38])}px;">${M.escapeHtml(bottomTitle)}</div>
            <div class="em-split-panel-sub">${M.escapeHtml(bottomSub)}</div>
          </div>
        </div>

        <div class="em-bottom-copy">
          <h1 class="em-headline" style="font-size:${fitFont(baseHeadline, 54, 38, [18, 30, 44])}px;">${M.escapeHtml(baseHeadline)}</h1>
          <div class="em-accent-rule"><div class="em-accent-rule-fill"></div></div>
        </div>
      </div>
    `;

    const kickerEl = root.querySelector(".em-kicker-pill");
    const topPanel = root.querySelector(".em-split-top");
    const botPanel = root.querySelector(".em-split-bottom");
    const divLine = root.querySelector(".em-split-line");
    const badgeEl = root.querySelector(".em-split-badge");
    const headlineEl = root.querySelector(".em-headline");
    const ruleFill = root.querySelector(".em-accent-rule-fill");

    const botRevealStart = beats.length >= 2 ? beats[1].startMs : Math.round(durationMs * 0.36);

    return {
      seek(t, pGlobal, beatState, tReal) {
        const tm = Number.isFinite(tReal) ? tReal : t;
        updateBeatDots(root, beatState);

        const activeHead = (beatState.activeBeat && beatState.activeBeat.headline) || baseHeadline;
        const prevHead = (beatState.prevBeat && beatState.prevBeat.headline) || baseHeadline;
        const activeSub = (beatState.activeBeat && beatState.activeBeat.subtext) || baseSubtext;
        const prevSub = (beatState.prevBeat && beatState.prevBeat.subtext) || baseSubtext;
        applyBeatTextSwap(headlineEl, activeHead, prevHead, beatState, M);
        applyBeatTextSwap(kickerEl, activeSub, prevSub, beatState, M);

        // Entrada painel superior (Beat 1)
        const topIntro = M.expoOut(M.progress(tm, 80, 480));
        // Entrada painel inferior (Beat 2)
        const botIntro = M.expoOut(M.progress(tm, botRevealStart, 520));

        // Foco dinâmico por beats: destaca o painel em evidência sem violar safe-zone
        const focusBot = tm >= botRevealStart && beatState.activeIndex === 1;
        const focusBoth = beatState.activeIndex >= 2;
        const topScale = focusBoth ? 0.995 : focusBot ? 0.96 : 1.0;
        const botScale = focusBoth ? 1.0 : focusBot ? 1.0 : 0.96;
        const topOp = focusBot ? 0.72 : 1.0;

        topPanel.style.opacity = String((M.clamp(topIntro * 1.4, 0, 1) * topOp).toFixed(3));
        topPanel.style.transform =
          `translate3d(${M.lerp(-54, 0, topIntro).toFixed(1)}px, 0, 0) scale(${topScale.toFixed(4)})`;

        botPanel.style.opacity = String(M.clamp(botIntro * 1.4, 0, 1).toFixed(3));
        botPanel.style.transform =
          `translate3d(${M.lerp(54, 0, botIntro).toFixed(1)}px, 0, 0) scale(${botScale.toFixed(4)})`;

        // Linha divisória SVG e emblema central
        const lineP = M.expoOut(M.progress(tm, Math.max(240, botRevealStart - 160), 540));
        divLine.style.strokeDashoffset = String((840 * (1 - lineP)).toFixed(1));

        const badgeP = M.backOut(M.progress(tm, Math.max(300, botRevealStart - 60), 420), 1.5);
        const badgeRot = Math.sin(pGlobal * Math.PI * 2) * 4;
        badgeEl.style.opacity = String(M.clamp(badgeP, 0, 1));
        badgeEl.style.transform = `scale(${M.lerp(0.5, 1.0, badgeP).toFixed(3)}) rotate(${badgeRot.toFixed(1)}deg)`;

        ruleFill.style.transform = `scaleX(${M.expoOut(M.progress(tm, 260, 620)).toFixed(4)})`;
        ruleFill.style.background = accentColorForEmphasis(beatState.activeBeat && beatState.activeBeat.emphasis, isDark);
      },
    };
  }

  /* ==========================================================================
     5) COMPOSIÇÃO: rhetorical_question (Pergunta Retórica Monumental)
     ========================================================================== */
  function mountRhetoricalQuestion(ctx) {
    const { root, visual, theme, words, beats, motionData: md, durationMs, Math: M } = ctx;
    const isDark = theme === "carvao" || theme === "azul_marinho";

    const kicker = String(md.kicker || visual.subtext || "PERGUNTA CENTRAL").toUpperCase();
    const symbol = String(md.symbol || "?");
    const closingNote = String(md.closing_note || visual.original_term || "");
    const questionText = String(
      md.question_text ||
        visual.headline ||
        (words.length ? words.map((w) => w.text).join(" ") : "Você consegue perdoar?")
    );
    const emphasisWords = Array.isArray(md.emphasis_words) ? md.emphasis_words : [];

    const hlIdSet = new Set(visual.highlight_word_ids || []);
    const hlWordsNorm = new Set();
    words.forEach((w) => {
      if (hlIdSet.has(w.word_id)) hlWordsNorm.add(M.normalizeToken(w.text));
    });

    const fontSize = fitFont(questionText, 76, 48, [26, 44, 66]);

    root.innerHTML = `
      <div class="em-scene em-rhetorical-scene">
        <!-- Interrogação / Símbolo Monumental em SVG com parallax -->
        <svg class="em-rhetorical-bg-svg" viewBox="0 0 832 960" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <text class="em-giant-symbol" x="620" y="540" text-anchor="middle" font-family="Georgia, serif" font-size="680" font-weight="900"
                fill="none" stroke="#E5A93C" stroke-opacity="${isDark ? "0.24" : "0.28"}" stroke-width="4" stroke-dasharray="1600" stroke-dashoffset="1600">${M.escapeHtml(symbol)}</text>
          <path class="em-rhetorical-arc" d="M 42,740 Q 416,805 790,728" fill="none" stroke="#E5A93C" stroke-width="5" stroke-linecap="round" stroke-dasharray="780" stroke-dashoffset="780" />
        </svg>

        <div class="em-top-bar">
          <span class="em-kicker-pill">${M.escapeHtml(kicker)}</span>
          ${buildBeatIndicatorHtml(beats, M)}
        </div>

        <div class="em-rhetorical-center">
          <div class="em-rhetorical-line-accent"></div>
          <h1 class="em-rhetorical-quote" style="font-size:${fontSize}px;">
            ${highlightWordsHtml(questionText, emphasisWords, hlWordsNorm, M)}
          </h1>
          <div class="em-rhetorical-beat-sub" ${!closingNote ? 'style="display:none;"' : ""}>${M.escapeHtml(closingNote)}</div>
        </div>
      </div>
    `;

    const kickerEl = root.querySelector(".em-kicker-pill");
    const giantSym = root.querySelector(".em-giant-symbol");
    const arcPath = root.querySelector(".em-rhetorical-arc");
    const lineAccent = root.querySelector(".em-rhetorical-line-accent");
    const wordEls = Array.from(root.querySelectorAll(".em-kword"));
    const beatSubEl = root.querySelector(".em-rhetorical-beat-sub");

    // Calcula janelas de revelação determinísticas das palavras da pergunta
    const stepMs = Math.max(95, Math.min(240, (durationMs * 0.62) / Math.max(1, wordEls.length)));

    return {
      seek(t, pGlobal, beatState, tReal) {
        const tm = Number.isFinite(tReal) ? tReal : t;
        updateBeatDots(root, beatState);

        const activeSub = (beatState.activeBeat && beatState.activeBeat.subtext) || kicker;
        const prevSub = (beatState.prevBeat && beatState.prevBeat.subtext) || kicker;
        applyBeatTextSwap(kickerEl, activeSub, prevSub, beatState, M);

        // Símbolo monumental desenhando continuamente + micro-parallax
        const symP = M.power2Out(M.progress(tm, 60, Math.min(2600, durationMs * 0.72)));
        giantSym.style.strokeDashoffset = String((1600 * (1 - symP)).toFixed(1));
        const px = M.lerp(24, -22, pGlobal);
        const py = Math.sin(pGlobal * Math.PI * 1.4) * 18;
        giantSym.setAttribute("transform", `translate(${px.toFixed(1)}, ${py.toFixed(1)})`);

        // Filete vertical dourado
        const lineP = M.expoOut(M.progress(tm, 80, 520));
        lineAccent.style.transform = `scaleY(${lineP.toFixed(4)})`;

        // Palavras reveladas com ritmo orgânico + marca-texto dourado
        wordEls.forEach((wEl, idx) => {
          const start = 180 + idx * stepMs;
          const p = M.power3Out(M.progress(tm, start, 280));
          wEl.style.opacity = String(M.lerp(0.14, 1.0, p).toFixed(3));
          wEl.style.transform = `translate3d(0, ${M.lerp(22, 0, p).toFixed(2)}px, 0)`;

          const bar = wEl.querySelector(".em-kword-bar");
          if (bar) {
            const hlP = M.expoOut(M.progress(tm, start + 120, 380));
            bar.style.transform = `scaleX(${hlP.toFixed(4)}) rotate(-0.8deg)`;
            wEl.classList.toggle("is-hl-on", hlP > 0.35);
          }
        });

        // Arco curvo desenhando no clímax
        const arcStart = beats.length >= 2 ? beats[1].startMs : Math.round(durationMs * 0.45);
        const arcP = M.expoOut(M.progress(tm, arcStart, 820));
        arcPath.style.strokeDashoffset = String((780 * (1 - arcP)).toFixed(1));

        // Subtítulo / resposta do beat final
        const beatHeadline = beatState.activeBeat && beatState.activeIndex >= 1 && beatState.activeBeat.headline;
        const noteText = beatHeadline || closingNote;
        if (noteText) {
          beatSubEl.style.display = "block";
          if (beatSubEl.dataset.lastText !== noteText) {
            beatSubEl.textContent = noteText;
            beatSubEl.dataset.lastText = noteText;
          }
          const subStart = beats.length >= 2 ? beats[1].startMs : Math.round(durationMs * 0.5);
          const sp = M.power3Out(M.progress(tm, subStart, 420));
          beatSubEl.style.opacity = String(sp);
          beatSubEl.style.transform = `translate3d(0, ${M.lerp(18, 0, sp).toFixed(2)}px, 0)`;
        }
      },
    };
  }

  /* ==========================================================================
     6) COMPOSIÇÃO: scripture_spotlight (Citação Bíblica Limpa — Anti-Burocracia)
     ========================================================================== */
  function mountScriptureSpotlight(ctx) {
    const { root, visual, preset, theme, words, beats, scriptureRef, motionData: md, durationMs, Math: M } = ctx;
    const isDark = theme === "carvao" || theme === "azul_marinho";

    const defaultTr = (preset && preset.default_bible_translation) || "NVI";
    const refCitation =
      md.reference ||
      (scriptureRef && scriptureRef.citation) ||
      visual.subtext ||
      "Escrituras";
    const refTr = md.translation || (scriptureRef && scriptureRef.translation) || defaultTr;
    const fullRef = refCitation.includes("·") ? refCitation : `${refCitation} · ${refTr}`;

    const quoteText = String(
      md.quote_text ||
        (scriptureRef && scriptureRef.exact_text) ||
        (words.length ? words.map((w) => w.text).join(" ") : visual.headline || "")
    ).trim();

    const contextNote = String(md.context_note || visual.headline || "");
    const emphasisWords = Array.isArray(md.emphasis_words) ? md.emphasis_words : [];

    const hlIdSet = new Set(visual.highlight_word_ids || []);
    const hlWordsNorm = new Set();
    words.forEach((w) => {
      if (hlIdSet.has(w.word_id)) hlWordsNorm.add(M.normalizeToken(w.text));
    });

    const fontSize = fitFont(quoteText, 56, 38, [68, 105, 145]);

    root.innerHTML = `
      <div class="em-scene em-scripture-scene">
        <div class="em-top-bar">
          <span class="em-scripture-ref-tag">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5V5.5Z" stroke="#E5A93C" stroke-width="2.2" stroke-linejoin="round"/>
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" stroke="#E5A93C" stroke-width="2.2"/>
            </svg>
            <span>${M.escapeHtml(fullRef)}</span>
          </span>
          ${buildBeatIndicatorHtml(beats, M)}
        </div>

        <div class="em-scripture-stage">
          <!-- Aspas caligráficas discretas em marca d'água -->
          <div class="em-scripture-open-q" aria-hidden="true">“</div>

          <!-- Filete vertical dourado desenhado ao vivo via SVG -->
          <svg class="em-scripture-rail-svg" viewBox="0 0 20 680" preserveAspectRatio="none" aria-hidden="true">
            <line class="em-scripture-rail-line" x1="10" y1="0" x2="10" y2="680" stroke="#E5A93C" stroke-width="6" stroke-linecap="round" stroke-dasharray="680" stroke-dashoffset="680" />
          </svg>

          <blockquote class="em-scripture-body" style="font-size:${fontSize}px;">
            ${highlightWordsHtml(quoteText, emphasisWords, hlWordsNorm, M)}
          </blockquote>
        </div>

        <div class="em-scripture-footer">
          <svg class="em-pen-flourish" viewBox="0 0 420 26" aria-hidden="true">
            <path class="em-flourish-path" d="M 4,14 Q 140,4 280,15 T 416,12" fill="none" stroke="${isDark ? "#E5A93C" : "#1E3A5F"}" stroke-width="3" stroke-linecap="round" stroke-dasharray="440" stroke-dashoffset="440" />
          </svg>
          ${contextNote ? `<div class="em-scripture-context">${M.escapeHtml(contextNote)}</div>` : ""}
        </div>
      </div>
    `;

    const railLine = root.querySelector(".em-scripture-rail-line");
    const openQ = root.querySelector(".em-scripture-open-q");
    const wordEls = Array.from(root.querySelectorAll(".em-kword"));
    const flourishPath = root.querySelector(".em-flourish-path");
    const contextEl = root.querySelector(".em-scripture-context");

    const stepMs = Math.max(55, Math.min(160, (durationMs * 0.56) / Math.max(1, wordEls.length)));

    return {
      seek(t, pGlobal, beatState, tReal) {
        const tm = Number.isFinite(tReal) ? tReal : t;
        updateBeatDots(root, beatState);

        // Filete vertical desenha acompanhando a leitura
        const railP = M.power2Out(M.progress(tm, 80, Math.min(2200, durationMs * 0.65)));
        railLine.style.strokeDashoffset = String((680 * (1 - railP)).toFixed(1));

        // Aspas com micro-parallax contínuo
        openQ.style.opacity = String(M.power3Out(M.progress(tm, 40, 480)));
        openQ.style.transform = `translate3d(${M.lerp(-14, 16, pGlobal).toFixed(1)}px, ${M.lerp(-10, 12, pGlobal).toFixed(1)}px, 0)`;

        // Revelação editorial das palavras do versículo
        wordEls.forEach((wEl, idx) => {
          const start = 160 + idx * stepMs;
          const p = M.power3Out(M.progress(tm, start, 240));
          wEl.style.opacity = String(M.lerp(0.18, 1.0, p).toFixed(3));
          wEl.style.transform = `translate3d(0, ${M.lerp(12, 0, p).toFixed(2)}px, 0)`;

          const bar = wEl.querySelector(".em-kword-bar");
          if (bar) {
            const hlP = M.expoOut(M.progress(tm, start + 140, 380));
            bar.style.transform = `scaleX(${hlP.toFixed(4)}) rotate(-0.6deg)`;
            wEl.classList.toggle("is-hl-on", hlP > 0.35);
          }
        });

        // Traço de pena e nota contextual (evolui no beat 2 se houver)
        const flStart = beats.length >= 2 ? beats[1].startMs : Math.round(durationMs * 0.45);
        const flP = M.expoOut(M.progress(tm, flStart, 720));
        flourishPath.style.strokeDashoffset = String((440 * (1 - flP)).toFixed(1));

        if (contextEl) {
          const activeCtx = (beatState.activeBeat && beatState.activeBeat.headline) || contextNote;
          const prevCtx = (beatState.prevBeat && beatState.prevBeat.headline) || contextNote;
          applyBeatTextSwap(contextEl, activeCtx, prevCtx, beatState, M);
          contextEl.style.opacity = String(M.power3Out(M.progress(tm, 380, 380)));
        }
      },
    };
  }

  /* ==========================================================================
     7) COMPOSIÇÃO: grace_illumination (Correntes Partidas & Raios de Graça)
     ========================================================================== */
  function mountGraceIllumination(ctx) {
    const { root, visual, theme, beats, motionData: md, durationMs, Math: M } = ctx;
    const isDark = theme === "carvao" || theme === "azul_marinho";

    const beforeLabel = String(md.before_label || "CULPA & COBRANÇA").toUpperCase();
    const afterLabel = String(md.after_label || "A GRANDEZA DA GRAÇA").toUpperCase();
    const closingPhrase = String(md.closing_phrase || visual.original_term || "");
    const baseHeadline = String(visual.headline || "TRANSFORMADOS PELA GRAÇA");
    const baseSubtext = String(visual.subtext || "Mateus 18:33");

    const chainStroke = isDark ? "#F4EDE1" : "#1E3A5F";

    // 12 raios geométricos radiais de gravura editorial
    const raysHtml = Array.from({ length: 12 })
      .map((_, i) => {
        const angle = (i * 30 * Math.PI) / 180;
        const r1 = 68;
        const r2 = i % 2 === 0 ? 236 : 182;
        const x1 = (380 + Math.cos(angle) * r1).toFixed(1);
        const y1 = (255 + Math.sin(angle) * r1).toFixed(1);
        const x2 = (380 + Math.cos(angle) * r2).toFixed(1);
        const y2 = (255 + Math.sin(angle) * r2).toFixed(1);
        return `<line class="em-grace-ray" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#E5A93C" stroke-width="${i % 2 === 0 ? 4.5 : 2.5}" stroke-linecap="round" stroke-dasharray="190" stroke-dashoffset="190" />`;
      })
      .join("");

    root.innerHTML = `
      <div class="em-scene em-grace-scene">
        <div class="em-top-bar">
          <span class="em-kicker-pill">${M.escapeHtml(baseSubtext)}</span>
          ${buildBeatIndicatorHtml(beats, M)}
        </div>

        <div class="em-grace-stage">
          <svg class="em-grace-svg" viewBox="0 0 760 510" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs>
              <radialGradient id="emGraceHalo" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stop-color="#E5A93C" stop-opacity="0.72" />
                <stop offset="52%" stop-color="#E5A93C" stop-opacity="0.22" />
                <stop offset="100%" stop-color="#E5A93C" stop-opacity="0" />
              </radialGradient>
            </defs>

            <!-- Halo luminoso central que cresce na virada da graça -->
            <circle class="em-grace-halo" cx="380" cy="255" r="245" fill="url(#emGraceHalo)" opacity="0.18" />

            <!-- Raios geométricos desenhados ao vivo -->
            <g class="em-grace-rays-group">${raysHtml}</g>

            <!-- Anéis orbitais editoriais -->
            <circle class="em-grace-ring-1" cx="380" cy="255" r="118" fill="none" stroke="#E5A93C" stroke-width="2.5" stroke-dasharray="742" stroke-dashoffset="742" />
            <circle class="em-grace-ring-2" cx="380" cy="255" r="168" fill="none" stroke="${chainStroke}" stroke-opacity="0.28" stroke-width="1.8" stroke-dasharray="6 8" />

            <!-- Corrente Esquerda (se separa no clímax) -->
            <g class="em-chain-left" fill="none" stroke="${chainStroke}" stroke-width="11" stroke-linecap="round">
              <rect x="112" y="229" width="94" height="52" rx="26" />
              <rect x="184" y="235" width="92" height="40" rx="20" stroke="#9E3B2E" />
              <path d="M 276,236 L 346,236 C 362,236 372,244 372,255 C 372,266 362,274 346,274 L 276,274" />
            </g>

            <!-- Corrente Direita (se separa no clímax) -->
            <g class="em-chain-right" fill="none" stroke="${chainStroke}" stroke-width="11" stroke-linecap="round">
              <path d="M 484,236 L 414,236 C 398,236 388,244 388,255 C 388,266 398,274 414,274 L 484,274" />
              <rect x="484" y="235" width="92" height="40" rx="20" stroke="#9E3B2E" />
              <rect x="554" y="229" width="94" height="52" rx="26" />
            </g>

            <!-- Centelha / Estrela Central de Graça -->
            <g class="em-grace-star" transform="translate(380, 255) scale(0.2)" filter="url(#vox-gold-glow)">
              <polygon points="0,-54 14,-14 54,0 14,14 0,54 -14,14 -54,0 -14,-14" fill="#E5A93C" />
              <circle cx="0" cy="0" r="14" fill="#FAF6EE" />
            </g>
          </svg>

          <div class="em-grace-state-row">
            <span class="em-grace-before">${M.escapeHtml(beforeLabel)}</span>
            <span class="em-grace-arrow">→</span>
            <span class="em-grace-after">${M.escapeHtml(afterLabel)}</span>
          </div>
        </div>

        <div class="em-bottom-copy">
          <h1 class="em-headline" style="font-size:${fitFont(baseHeadline, 60, 42, [18, 28, 42])}px;">${M.escapeHtml(baseHeadline)}</h1>
          <div class="em-accent-rule"><div class="em-accent-rule-fill"></div></div>
          ${closingPhrase ? `<p class="em-footnote">${M.escapeHtml(closingPhrase)}</p>` : ""}
        </div>
      </div>
    `;

    const kickerEl = root.querySelector(".em-kicker-pill");
    const halo = root.querySelector(".em-grace-halo");
    const raysGroup = root.querySelector(".em-grace-rays-group");
    const rayLines = Array.from(root.querySelectorAll(".em-grace-ray"));
    const ring1 = root.querySelector(".em-grace-ring-1");
    const ring2 = root.querySelector(".em-grace-ring-2");
    const chainLeft = root.querySelector(".em-chain-left");
    const chainRight = root.querySelector(".em-chain-right");
    const star = root.querySelector(".em-grace-star");
    const beforeEl = root.querySelector(".em-grace-before");
    const afterEl = root.querySelector(".em-grace-after");
    const headlineEl = root.querySelector(".em-headline");
    const ruleFill = root.querySelector(".em-accent-rule-fill");
    const footEl = root.querySelector(".em-footnote");

    const breakStartMs = beats.length >= 2 ? beats[1].startMs : Math.round(durationMs * 0.4);

    return {
      seek(t, pGlobal, beatState, tReal) {
        const tm = Number.isFinite(tReal) ? tReal : t;
        updateBeatDots(root, beatState);

        const activeHead = (beatState.activeBeat && beatState.activeBeat.headline) || baseHeadline;
        const prevHead = (beatState.prevBeat && beatState.prevBeat.headline) || baseHeadline;
        const activeSub = (beatState.activeBeat && beatState.activeBeat.subtext) || baseSubtext;
        const prevSub = (beatState.prevBeat && beatState.prevBeat.subtext) || baseSubtext;
        applyBeatTextSwap(headlineEl, activeHead, prevHead, beatState, M);
        applyBeatTextSwap(kickerEl, activeSub, prevSub, beatState, M);

        // Separação das correntes na virada da graça
        const brkP = M.expoOut(M.progress(tm, breakStartMs, 760));
        const shiftX = M.lerp(0, 74, brkP);
        const tilt = M.lerp(0, 12, brkP);
        const chainOp = M.lerp(1.0, 0.34, brkP);
        chainLeft.setAttribute("transform", `translate(${(-shiftX).toFixed(1)}, 0) rotate(${(-tilt).toFixed(1)} 220 255)`);
        chainRight.setAttribute("transform", `translate(${shiftX.toFixed(1)}, 0) rotate(${tilt.toFixed(1)} 540 255)`);
        chainLeft.style.opacity = String(chainOp.toFixed(3));
        chainRight.style.opacity = String(chainOp.toFixed(3));

        // Explosão suave de luz e raios dourados
        const haloOp = M.lerp(0.16, 0.92, brkP) + Math.sin(pGlobal * Math.PI * 3) * 0.06;
        halo.setAttribute("opacity", String(M.clamp(haloOp, 0.1, 1.0).toFixed(3)));

        rayLines.forEach((ln, idx) => {
          const rp = M.expoOut(M.progress(tm, breakStartMs + idx * 28, 620));
          ln.style.strokeDashoffset = String((190 * (1 - rp)).toFixed(1));
        });
        raysGroup.setAttribute("transform", `rotate(${(pGlobal * 24).toFixed(2)} 380 255)`);

        ring1.style.strokeDashoffset = String((742 * (1 - M.expoOut(M.progress(tm, breakStartMs, 860)))).toFixed(1));
        ring2.setAttribute("transform", `rotate(${(-pGlobal * 30).toFixed(2)} 380 255)`);

        const starP = M.backOut(M.progress(tm, breakStartMs + 80, 520), 1.45);
        const starBreath = 1 + Math.sin(pGlobal * Math.PI * 4) * 0.06;
        star.setAttribute(
          "transform",
          `translate(380, 255) scale(${(M.lerp(0.15, 1.0, starP) * starBreath).toFixed(3)}) rotate(${(pGlobal * 45).toFixed(1)})`
        );
        star.style.opacity = String(M.clamp(M.progress(tm, breakStartMs, 240), 0, 1));

        beforeEl.style.opacity = String(M.lerp(1.0, 0.42, brkP).toFixed(3));
        afterEl.style.opacity = String(M.lerp(0.35, 1.0, brkP).toFixed(3));
        afterEl.style.transform = `scale(${M.lerp(0.95, 1.04, brkP).toFixed(3)})`;

        ruleFill.style.transform = `scaleX(${M.expoOut(M.progress(tm, 260, 620)).toFixed(4)})`;
        if (footEl) {
          footEl.style.opacity = String(M.power3Out(M.progress(tm, breakStartMs + 180, 420)));
        }
      },
    };
  }

  /* ==========================================================================
     8) COMPOSIÇÃO: narrative_arc (Arco Dramático Contínuo em 3 Atos)
     ========================================================================== */
  function mountNarrativeArc(ctx) {
    const { root, visual, preset, theme, beats, motionData: md, durationMs, Math: M } = ctx;
    const isDark = theme === "carvao" || theme === "azul_marinho";

    const rawSteps = Array.isArray(md.steps) && md.steps.length >= 2 ? md.steps : null;
    const steps = rawSteps
      ? rawSteps.slice(0, 3).map((st, idx) => ({
          tag: String(st.tag || `ATO 0${idx + 1}`).toUpperCase(),
          title: String(st.title || (beats[idx] && beats[idx].headline) || `Momento ${idx + 1}`),
          detail: String(st.detail || (beats[idx] && beats[idx].subtext) || ""),
        }))
      : [0, 1, 2].map((idx) => ({
          tag: `ATO 0${idx + 1}`,
          title: (beats[idx] && beats[idx].headline) || (idx === 0 ? visual.headline || "O Início" : idx === 1 ? "A Virada" : "A Resposta"),
          detail: (beats[idx] && beats[idx].subtext) || (idx === 0 ? visual.subtext || "" : ""),
        }));

    const showHandleEnd = Boolean(md.show_handle_end);
    const handle = (preset && preset.channel_handle) || "@pastorandrebezerra";
    const baseHeadline = String(visual.headline || steps[0].title);
    const baseSubtext = String(visual.subtext || "JORNADA NARRATIVA");

    root.innerHTML = `
      <div class="em-scene em-arc-scene">
        <div class="em-top-bar">
          <span class="em-kicker-pill">${M.escapeHtml(baseSubtext)}</span>
          ${buildBeatIndicatorHtml(beats, M)}
        </div>

        <div class="em-arc-stage">
          <!-- Trilha Vertical Curva SVG Desenhando Continuamente -->
          <svg class="em-arc-svg" viewBox="0 0 110 640" preserveAspectRatio="none" aria-hidden="true">
            <path d="M 55,44 C 24,180 86,320 55,460 C 40,530 55,580 55,606"
                  fill="none" stroke="${isDark ? "#F4EDE1" : "#1E3A5F"}" stroke-opacity="0.16" stroke-width="5" stroke-dasharray="8 8" />
            <path class="em-arc-progress-path" d="M 55,44 C 24,180 86,320 55,460 C 40,530 55,580 55,606"
                  fill="none" stroke="#E5A93C" stroke-width="6.5" stroke-linecap="round" stroke-dasharray="600" stroke-dashoffset="600" />
            <circle class="em-arc-node em-arc-node-0" cx="55" cy="84" r="14" fill="#1E3A5F" stroke="#E5A93C" stroke-width="4" />
            <circle class="em-arc-node em-arc-node-1" cx="62" cy="316" r="14" fill="#1E3A5F" stroke="#E5A93C" stroke-width="4" />
            <circle class="em-arc-node em-arc-node-2" cx="55" cy="548" r="16" fill="#9E3B2E" stroke="#E5A93C" stroke-width="4.5" />
          </svg>

          <!-- 3 Cartões de Ato Sincronizados aos Beats -->
          <div class="em-arc-cards">
            ${steps
              .map(
                (st, i) => `
                  <article class="em-arc-card" data-step="${i}">
                    <div class="em-arc-card-tag">${M.escapeHtml(st.tag)}</div>
                    <h2 class="em-arc-card-title">${M.escapeHtml(st.title)}</h2>
                    ${st.detail ? `<p class="em-arc-card-detail">${M.escapeHtml(st.detail)}</p>` : ""}
                  </article>
                `
              )
              .join("")}
          </div>
        </div>

        <div class="em-arc-footer">
          <div class="em-arc-headline">${M.escapeHtml(baseHeadline)}</div>
          ${showHandleEnd ? `<div class="em-arc-handle">${M.escapeHtml(handle)}</div>` : ""}
        </div>
      </div>
    `;

    const kickerEl = root.querySelector(".em-kicker-pill");
    const arcPath = root.querySelector(".em-arc-progress-path");
    const nodes = [0, 1, 2].map((i) => root.querySelector(`.em-arc-node-${i}`));
    const cards = Array.from(root.querySelectorAll(".em-arc-card"));
    const arcHeadEl = root.querySelector(".em-arc-headline");
    const handleEl = root.querySelector(".em-arc-handle");

    const stepStarts = [
      0,
      beats.length >= 2 ? beats[1].startMs : Math.round(durationMs * 0.34),
      beats.length >= 3 ? beats[2].startMs : Math.round(durationMs * 0.66),
    ];

    return {
      seek(t, pGlobal, beatState, tReal) {
        const tm = Number.isFinite(tReal) ? tReal : t;
        updateBeatDots(root, beatState);

        const activeSub = (beatState.activeBeat && beatState.activeBeat.subtext) || baseSubtext;
        const prevSub = (beatState.prevBeat && beatState.prevBeat.subtext) || baseSubtext;
        applyBeatTextSwap(kickerEl, activeSub, prevSub, beatState, M);

        const activeHead = (beatState.activeBeat && beatState.activeBeat.headline) || baseHeadline;
        const prevHead = (beatState.prevBeat && beatState.prevBeat.headline) || baseHeadline;
        applyBeatTextSwap(arcHeadEl, activeHead, prevHead, beatState, M);

        // Curva desenha continuamente de 0% até 92% da cena!
        const drawP = M.clamp(M.progress(tm, 80, durationMs * 0.88), 0, 1);
        arcPath.style.strokeDashoffset = String((600 * (1 - drawP)).toFixed(1));

        // Qual ato está em foco?
        let activeStep = 0;
        if (tm >= stepStarts[2]) activeStep = 2;
        else if (tm >= stepStarts[1]) activeStep = 1;

        cards.forEach((card, idx) => {
          const st = stepStarts[idx] || 0;
          const enterP = M.power3Out(M.progress(tm, st, 420));
          const isCurrent = idx === activeStep;
          const isPast = idx < activeStep;
          const op = isCurrent ? M.lerp(0.2, 1.0, enterP) : isPast ? 0.62 : 0.16;
          const scale = isCurrent ? M.lerp(0.95, 1.02, enterP) : 0.96;
          const tx = M.lerp(28, 0, enterP);
          card.classList.toggle("is-active", isCurrent);
          card.style.opacity = String(op.toFixed(3));
          card.style.transform = `translate3d(${tx.toFixed(1)}px, 0, 0) scale(${scale.toFixed(4)})`;

          const node = nodes[idx];
          if (node) {
            node.setAttribute("r", isCurrent ? "18" : isPast ? "13" : "10");
            node.setAttribute("fill", isCurrent ? "#E5A93C" : isPast ? "#9E3B2E" : "#1E3A5F");
          }
        });

        if (handleEl) {
          const hp = M.power3Out(M.progress(tm, stepStarts[2] + 220, 480));
          handleEl.style.opacity = String(hp);
          handleEl.style.transform = `translate3d(0, ${M.lerp(12, 0, hp).toFixed(1)}px, 0)`;
        }
      },
    };
  }

  /* ==========================================================================
     Registro do Template `editorial_motion`
     ========================================================================== */
  window.__STUDIO__.registerTemplate("editorial_motion", function createEditorialMotion(ctx) {
    const composition = resolveComposition(ctx.visual || {}, ctx.motionData || {}, ctx.scriptureRef);

    if (composition === "counter_impact") return mountCounterImpact(ctx);
    if (composition === "debt_scale") return mountDebtScale(ctx);
    if (composition === "forgiveness_seal") return mountForgivenessSeal(ctx);
    if (composition === "dramatic_split") return mountDramaticSplit(ctx);
    if (composition === "rhetorical_question") return mountRhetoricalQuestion(ctx);
    if (composition === "scripture_spotlight") return mountScriptureSpotlight(ctx);
    if (composition === "grace_illumination") return mountGraceIllumination(ctx);
    return mountNarrativeArc(ctx);
  });
})();
