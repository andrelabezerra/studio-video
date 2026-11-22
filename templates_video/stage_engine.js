/* ============================================================================
   Studio Video — Stage Engine Determinístico (100% Offline, Zero rAF no render)
   Contrato Público:
     - window.__STUDIO__.loadScene(payload)
     - window.__STUDIO__.seek(localTimeMs)
     - window.__STUDIO__.registerTemplate(name, factory)
     - window.__STUDIO__.getTemplateCatalog()
     - window.__STUDIO__.getState()
   ============================================================================ */

(function () {
  "use strict";

  const STAGE_W = 1080;
  const STAGE_H = 1920;

  const TEMPLATE_CATALOG = [
    {
      id: "paper_collage",
      label: "Paper Collage Editorial",
      tier: 1,
      default_cost_usd: 0.0,
      description:
        "Recorte tátil em papel rasgado com sombra real, fita crepe, seta SVG e marca-texto dourado.",
      recommended_formats: [
        "mapa_contexto",
        "perdido_traducao",
        "mito_vs_texto",
        "conexao_at_nt",
      ],
      editable_fields: [
        { key: "headline", label: "Título Principal (Headline)", type: "text", placeholder: "MAKÁRIOS" },
        { key: "subtext", label: "Subtexto / Referência", type: "text", placeholder: "Grego · Mateus 5" },
        { key: "original_term", label: "Termo Original / Destaque", type: "text", placeholder: "μακάριος" },
        { key: "stamp_text", label: "Carimbo Editorial (Opcional)", type: "text", placeholder: "MITO" },
      ],
    },
    {
      id: "bible_quote_card",
      label: "Cartão de Versículo Bíblico",
      tier: 1,
      default_cost_usd: 0.0,
      description:
        "Cartão editorial inclinado com referência bíblica verificada e grifo progressivo nas palavras-chave.",
      recommended_formats: [
        "perdido_traducao",
        "mito_vs_texto",
        "conexao_at_nt",
        "mapa_contexto",
      ],
      editable_fields: [
        { key: "headline", label: "Síntese / Destaque do Versículo", type: "text", placeholder: "Deles é o Reino dos Céus" },
        { key: "subtext", label: "Referência & Tradução", type: "text", placeholder: "Mateus 5:3 · NVI" },
        { key: "original_term", label: "Termo-Chave / Nota Lexical", type: "text", placeholder: "Reino dos Céus" },
        { key: "stamp_text", label: "Selo de Verificação", type: "text", placeholder: "TEXTO VERIFICADO" },
      ],
    },
    {
      id: "kinetic_captions",
      label: "Tipografia Cinética Vox",
      tier: 1,
      default_cost_usd: 0.0,
      description:
        "Blocos tipográficos de alto impacto (4 a 6 palavras) com badge de termo original e carimbo editorial.",
      recommended_formats: ["perdido_traducao", "mito_vs_texto"],
      editable_fields: [
        { key: "headline", label: "Frase-Âncora / Hook", type: "text", placeholder: "NÃO É SÓ FELICIDADE" },
        { key: "subtext", label: "Contexto / Idioma Original", type: "text", placeholder: "GREGO · μακάριος" },
        { key: "original_term", label: "Termo Original (Grego / Hebraico)", type: "text", placeholder: "μακάριος (makários)" },
        { key: "stamp_text", label: "Carimbo Terracota", type: "text", placeholder: "ATENÇÃO" },
      ],
    },
    {
      id: "timeline_map",
      label: "Mapa & Linha do Tempo SVG",
      tier: 1,
      default_cost_usd: 0.0,
      description:
        "Cartografia histórica com rota SVG animada (stroke-dashoffset) e linha do tempo AT -> NT.",
      recommended_formats: ["mapa_contexto", "conexao_at_nt"],
      editable_fields: [
        { key: "headline", label: "Título / Marco Principal", type: "text", placeholder: "ROTA: GALILEIA → JERUSALÉM" },
        { key: "subtext", label: "Coordenadas / Contexto", type: "text", placeholder: "120 km · Contexto Histórico" },
        { key: "original_term", label: "Origem → Destino (ou Época AT → NT)", type: "text", placeholder: "Cafarnaum → Jerusalém" },
        { key: "stamp_text", label: "Selo Cartográfico / Carimbo", type: "text", placeholder: "ROTA HISTÓRICA" },
      ],
    },
    {
      id: "tier2_video",
      label: "Nível 2 · Vídeo / Arte Generativa",
      tier: 2,
      default_cost_usd: 0.19,
      description:
        "Cena cinematográfica Nível 2 sob teto de custo USD com moldura Vox e movimento Ken Burns determinístico.",
      recommended_formats: [
        "mapa_contexto",
        "conexao_at_nt",
        "mito_vs_texto",
        "perdido_traducao",
      ],
      editable_fields: [
        { key: "headline", label: "Título Cinematográfico", type: "text", placeholder: "RECONSTRUÇÃO HISTÓRICA" },
        { key: "subtext", label: "Subtexto / Especificação Visual", type: "text", placeholder: "Nível 2 · Cena Assistida" },
        { key: "original_term", label: "Referência Visual / Local", type: "text", placeholder: "Jerusalém · Século I" },
        { key: "stamp_text", label: "Selo Editorial", type: "text", placeholder: "NÍVEL 2 · IA" },
      ],
    },
  ];

  const DEFAULT_PRESET = {
    preset_id: "pastor-andre-biblico",
    channel_handle: "@pastorandrebezerra",
    default_bible_translation: "NVI",
    video: { width: 1080, height: 1920, fps: 30 },
    safe_zones_px: { top: 220, bottom: 420, right: 160, left: 64 },
    palette: {
      parchment_bg: "#F4EDE1",
      charcoal_dark: "#181A1F",
      vox_gold: "#E5A93C",
      historical_navy: "#1E3A5F",
      terracotta_accent: "#9E3B2E",
      muted_ink: "#4A4E57",
      paper_shadow: "rgba(24, 26, 31, 0.24)",
    },
    typography: {
      display_font: "Playfair Display",
      body_font: "Inter",
      mono_font: "JetBrains Mono",
      max_words_per_kinetic_block: 6,
      caption_style: "editorial_pill_subtle",
    },
  };

  /* --------------------------------------------------------------------------
     Motor de Interpolação & Easing Determinístico Puro (substitui GSAP offline)
     -------------------------------------------------------------------------- */
  const StudioMath = {
    clamp(val, min, max) {
      return val < min ? min : val > max ? max : val;
    },

    lerp(a, b, t) {
      return a + (b - a) * t;
    },

    progress(timeMs, startMs, durationMs) {
      if (durationMs <= 0) return timeMs >= startMs ? 1 : 0;
      return StudioMath.clamp((timeMs - startMs) / durationMs, 0, 1);
    },

    linear(t) {
      return StudioMath.clamp(t, 0, 1);
    },

    power2Out(t) {
      const p = StudioMath.clamp(t, 0, 1);
      return 1 - (1 - p) * (1 - p);
    },

    power3Out(t) {
      const p = StudioMath.clamp(t, 0, 1);
      return 1 - Math.pow(1 - p, 3);
    },

    power3InOut(t) {
      const p = StudioMath.clamp(t, 0, 1);
      return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    },

    expoOut(t) {
      const p = StudioMath.clamp(t, 0, 1);
      return p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
    },

    backOut(t, overshoot) {
      const p = StudioMath.clamp(t, 0, 1);
      const c1 = typeof overshoot === "number" ? overshoot : 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
    },

    elasticOut(t) {
      const p = StudioMath.clamp(t, 0, 1);
      if (p === 0 || p === 1) return p;
      const c4 = (2 * Math.PI) / 3;
      return Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * c4) + 1;
    },

    tween(timeMs, startMs, durationMs, from, to, easeFn) {
      const p = StudioMath.progress(timeMs, startMs, durationMs);
      const e = easeFn ? easeFn(p) : p;
      return StudioMath.lerp(from, to, e);
    },

    normalizeToken(str) {
      return String(str || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\p{L}\p{N}]+/gu, "")
        .toLowerCase();
    },

    escapeHtml(str) {
      return String(str || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    },
  };

  /* --------------------------------------------------------------------------
     Estado do Engine e Registro de Templates
     -------------------------------------------------------------------------- */
  const templates = Object.create(null);

  const state = {
    payload: null,
    preset: DEFAULT_PRESET,
    scene: null,
    words: [],
    durationMs: 3500,
    sceneStartMs: 0,
    assetUrls: {},
    scriptureRef: null,
    showSafeZones: false,
    captionsEnabled: true,
    activeTemplate: null,
    activeTransition: null,
    captionGroups: [],
    captionNodes: [],
    currentTimeMs: 0,
    isDemoMode: false,
  };

  function getEls() {
    return {
      shell: document.getElementById("viewport-shell"),
      frame: document.getElementById("stage-frame"),
      stage: document.getElementById("stage"),
      bgGridRect: document.getElementById("bg-grid-rect"),
      bgGrainRect: document.getElementById("bg-grain-rect"),
      bgHalftoneTop: document.getElementById("bg-halftone-top"),
      cameraRig: document.getElementById("camera-rig"),
      chromeSeries: document.getElementById("chrome-series"),
      chromeOrder: document.getElementById("chrome-order"),
      chromeHandle: document.getElementById("chrome-handle"),
      chromeProgress: document.getElementById("chrome-progress"),
      sceneRoot: document.getElementById("scene-root"),
      captionBar: document.getElementById("caption-bar"),
      captionPill: document.getElementById("caption-pill"),
      captionWords: document.getElementById("caption-words"),
      transitionLayer: document.getElementById("transition-layer"),
      safeZonesOverlay: document.getElementById("safe-zones-overlay"),
    };
  }

  /* --------------------------------------------------------------------------
     Auto-Scale Responsivo (1:1 em 1080×1920, 0.5x edge-to-edge em 540×960)
     -------------------------------------------------------------------------- */
  function updateViewportScale() {
    const { frame } = getEls();
    if (!frame) return;

    const vw = window.innerWidth || STAGE_W;
    const vh = window.innerHeight || STAGE_H;
    const isDemo = state.isDemoMode;

    if (!isDemo) {
      const aspectDiff = Math.abs(vw / vh - STAGE_W / STAGE_H);
      if (aspectDiff < 0.015) {
        // Exato 9:16 (ex.: 1080×1920 ou 540×960 no compositor Playwright/CDP)
        const scale = vw / STAGE_W;
        frame.style.position = "fixed";
        frame.style.left = "0px";
        frame.style.top = "0px";
        frame.style.transformOrigin = "top left";
        frame.style.transform = `scale(${scale})`;
        return;
      }
      // Browser desktop sem ?demo=1: centraliza mantendo 9:16
      const scale = Math.min(vw / STAGE_W, vh / STAGE_H);
      const offsetX = Math.max(0, (vw - STAGE_W * scale) / 2);
      const offsetY = Math.max(0, (vh - STAGE_H * scale) / 2);
      frame.style.position = "fixed";
      frame.style.left = `${offsetX}px`;
      frame.style.top = `${offsetY}px`;
      frame.style.transformOrigin = "top left";
      frame.style.transform = `scale(${scale})`;
      return;
    }

    // Modo demo: deixa espaço à direita para o painel de controle
    const availW = Math.max(280, vw - 400);
    const availH = Math.max(480, vh - 40);
    const scale = Math.min(availW / STAGE_W, availH / STAGE_H);
    const offsetX = Math.max(20, (availW - STAGE_W * scale) / 2);
    const offsetY = Math.max(20, (vh - STAGE_H * scale) / 2);
    frame.style.position = "fixed";
    frame.style.left = `${offsetX}px`;
    frame.style.top = `${offsetY}px`;
    frame.style.transformOrigin = "top left";
    frame.style.transform = `scale(${scale})`;
  }

  /* --------------------------------------------------------------------------
     Aplicação de Paleta, Safe-Zones e Tema
     -------------------------------------------------------------------------- */
  function resolveTheme(rawTheme, templateName) {
    const normalized = String(rawTheme || "").toLowerCase().trim();
    if (normalized === "carvao" || normalized === "charcoal" || normalized === "dark" || normalized === "noturno") {
      return "carvao";
    }
    if (normalized === "azul_marinho" || normalized === "navy" || normalized === "historico") {
      return "azul_marinho";
    }
    if (normalized === "pergaminho" || normalized === "parchment" || normalized === "light") {
      return "pergaminho";
    }
    return templateName === "kinetic_captions" ? "carvao" : "pergaminho";
  }

  function applyPresetAndTheme(preset, theme) {
    const els = getEls();
    const pal = Object.assign({}, DEFAULT_PRESET.palette, (preset && preset.palette) || {});
    const sz = Object.assign({}, DEFAULT_PRESET.safe_zones_px, (preset && preset.safe_zones_px) || {});
    const rootStyle = document.documentElement.style;

    rootStyle.setProperty("--bg-parchment", pal.parchment_bg);
    rootStyle.setProperty("--bg-charcoal", pal.charcoal_dark);
    rootStyle.setProperty("--vox-gold", pal.vox_gold);
    rootStyle.setProperty("--historical-navy", pal.historical_navy);
    rootStyle.setProperty("--terracotta", pal.terracotta_accent);
    rootStyle.setProperty("--muted-ink", pal.muted_ink);
    rootStyle.setProperty("--paper-shadow", pal.paper_shadow);

    rootStyle.setProperty("--safe-top", `${sz.top}px`);
    rootStyle.setProperty("--safe-bottom", `${sz.bottom}px`);
    rootStyle.setProperty("--safe-left", `${sz.left}px`);
    rootStyle.setProperty("--safe-right", `${sz.right}px`);

    els.stage.classList.remove("theme-pergaminho", "theme-carvao", "theme-azul_marinho");
    els.stage.classList.add(`theme-${theme}`);

    const isDark = theme === "carvao" || theme === "azul_marinho";
    els.bgGridRect.setAttribute("fill", isDark ? "url(#vox-editorial-grid-light)" : "url(#vox-editorial-grid-dark)");
    els.bgGrainRect.setAttribute("filter", isDark ? "url(#vox-charcoal-grain)" : "url(#vox-paper-grain)");
    els.bgGrainRect.setAttribute("opacity", isDark ? "0.65" : "0.75");
    els.bgHalftoneTop.setAttribute("fill", isDark ? "url(#vox-halftone-light)" : "url(#vox-halftone-dark)");
  }

  function inferSeriesLabel(payload) {
    if (payload.series_label) return payload.series_label;
    const visSeries = payload.scene && payload.scene.visual && payload.scene.visual.series_label;
    if (visSeries) return visSeries;
    const fmt = String(payload.format_type || "").toLowerCase();
    const map = {
      mapa_contexto: "MAPA & CONTEXTO",
      perdido_traducao: "PERDIDO NA TRADUÇÃO",
      mito_vs_texto: "MITO VS. TEXTO",
      conexao_at_nt: "CONEXÃO AT → NT",
    };
    if (map[fmt]) return map[fmt];
    return "VOX BÍBLICO";
  }

  /* --------------------------------------------------------------------------
     Normalização de Palavras (relativas ao início da cena)
     -------------------------------------------------------------------------- */
  function buildLocalWords(rawWords, sceneStartMs, durationMs) {
    if (!Array.isArray(rawWords) || rawWords.length === 0) return [];
    let effectiveStart = Number.isFinite(sceneStartMs) ? sceneStartMs : 0;
    const firstValidStart = rawWords
      .map((w) => Number(w.start_ms))
      .find((n) => Number.isFinite(n));
    if (effectiveStart === 0 && Number.isFinite(firstValidStart) && firstValidStart >= durationMs) {
      effectiveStart = firstValidStart;
    }

    const list = rawWords.map((w, idx) => {
      const start = Number(w.start_ms);
      const end = Number(w.end_ms);
      const localStart = Number.isFinite(start) ? start - effectiveStart : idx * 280;
      const localEnd = Number.isFinite(end) ? Math.max(localStart + 60, end - effectiveStart) : localStart + 240;
      return {
        word_id: String(w.word_id || `w_${idx}`),
        text: String(w.text || "").trim(),
        start_ms: Number.isFinite(start) ? start : localStart,
        end_ms: Number.isFinite(end) ? end : localEnd,
        local_start_ms: StudioMath.clamp(localStart, 0, Math.max(durationMs, localStart)),
        local_end_ms: StudioMath.clamp(localEnd, 0, Math.max(durationMs, localEnd)),
      };
    }).filter((w) => w.text.length > 0);
    return list;
  }

  /* --------------------------------------------------------------------------
     Legenda Editorial Sutil (blocos de 4–6 palavras, y <= 1484)
     -------------------------------------------------------------------------- */
  function buildCaptionGroups(localWords, maxWordsPerGroup) {
    const limit = Math.max(3, Math.min(6, maxWordsPerGroup || 5));
    if (!localWords.length) return [];

    const groups = [];
    let current = [];
    for (let i = 0; i < localWords.length; i++) {
      const w = localWords[i];
      current.push(w);
      const endsSentence = /[.!?;:]$/.test(w.text);
      const charCount = current.reduce((acc, item) => acc + item.text.length + 1, 0);
      if (current.length >= limit || (endsSentence && current.length >= 2) || charCount >= 34) {
        groups.push(current);
        current = [];
      }
    }
    if (current.length) groups.push(current);

    return groups.map((words, idx) => {
      const nextGroup = groups[idx + 1];
      const startMs = idx === 0 ? 0 : words[0].local_start_ms;
      const endMs = nextGroup ? nextGroup[0].local_start_ms : Number.POSITIVE_INFINITY;
      return { idx, words, startMs, endMs };
    });
  }

  function setupCaptionBar(localWords, highlightIds, templateName, enabled) {
    const els = getEls();
    const isKinetic = templateName === "kinetic_captions";
    els.captionBar.classList.toggle("caption-subtle", isKinetic);

    if (!enabled || !localWords.length) {
      els.captionBar.style.display = "none";
      state.captionGroups = [];
      state.captionNodes = [];
      return;
    }

    els.captionBar.style.display = "flex";
    const maxPerGroup = isKinetic ? 5 : 5;
    state.captionGroups = buildCaptionGroups(localWords, maxPerGroup);
    state.captionNodes = [];
    els.captionWords.innerHTML = "";

    const hlSet = new Set(highlightIds || []);
    state.captionGroups.forEach((group) => {
      const groupEl = document.createElement("div");
      groupEl.className = "caption-words";
      groupEl.style.display = "none";
      const wordSpans = group.words.map((w) => {
        const span = document.createElement("span");
        span.className = "cap-word" + (hlSet.has(w.word_id) ? " is-key" : "");
        span.textContent = w.text;
        groupEl.appendChild(span);
        return { el: span, word: w };
      });
      els.captionWords.appendChild(groupEl);
      state.captionNodes.push({ group, el: groupEl, wordSpans });
    });
  }

  function updateCaptionBar(localTimeMs) {
    const els = getEls();
    if (!state.captionNodes.length) return;

    let activeEntry = state.captionNodes[0];
    for (let i = 0; i < state.captionNodes.length; i++) {
      const entry = state.captionNodes[i];
      if (localTimeMs >= entry.group.startMs && localTimeMs < entry.group.endMs) {
        activeEntry = entry;
        break;
      }
    }

    state.captionNodes.forEach((entry) => {
      const isCurrent = entry === activeEntry;
      entry.el.style.display = isCurrent ? "flex" : "none";
      if (!isCurrent) return;

      entry.wordSpans.forEach(({ el, word }) => {
        const isActive = localTimeMs >= word.local_start_ms && localTimeMs <= word.local_end_ms + 45;
        const isPast = localTimeMs > word.local_end_ms + 45;
        el.classList.toggle("is-active", isActive);
        el.classList.toggle("is-past", isPast);
      });
    });

    // Entrada suave da pílula de legenda no início da cena
    const introP = StudioMath.power3Out(StudioMath.progress(localTimeMs, 120, 260));
    els.captionPill.style.opacity = String(introP);
    els.captionPill.style.transform = `translateY(${StudioMath.lerp(18, 0, introP).toFixed(2)}px)`;
  }

  /* --------------------------------------------------------------------------
     Transições Táteis (paper_tear / whip_pan / stamp_drop / cut)
     -------------------------------------------------------------------------- */
  function buildTransitionLayer(transitionIn, theme) {
    const els = getEls();
    els.transitionLayer.innerHTML = "";
    const kind = String(transitionIn || "cut").toLowerCase();

    if (kind === "paper_tear") {
      const fillPrimary = theme === "carvao" ? "#F4EDE1" : "#181A1F";
      const fillFiber = theme === "carvao" ? "#E5D6BE" : "#F4EDE1";

      const topSvg = `
        <svg class="tear-half tear-half-top" viewBox="0 0 1160 1080" preserveAspectRatio="none">
          <path d="M0,0 L1160,0 L1160,990 L1080,1018 L1005,982 L920,1022 L835,988 L750,1030 L660,985 L575,1025 L485,982 L395,1024 L310,986 L220,1026 L130,984 L55,1016 L0,992 Z" fill="${fillFiber}" />
          <path d="M0,0 L1160,0 L1160,972 L1080,1000 L1005,964 L920,1004 L835,970 L750,1012 L660,967 L575,1007 L485,964 L395,1006 L310,968 L220,1008 L130,966 L55,998 L0,974 Z" fill="${fillPrimary}" />
        </svg>`;
      const botSvg = `
        <svg class="tear-half tear-half-bottom" viewBox="0 0 1160 1080" preserveAspectRatio="none">
          <path d="M0,88 L55,64 L130,96 L220,54 L310,94 L395,56 L485,98 L575,55 L660,95 L750,50 L835,92 L920,58 L1005,98 L1080,62 L1160,90 L1160,1080 L0,1080 Z" fill="${fillFiber}" />
          <path d="M0,106 L55,82 L130,114 L220,72 L310,112 L395,74 L485,116 L575,73 L660,113 L750,68 L835,110 L920,76 L1005,116 L1080,80 L1160,108 L1160,1080 L0,1080 Z" fill="${fillPrimary}" />
        </svg>`;
      els.transitionLayer.innerHTML = topSvg + botSvg;
      const topEl = els.transitionLayer.querySelector(".tear-half-top");
      const botEl = els.transitionLayer.querySelector(".tear-half-bottom");

      return function seekPaperTear(t) {
        const dur = 380;
        if (t >= dur) {
          topEl.style.opacity = "0";
          botEl.style.opacity = "0";
          return { tx: 0, ty: 0, scale: 1, skewX: 0, rot: 0 };
        }
        const p = StudioMath.expoOut(StudioMath.progress(t, 0, dur));
        const shift = p * 1120;
        const rot = p * 4.2;
        const opacity = 1 - StudioMath.progress(t, 240, 140);
        topEl.style.opacity = String(opacity);
        botEl.style.opacity = String(opacity);
        topEl.style.transform = `translate3d(0, ${(-shift).toFixed(2)}px, 0) rotate(${(-rot).toFixed(2)}deg)`;
        botEl.style.transform = `translate3d(0, ${shift.toFixed(2)}px, 0) rotate(${rot.toFixed(2)}deg)`;
        return {
          tx: 0,
          ty: 0,
          scale: StudioMath.lerp(1.045, 1.0, p),
          skewX: 0,
          rot: 0,
        };
      };
    }

    if (kind === "whip_pan") {
      els.transitionLayer.innerHTML = `<div class="whip-streak"></div>`;
      const streakEl = els.transitionLayer.querySelector(".whip-streak");

      return function seekWhipPan(t) {
        const dur = 260;
        if (t >= dur) {
          streakEl.style.opacity = "0";
          return { tx: 0, ty: 0, scale: 1, skewX: 0, rot: 0 };
        }
        const p = StudioMath.expoOut(StudioMath.progress(t, 0, dur));
        const tx = StudioMath.lerp(960, 0, p);
        const skewX = StudioMath.lerp(-9, 0, p);
        const streakOpacity = Math.sin(StudioMath.progress(t, 0, dur) * Math.PI) * 0.85;
        streakEl.style.opacity = streakOpacity.toFixed(3);
        streakEl.style.transform = `translate3d(${StudioMath.lerp(520, -680, p).toFixed(1)}px, 0, 0)`;
        return { tx, ty: 0, scale: 1, skewX, rot: 0 };
      };
    }

    if (kind === "stamp_drop") {
      return function seekStampDrop(t) {
        const dur = 320;
        if (t >= dur) {
          return { tx: 0, ty: 0, scale: 1, skewX: 0, rot: 0 };
        }
        const p = StudioMath.backOut(StudioMath.progress(t, 0, 220), 1.35);
        const scale = StudioMath.lerp(1.12, 1.0, p);
        const ty = StudioMath.lerp(-34, 0, p);
        // Micro-impacto amortecido entre 110ms e 290ms
        let shakeX = 0;
        let shakeY = 0;
        if (t > 100 && t < 300) {
          const decay = 1 - (t - 100) / 200;
          shakeX = Math.sin(t * 0.14) * 6 * decay;
          shakeY = Math.cos(t * 0.19) * 5 * decay;
        }
        return { tx: shakeX, ty: ty + shakeY, scale, skewX: 0, rot: 0 };
      };
    }

    // cut padrão: micro-assentamento editorial sutil
    return function seekCut(t) {
      const p = StudioMath.power3Out(StudioMath.progress(t, 0, 140));
      return {
        tx: 0,
        ty: 0,
        scale: StudioMath.lerp(1.012, 1.0, p),
        skewX: 0,
        rot: 0,
      };
    };
  }

  /* --------------------------------------------------------------------------
     Movimento de Câmera Contínuo (camera_motion)
     -------------------------------------------------------------------------- */
  function evaluateCameraMotion(motion, localTimeMs, durationMs) {
    const p = StudioMath.clamp(durationMs > 0 ? localTimeMs / durationMs : 0, 0, 1);
    const kind = String(motion || "subtle_zoom_in").toLowerCase();

    if (kind === "subtle_zoom_out") {
      return { tx: 0, ty: 0, scale: StudioMath.lerp(1.024, 1.0, p), rot: 0 };
    }
    if (kind === "pan_up") {
      return { tx: 0, ty: StudioMath.lerp(8, -8, p), scale: 1.016, rot: 0 };
    }
    if (kind === "pan_left") {
      return { tx: StudioMath.lerp(8, -8, p), ty: 0, scale: 1.016, rot: 0 };
    }
    if (kind === "none" || kind === "static") {
      return { tx: 0, ty: 0, scale: 1.0, rot: 0 };
    }
    // subtle_zoom_in (padrão Vox documental calibrado para permanecer 100% na safe-zone)
    return {
      tx: Math.sin(p * Math.PI * 1.5) * 2.0,
      ty: Math.cos(p * Math.PI) * 1.8,
      scale: StudioMath.lerp(1.0, 1.024, p),
      rot: Math.sin(p * Math.PI) * 0.14,
    };
  }

  /* --------------------------------------------------------------------------
     Espera determinística de imagens em asset_urls (com timeout seguro)
     -------------------------------------------------------------------------- */
  function waitForImages(rootEl) {
    const imgs = Array.from(rootEl.querySelectorAll("img"));
    if (!imgs.length) return Promise.resolve();
    const promises = imgs.map(
      (img) =>
        new Promise((resolve) => {
          if (img.complete && img.naturalWidth > 0) {
            resolve();
            return;
          }
          let done = false;
          const finish = () => {
            if (done) return;
            done = true;
            resolve();
          };
          img.addEventListener("load", finish, { once: true });
          img.addEventListener("error", finish, { once: true });
          setTimeout(finish, 1800);
        })
    );
    return Promise.all(promises).then(() => undefined);
  }

  /* --------------------------------------------------------------------------
     API Pública: window.__STUDIO__
     -------------------------------------------------------------------------- */
  const STUDIO = {
    Math: StudioMath,
    STAGE_W,
    STAGE_H,

    registerTemplate(name, factory) {
      if (!name || typeof factory !== "function") {
        throw new Error(`Template inválido ao registrar: ${name}`);
      }
      templates[String(name).toLowerCase()] = factory;
    },

    loadScene(payload) {
      if (!payload || typeof payload !== "object") {
        throw new Error("window.__STUDIO__.loadScene requer um objeto payload válido.");
      }

      const els = getEls();
      const scene = payload.scene || {};
      const visual = scene.visual || {};
      const timing = scene.timing || {};
      const preset = Object.assign({}, DEFAULT_PRESET, payload.preset || {});
      const rawTemplateName = String(scene.template || "paper_collage").toLowerCase();
      const templateName =
        rawTemplateName === "tier2_video" || Number(scene.tier) === 2
          ? "tier2_video"
          : rawTemplateName;
      const formatType = String(payload.format_type || scene.format_type || "").toLowerCase();

      const resolvedStart = Number.isFinite(Number(payload.scene_start_ms))
        ? Number(payload.scene_start_ms)
        : Number.isFinite(Number(timing.resolved_start_ms))
          ? Number(timing.resolved_start_ms)
          : 0;

      let durationMs = Number(payload.duration_ms);
      if (!Number.isFinite(durationMs) || durationMs <= 0) {
        if (Number.isFinite(Number(timing.resolved_end_ms)) && Number.isFinite(Number(timing.resolved_start_ms))) {
          durationMs = Math.max(500, Number(timing.resolved_end_ms) - Number(timing.resolved_start_ms));
        } else {
          durationMs = 3500;
        }
      }

      const theme = resolveTheme(visual.background_theme, templateName);
      applyPresetAndTheme(preset, theme);

      state.payload = payload;
      state.preset = preset;
      state.scene = scene;
      state.durationMs = durationMs;
      state.sceneStartMs = resolvedStart;
      state.assetUrls = payload.asset_urls || {};
      state.scriptureRef = payload.scripture_ref || null;
      state.showSafeZones = Boolean(payload.show_safe_zones);
      state.captionsEnabled = payload.captions_enabled !== false;
      state.words = buildLocalWords(payload.words || [], resolvedStart, durationMs);

      els.stage.dataset.template = templateName;
      els.safeZonesOverlay.hidden = !state.showSafeZones;

      // Cabeçalho editorial superior (sempre dentro da safe-zone)
      els.chromeSeries.textContent = inferSeriesLabel(payload);
      const orderNum = Number(scene.order);
      els.chromeOrder.textContent = Number.isFinite(orderNum) && orderNum > 0
        ? String(orderNum).padStart(2, "0")
        : String(scene.scene_id || "01").toUpperCase();
      els.chromeHandle.textContent = preset.channel_handle || "@pastorandrebezerra";

      // Montagem do template específico (fallback para paper_collage se template futuro)
      const factory = templates[templateName] || templates.paper_collage;
      if (!factory) {
        throw new Error(`Template '${templateName}' não registrado em window.__STUDIO__.`);
      }

      els.sceneRoot.innerHTML = "";
      state.activeTemplate = factory({
        root: els.sceneRoot,
        payload,
        formatType,
        scene,
        visual,
        preset,
        theme,
        words: state.words,
        durationMs: state.durationMs,
        sceneStartMs: state.sceneStartMs,
        assetUrls: state.assetUrls,
        scriptureRef: state.scriptureRef,
        Math: StudioMath,
      });

      setupCaptionBar(
        state.words,
        visual.highlight_word_ids || [],
        templateName,
        state.captionsEnabled
      );

      state.activeTransition = buildTransitionLayer(visual.transition_in, theme);

      updateViewportScale();
      STUDIO.seek(0);

      return waitForImages(els.sceneRoot).then(() => {
        STUDIO.seek(state.currentTimeMs);
        return {
          ok: true,
          template: templateName,
          duration_ms: state.durationMs,
          word_count: state.words.length,
        };
      });
    },

    seek(localTimeMs) {
      const els = getEls();
      const t = StudioMath.clamp(Number(localTimeMs) || 0, 0, Math.max(1, state.durationMs));
      state.currentTimeMs = t;

      // Progresso sutil no cabeçalho editorial
      const pGlobal = StudioMath.clamp(t / Math.max(1, state.durationMs), 0, 1);
      els.chromeProgress.style.transform = `scaleX(${pGlobal.toFixed(4)})`;

      // Transição + câmera composta
      const tr = state.activeTransition ? state.activeTransition(t) : { tx: 0, ty: 0, scale: 1, skewX: 0, rot: 0 };
      const cam = evaluateCameraMotion(
        state.scene && state.scene.visual && state.scene.visual.camera_motion,
        t,
        state.durationMs
      );

      const tx = cam.tx + tr.tx;
      const ty = cam.ty + tr.ty;
      const sc = cam.scale * tr.scale;
      const rot = cam.rot + tr.rot;
      const skewX = tr.skewX || 0;

      els.cameraRig.style.transform =
        `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${sc.toFixed(4)}) rotate(${rot.toFixed(3)}deg) skewX(${skewX.toFixed(2)}deg)`;

      // Delegação determinística ao template ativo
      if (state.activeTemplate && typeof state.activeTemplate.seek === "function") {
        state.activeTemplate.seek(t, pGlobal);
      }

      // Atualização determinística da legenda editorial
      updateCaptionBar(t);
    },

    setSafeZones(visible) {
      const els = getEls();
      state.showSafeZones = Boolean(visible);
      els.safeZonesOverlay.hidden = !state.showSafeZones;
    },

    getTemplateCatalog() {
      const list = TEMPLATE_CATALOG.map((item) =>
        Object.assign({}, item, {
          recommended_formats: item.recommended_formats.slice(),
          editable_fields: item.editable_fields.map((f) => Object.assign({}, f)),
        })
      );
      list.templates = list;
      return list;
    },

    getState() {
      return {
        template: state.scene ? state.scene.template : null,
        duration_ms: state.durationMs,
        current_time_ms: state.currentTimeMs,
        show_safe_zones: state.showSafeZones,
        registered_templates: Object.keys(templates),
      };
    },
  };

  /* --------------------------------------------------------------------------
     Template Integrado Nível 2: tier2_video (Ken Burns Determinístico + Moldura Vox)
     -------------------------------------------------------------------------- */
  function createTier2VideoTemplate(ctx) {
    const { root, scene, visual, words, durationMs, assetUrls, Math: M } = ctx;
    const headline = String(visual.headline || "CENA NÍVEL 2 · RECONSTRUÇÃO").trim();
    const subtext = String(visual.subtext || "Nível 2 · Composição Assistida").trim();
    const originalTerm = String(visual.original_term || "9:16 · 1080×1920 @ 30fps").trim();
    const stampLabel = String(visual.stamp_text || "NÍVEL 2 · IA").trim();

    let assetUrl = null;
    let modelBadge = "TIER 2 · GENERATIVE STUDIO";
    const assets = Array.isArray(scene.assets) ? scene.assets : [];
    for (let i = 0; i < assets.length; i++) {
      const a = assets[i];
      if (a && a.provider) {
        modelBadge = String(a.provider).toUpperCase();
      }
      if (a && a.asset_id && assetUrls && assetUrls[a.asset_id]) {
        assetUrl = assetUrls[a.asset_id];
        break;
      }
    }
    if (!assetUrl && assetUrls && typeof assetUrls === "object") {
      const keys = Object.keys(assetUrls);
      if (keys.length > 0) assetUrl = assetUrls[keys[0]];
    }

    const promptPreview =
      (assets[0] && assets[0].prompt) ||
      originalTerm ||
      "Composição visual cinematográfica Vox Bíblico 9:16 sob guardrail de custo USD.";

    const mediaHtml = assetUrl
      ? `<img class="t2-media-img" src="${M.escapeHtml(assetUrl)}" alt="${M.escapeHtml(headline)}" />`
      : `
        <svg class="t2-fallback-svg" viewBox="0 0 740 520" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="t2Bg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#1E3A5F" />
              <stop offset="55%" stop-color="#181A1F" />
              <stop offset="100%" stop-color="#2A1D1B" />
            </linearGradient>
          </defs>
          <rect width="740" height="520" fill="url(#t2Bg)" />
          <!-- Retícula de viewfinder cinematográfico -->
          <g stroke="#E5A93C" stroke-opacity="0.45" stroke-width="2" fill="none">
            <path d="M 36,64 L 36,36 L 64,36 M 676,36 L 704,36 L 704,64 M 36,456 L 36,484 L 64,484 M 676,484 L 704,484 L 704,456" />
            <circle class="t2-reticle-ring" cx="370" cy="240" r="92" stroke-dasharray="10 8" />
            <circle cx="370" cy="240" r="46" stroke="#FAF6EE" stroke-opacity="0.35" />
            <line x1="330" y1="240" x2="410" y2="240" />
            <line x1="370" y1="200" x2="370" y2="280" />
          </g>
          <rect x="64" y="366" width="612" height="96" rx="8" fill="#181A1F" fill-opacity="0.82" stroke="#E5A93C" stroke-width="1.5" />
          <text x="88" y="396" font-family="Consolas, monospace" font-size="14" font-weight="700" fill="#E5A93C" letter-spacing="1.5">PROMPT / ESPECIFICAÇÃO NÍVEL 2</text>
          <text x="88" y="428" font-family="Georgia, serif" font-size="19" font-weight="700" fill="#FAF6EE">${M.escapeHtml(promptPreview.slice(0, 62))}</text>
        </svg>
      `;

    const spokenText =
      words && words.length > 0
        ? words.map((w) => w.text).join(" ")
        : originalTerm;

    const headSize = headline.length <= 16 ? 62 : headline.length <= 26 ? 52 : 44;

    root.innerHTML = `
      <div class="t2-scene">
        <div class="t2-top-row">
          <span class="t2-tier-badge">NÍVEL 2 · CINEMÁTICO</span>
          <span class="t2-model-pill">${M.escapeHtml(modelBadge)}</span>
        </div>

        <div class="t2-frame-wrap">
          <div class="t2-back-sheet"></div>
          <div class="t2-paper-shadow">
            <div class="vox-tape pc-tape-tl"></div>
            <div class="vox-tape pc-tape-br"></div>
            <div class="t2-paper-outer">
              <div class="t2-paper-inner">
                ${mediaHtml}
                <div class="pc-caption-sticker">${M.escapeHtml(originalTerm)}</div>
              </div>
            </div>
          </div>
          <div class="vox-stamp t2-stamp">${M.escapeHtml(stampLabel)}</div>
        </div>

        <div class="t2-caption-block">
          <div class="pc-subtext-row">
            <div class="pc-subtext-badge"><span>${M.escapeHtml(subtext)}</span></div>
            <div class="pc-subtext-rule"></div>
          </div>
          <h1 class="t2-headline" style="font-size:${headSize}px;">
            <span class="t2-headline-bar"></span>
            <span>${M.escapeHtml(headline)}</span>
          </h1>
          <p class="pc-editorial-note">${M.escapeHtml(spokenText)}</p>
        </div>
      </div>
    `;

    const backSheet = root.querySelector(".t2-back-sheet");
    const paperShadow = root.querySelector(".t2-paper-shadow");
    const mediaImg = root.querySelector(".t2-media-img");
    const reticleRing = root.querySelector(".t2-reticle-ring");
    const stampEl = root.querySelector(".t2-stamp");
    const headlineBar = root.querySelector(".t2-headline-bar");

    return {
      seek(t, pGlobal) {
        const introP = M.backOut(M.progress(t, 60, 440), 1.3);
        backSheet.style.opacity = String(M.clamp(M.progress(t, 40, 200), 0, 1));
        backSheet.style.transform = `translate3d(-10px, 12px, 0) rotate(${M.lerp(-4.2, -1.8, introP).toFixed(2)}deg)`;

        paperShadow.style.opacity = String(M.clamp(M.progress(t, 70, 200), 0, 1));
        paperShadow.style.transform = `translate3d(0, ${M.lerp(54, 0, introP).toFixed(2)}px, 0) scale(${M.lerp(0.92, 1.0, introP).toFixed(4)}) rotate(${M.lerp(2.0, 0.5, introP).toFixed(2)}deg)`;

        // Movimento Ken Burns determinístico na imagem/asset Nível 2
        if (mediaImg) {
          const kbScale = M.lerp(1.02, 1.14, pGlobal);
          const kbX = M.lerp(-14, 14, pGlobal);
          const kbY = M.lerp(8, -10, pGlobal);
          mediaImg.style.transform = `translate3d(${kbX.toFixed(2)}px, ${kbY.toFixed(2)}px, 0) scale(${kbScale.toFixed(4)})`;
        }
        if (reticleRing) {
          reticleRing.setAttribute("transform", `rotate(${(pGlobal * 45).toFixed(2)} 370 240)`);
        }

        const barP = M.expoOut(M.progress(t, 240, 480));
        headlineBar.style.transform = `scaleX(${barP.toFixed(4)})`;

        if (stampEl) {
          const stP = M.backOut(M.progress(t, Math.min(480, durationMs * 0.25), 260), 1.6);
          stampEl.style.opacity = String(M.clamp(M.progress(t, 300, 120), 0, 1));
          stampEl.style.transform = `scale(${M.lerp(1.7, 1.0, stP).toFixed(4)}) rotate(-8deg)`;
        }
      },
    };
  }

  STUDIO.registerTemplate("tier2_video", createTier2VideoTemplate);

  window.__STUDIO__ = STUDIO;

  /* --------------------------------------------------------------------------
     Modo Demo Interativo (?demo=1)
     (Isolado: jamais executa rAF quando aberto em modo render sem ?demo=1)
     -------------------------------------------------------------------------- */
  function initDemoMode() {
    const params = new URLSearchParams(window.location.search);
    const isDemo = params.get("demo") === "1" || params.get("demo") === "true";
    state.isDemoMode = isDemo;

    document.body.classList.toggle("demo-mode", isDemo);
    document.body.classList.toggle("render-mode", !isDemo);
    updateViewportScale();
    window.addEventListener("resize", updateViewportScale);

    if (!isDemo) return;

    const controlsEl = document.getElementById("demo-controls");
    const buttonsEl = document.getElementById("demo-scene-buttons");
    const scrubberEl = document.getElementById("demo-scrubber");
    const playBtn = document.getElementById("demo-play");
    const prevBtn = document.getElementById("demo-prev-frame");
    const nextBtn = document.getElementById("demo-next-frame");
    const timecodeEl = document.getElementById("demo-timecode");
    const safeCheck = document.getElementById("demo-safe-zones");
    const themeBtn = document.getElementById("demo-toggle-theme");
    controlsEl.hidden = false;

    let demoData = null;
    let currentIdx = 0;
    let isPlaying = false;
    let playLastTs = 0;
    let rafId = null;

    function updateTimecode(ms) {
      const frame = Math.round((ms / 1000) * 30);
      timecodeEl.textContent = `${String(Math.round(ms)).padStart(4, "0")}ms · f${String(frame).padStart(3, "0")}`;
      scrubberEl.value = String(Math.round(ms));
    }

    function stopPlay() {
      isPlaying = false;
      playBtn.textContent = "▶ Play";
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
    }

    function tickPlay(ts) {
      if (!isPlaying) return;
      if (!playLastTs) playLastTs = ts;
      const dt = ts - playLastTs;
      playLastTs = ts;
      let nextMs = state.currentTimeMs + dt;
      if (nextMs > state.durationMs) nextMs = 0;
      STUDIO.seek(nextMs);
      updateTimecode(nextMs);
      rafId = requestAnimationFrame(tickPlay);
    }

    function loadDemoIndex(idx) {
      if (!demoData || !demoData.scenes || !demoData.scenes[idx]) return;
      stopPlay();
      currentIdx = idx;
      const item = demoData.scenes[idx];
      const payload = Object.assign({}, item, {
        preset: demoData.preset || DEFAULT_PRESET,
        show_safe_zones: safeCheck.checked,
      });
      scrubberEl.max = String(payload.duration_ms || 3500);
      STUDIO.loadScene(payload).then(() => {
        // Posiciona no ponto médio em demo inicial para visão imediata se query ?t=...
        const initialT = Number(params.get("t")) || 1100;
        const clamped = StudioMath.clamp(initialT, 0, state.durationMs);
        STUDIO.seek(clamped);
        updateTimecode(clamped);
      });

      Array.from(buttonsEl.querySelectorAll("button")).forEach((b, bIdx) => {
        b.classList.toggle("is-active", bIdx === idx);
      });
    }

    playBtn.addEventListener("click", () => {
      if (isPlaying) {
        stopPlay();
      } else {
        isPlaying = true;
        playLastTs = 0;
        playBtn.textContent = "❚❚ Pause";
        rafId = requestAnimationFrame(tickPlay);
      }
    });

    prevBtn.addEventListener("click", () => {
      stopPlay();
      const next = StudioMath.clamp(state.currentTimeMs - 33.33, 0, state.durationMs);
      STUDIO.seek(next);
      updateTimecode(next);
    });

    nextBtn.addEventListener("click", () => {
      stopPlay();
      const next = StudioMath.clamp(state.currentTimeMs + 33.33, 0, state.durationMs);
      STUDIO.seek(next);
      updateTimecode(next);
    });

    scrubberEl.addEventListener("input", () => {
      stopPlay();
      const ms = Number(scrubberEl.value) || 0;
      STUDIO.seek(ms);
      updateTimecode(ms);
    });

    safeCheck.addEventListener("change", () => {
      STUDIO.setSafeZones(safeCheck.checked);
    });

    themeBtn.addEventListener("click", () => {
      if (!demoData || !demoData.scenes[currentIdx]) return;
      const sc = demoData.scenes[currentIdx].scene;
      sc.visual = sc.visual || {};
      sc.visual.background_theme = sc.visual.background_theme === "carvao" ? "pergaminho" : "carvao";
      loadDemoIndex(currentIdx);
    });

    fetch("demo_scenes.json")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} ao carregar demo_scenes.json`);
        return res.json();
      })
      .then((data) => {
        demoData = data;
        buttonsEl.innerHTML = "";
        (data.scenes || []).forEach((item, idx) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "demo-btn";
          btn.textContent = `${idx + 1}. ${item.scene.template}`;
          btn.addEventListener("click", () => loadDemoIndex(idx));
          buttonsEl.appendChild(btn);
        });
        const sceneParam = Number(params.get("scene")) || 0;
        loadDemoIndex(StudioMath.clamp(sceneParam, 0, Math.max(0, (data.scenes || []).length - 1)));
      })
      .catch((err) => {
        console.error("[Studio Demo] Falha ao carregar demo_scenes.json:", err);
      });
  }

  /* --------------------------------------------------------------------------
     Bridge postMessage para Preview Ao Vivo em <iframe> (Cockpit Fase 2)
     Retrocompatível: não interfere com window.__STUDIO__ (Playwright/CDP)
     -------------------------------------------------------------------------- */
  function initPostMessageBridge() {
    window.addEventListener("message", (event) => {
      if (
        event.origin &&
        event.origin !== "null" &&
        window.location.origin &&
        window.location.origin !== "null" &&
        event.origin !== window.location.origin
      ) {
        return;
      }

      const data = event.data;
      if (!data || typeof data !== "object" || typeof data.type !== "string") {
        return;
      }

      const replyTarget = event.source || window.parent;
      const replyOrigin =
        event.origin && event.origin !== "null" ? event.origin : "*";

      if (data.type === "STUDIO_PING") {
        if (replyTarget && typeof replyTarget.postMessage === "function") {
          replyTarget.postMessage(
            { type: "STUDIO_READY", state: STUDIO.getState() },
            replyOrigin
          );
        }
        return;
      }

      if (data.type === "STUDIO_LOAD_SCENE") {
        try {
          const result = STUDIO.loadScene(data.payload);
          Promise.resolve(result)
            .then((info) => {
              if (typeof data.initialTimeMs === "number" && Number.isFinite(data.initialTimeMs)) {
                STUDIO.seek(data.initialTimeMs);
              }
              if (replyTarget && typeof replyTarget.postMessage === "function") {
                replyTarget.postMessage(
                  {
                    type: "STUDIO_SCENE_LOADED",
                    info,
                    state: STUDIO.getState(),
                    requestId: data.requestId || null,
                  },
                  replyOrigin
                );
              }
            })
            .catch((err) => {
              if (replyTarget && typeof replyTarget.postMessage === "function") {
                replyTarget.postMessage(
                  {
                    type: "STUDIO_ERROR",
                    message: String((err && err.message) || err),
                    requestId: data.requestId || null,
                  },
                  replyOrigin
                );
              }
            });
        } catch (err) {
          if (replyTarget && typeof replyTarget.postMessage === "function") {
            replyTarget.postMessage(
              {
                type: "STUDIO_ERROR",
                message: String((err && err.message) || err),
                requestId: data.requestId || null,
              },
              replyOrigin
            );
          }
        }
        return;
      }

      if (data.type === "STUDIO_SEEK") {
        STUDIO.seek(data.timeMs);
        return;
      }

      if (data.type === "STUDIO_SAFE_ZONES") {
        STUDIO.setSafeZones(Boolean(data.show));
      }
    });
  }

  initPostMessageBridge();

  document.addEventListener("DOMContentLoaded", () => {
    initDemoMode();
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(
        { type: "STUDIO_READY", state: STUDIO.getState() },
        "*"
      );
    }
  });
})();
