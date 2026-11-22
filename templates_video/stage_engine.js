/* ============================================================================
   Studio Video — Stage Engine Determinístico v2 (100% Offline, Zero rAF no render)
   Contrato Público:
     - window.__STUDIO__.loadScene(payload)
     - window.__STUDIO__.seek(localTimeMs)
     - window.__STUDIO__.registerTemplate(name, factory)
     - window.__STUDIO__.getTemplateCatalog()
     - window.__STUDIO__.getState()
     - window.__STUDIO__.resolveSceneBeats(visual, words, durationMs)
     - window.__STUDIO__.evaluateBeats(beats, t, durationMs)
     - window.__STUDIO__.assertNoPlaceholder(payload)
     - window.__STUDIO__.isForbiddenSeal(text)
   ============================================================================ */

(function () {
  "use strict";

  const STAGE_W = 1080;
  const STAGE_H = 1920;

  const TEMPLATE_CATALOG = [
    {
      id: "editorial_motion",
      label: "Editorial Motion · Palco Cinematográfico",
      tier: 1,
      default_cost_usd: 0.0,
      description:
        "Palco livre multi-beats (4s–9s) com 8 composições SVG coreografadas, câmera reativa e atmosfera viva.",
      recommended_formats: [
        "mapa_contexto",
        "perdido_traducao",
        "mito_vs_texto",
        "conexao_at_nt",
      ],
      compositions: [
        "auto",
        "debt_scale",
        "forgiveness_seal",
        "dramatic_split",
        "rhetorical_question",
        "grace_illumination",
        "narrative_arc",
        "counter_impact",
        "scripture_spotlight",
      ],
      editable_fields: [
        { key: "composition", label: "Composição Cinematográfica", type: "select", placeholder: "debt_scale" },
        { key: "headline", label: "Título Principal (Headline)", type: "text", placeholder: "UMA DÍVIDA IMPAGÁVEL" },
        { key: "subtext", label: "Subtexto / Contexto Editorial", type: "text", placeholder: "Mateus 18:21–35" },
        { key: "original_term", label: "Termo / Contraste / Destaque", type: "text", placeholder: "10.000 talentos" },
      ],
    },
    {
      id: "paper_collage",
      label: "Paper Collage Editorial",
      tier: 1,
      default_cost_usd: 0.0,
      description:
        "Recorte tátil em papel rasgado com sombra real, fita crepe, seta SVG, marca-texto dourado e multi-beats.",
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
      label: "Citação Bíblica Editorial",
      tier: 1,
      default_cost_usd: 0.0,
      description:
        "Prancha editorial limpa de documentário com referência bíblica, filete dourado animado e marca-texto sincronizado.",
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
      ],
    },
    {
      id: "kinetic_captions",
      label: "Tipografia Cinética Vox",
      tier: 1,
      default_cost_usd: 0.0,
      description:
        "Blocos tipográficos de alto impacto (4 a 6 palavras) com badge de termo original, sublinhados SVG e multi-beats.",
      recommended_formats: ["perdido_traducao", "mito_vs_texto"],
      editable_fields: [
        { key: "headline", label: "Frase-Âncora / Hook", type: "text", placeholder: "NÃO É SÓ FELICIDADE" },
        { key: "subtext", label: "Contexto / Idioma Original", type: "text", placeholder: "GREGO · μακάριος" },
        { key: "original_term", label: "Termo Original (Grego / Hebraico)", type: "text", placeholder: "μακάριος (makários)" },
        { key: "stamp_text", label: "Carimbo Terracota (Opcional)", type: "text", placeholder: "ATENÇÃO" },
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
        { key: "stamp_text", label: "Selo Cartográfico / Carimbo (Opcional)", type: "text", placeholder: "ROTA HISTÓRICA" },
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
     Guardrails Anti-Placeholder (Fail-Fast) e Anti-Selo Burocrático
     -------------------------------------------------------------------------- */
  const PLACEHOLDER_PATTERNS = [
    /\[\s*(?:conferir|todo|tbd|inserir|preencher|placeholder|editar|revisar|colocar)\b[^\]]*\]/i,
    /\bTODO\s*:/,
    /\{\{[^}]+\}\}/,
    /\blorem\s+ipsum\b/i,
  ];

  function detectPlaceholder(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    for (let i = 0; i < PLACEHOLDER_PATTERNS.length; i++) {
      const m = value.match(PLACEHOLDER_PATTERNS[i]);
      if (m) return m[0];
    }
    return null;
  }

  function scanObjectForPlaceholders(obj, pathPrefix) {
    if (obj === null || obj === undefined) return;
    if (typeof obj === "string") {
      const found = detectPlaceholder(obj);
      if (found) {
        throw new Error(
          `Placeholder editorial proibido detectado em '${pathPrefix}': "${found}". Remova antes de renderizar.`
        );
      }
      return;
    }
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        scanObjectForPlaceholders(obj[i], `${pathPrefix}[${i}]`);
      }
      return;
    }
    if (typeof obj === "object") {
      const keys = Object.keys(obj);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        scanObjectForPlaceholders(obj[k], pathPrefix ? `${pathPrefix}.${k}` : k);
      }
    }
  }

  function assertNoPlaceholder(payload) {
    if (!payload || typeof payload !== "object") return;
    const scene = payload.scene || {};
    const visual = scene.visual || {};
    const fieldsToCheck = {
      headline: visual.headline,
      subtext: visual.subtext,
      original_term: visual.original_term,
      stamp_text: visual.stamp_text,
      series_label: visual.series_label,
      beats: visual.beats,
      motion_data: visual.motion_data,
    };
    scanObjectForPlaceholders(fieldsToCheck, "scene.visual");
    if (payload.scripture_ref) {
      scanObjectForPlaceholders(
        {
          citation: payload.scripture_ref.citation,
          exact_text: payload.scripture_ref.exact_text,
        },
        "scripture_ref"
      );
    }
  }

  function isForbiddenSeal(text) {
    const norm = String(text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
    return norm === "texto verificado" || norm === "versiculo verificado";
  }

  /* --------------------------------------------------------------------------
     Motor de Interpolação & Easing Determinístico Puro (100% Offline)
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

    smoothstep(t) {
      const p = StudioMath.clamp(t, 0, 1);
      return p * p * (3 - 2 * p);
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

    formatNumberPtBr(num) {
      const n = Math.round(Number(num) || 0);
      return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
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
     Resolução & Avaliação de Multi-Beats (word_id-anchored ou progress 0..1)
     -------------------------------------------------------------------------- */
  function resolveSceneBeats(visual, localWords, durationMs) {
    const rawBeats = Array.isArray(visual && visual.beats) ? visual.beats : [];
    if (!rawBeats.length) return [];

    const wordMap = Object.create(null);
    (localWords || []).forEach((w) => {
      if (w && w.word_id) wordMap[w.word_id] = w;
    });

    const mapped = rawBeats.map((b, idx) => {
      const beat = b || {};
      let startMs = 0;
      if (beat.anchor_word_id && wordMap[beat.anchor_word_id]) {
        startMs = wordMap[beat.anchor_word_id].local_start_ms;
      } else if (typeof beat.progress === "number" && Number.isFinite(beat.progress)) {
        startMs = Math.round(StudioMath.clamp(beat.progress, 0, 0.96) * durationMs);
      } else {
        startMs = Math.round((idx / Math.max(1, rawBeats.length)) * durationMs);
      }
      // Garante que o primeiro beat começa no início se muito próximo de 0
      if (idx === 0 && startMs <= 220) startMs = 0;

      return {
        index: idx,
        beat_id: String(beat.beat_id || `b${idx + 1}`),
        anchor_word_id: beat.anchor_word_id || null,
        progress: StudioMath.clamp(startMs / Math.max(1, durationMs), 0, 1),
        startMs: StudioMath.clamp(startMs, 0, Math.max(1, durationMs - 60)),
        endMs: durationMs,
        headline: typeof beat.headline === "string" && beat.headline.trim() ? beat.headline.trim() : null,
        subtext: typeof beat.subtext === "string" && beat.subtext.trim() ? beat.subtext.trim() : null,
        emphasis: String(beat.emphasis || "gold").toLowerCase().trim(),
        visual_action: beat.visual_action ? String(beat.visual_action).toLowerCase().trim() : null,
        camera_shift: String(beat.camera_shift || "none").toLowerCase().trim(),
      };
    });

    mapped.sort((a, b) => a.startMs - b.startMs || a.index - b.index);
    for (let i = 0; i < mapped.length; i++) {
      mapped[i].index = i;
      mapped[i].endMs = i + 1 < mapped.length ? Math.max(mapped[i].startMs + 80, mapped[i + 1].startMs) : durationMs;
    }
    return mapped;
  }

  function evaluateBeats(beats, t, durationMs) {
    if (!Array.isArray(beats) || !beats.length) {
      return {
        hasBeats: false,
        activeIndex: 0,
        activeBeat: null,
        prevBeat: null,
        localT: t,
        beatProgress: StudioMath.clamp(t / Math.max(1, durationMs), 0, 1),
        transitionP: 1,
        beats: [],
      };
    }

    let activeIdx = 0;
    for (let i = 0; i < beats.length; i++) {
      if (t >= beats[i].startMs) {
        activeIdx = i;
      } else {
        break;
      }
    }

    const activeBeat = beats[activeIdx];
    const prevBeat = activeIdx > 0 ? beats[activeIdx - 1] : null;
    const localT = Math.max(0, t - activeBeat.startMs);
    const beatDur = Math.max(120, activeBeat.endMs - activeBeat.startMs);
    const beatProgress = StudioMath.clamp(localT / beatDur, 0, 1);
    const transitionP = StudioMath.power3Out(StudioMath.progress(localT, 0, 420));

    return {
      hasBeats: true,
      activeIndex: activeIdx,
      activeBeat,
      prevBeat,
      localT,
      beatProgress,
      transitionP,
      beats,
    };
  }

  /* --------------------------------------------------------------------------
     Estado do Engine e Registro de Templates
     -------------------------------------------------------------------------- */
  const templates = Object.create(null);

  const state = {
    payload: null,
    preset: DEFAULT_PRESET,
    scene: null,
    words: [],
    beats: [],
    durationMs: 3500,
    sceneStartMs: 0,
    assetUrls: {},
    scriptureRef: null,
    showSafeZones: false,
    captionsEnabled: true,
    activeTemplate: null,
    activeTransition: null,
    activeImageLayout: "none",
    activeAssetEntry: null,
    activeTheme: "pergaminho",
    activeAtmosphere: "warm_paper",
    atmosphereParticles: [],
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
      bgVignette: document.getElementById("bg-vignette"),
      mediaBg: document.getElementById("stage-media-bg"),
      mediaBgImg: document.getElementById("stage-media-bg-img"),
      mediaScrim: document.getElementById("stage-media-scrim"),
      mediaCutout: document.getElementById("stage-media-cutout"),
      mediaCutoutImg: document.getElementById("stage-media-cutout-img"),
      atmoRoot: document.getElementById("stage-atmosphere"),
      atmoLightBeam: document.getElementById("atmo-light-beam"),
      atmoSecondaryGlow: document.getElementById("atmo-secondary-glow"),
      atmoGrainSvg: document.getElementById("atmo-grain-svg"),
      atmoParticles: document.getElementById("atmo-particles"),
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

  function pickSceneAsset(scene, assetUrls) {
    if (!assetUrls || typeof assetUrls !== "object") return null;
    const assets = Array.isArray(scene && scene.assets) ? scene.assets : [];
    for (let i = 0; i < assets.length; i++) {
      const a = assets[i];
      if (a && a.asset_id && assetUrls[a.asset_id]) {
        return {
          asset_id: a.asset_id,
          url: assetUrls[a.asset_id],
          isCutout: Boolean(a.apply_rembg),
          provider: a.provider || "gemini_hybrid",
          prompt: a.prompt || "",
        };
      }
    }
    const keys = Object.keys(assetUrls);
    return keys.length
      ? { asset_id: keys[0], url: assetUrls[keys[0]], isCutout: false, provider: "gemini_hybrid", prompt: "" }
      : null;
  }

  function resolveImageLayout(visual, templateName, assetEntry) {
    if (!assetEntry || !assetEntry.url) return "none";
    const raw = String((visual && visual.image_layout) || "auto").toLowerCase().trim();
    if (raw === "none") return "none";
    if (raw === "card" || raw === "background" || raw === "background_blur" || raw === "cutout_overlay") {
      return raw;
    }
    if (templateName === "paper_collage" || templateName === "tier2_video") {
      return "card";
    }
    return "background";
  }

  function evaluateImageTransform(visual, pGlobal, tMs, durationMs) {
    const v = visual || {};
    const anim = String(v.image_animation || "ken_burns_in").toLowerCase().trim();
    const baseScale = StudioMath.clamp(Number(v.image_scale) || 1.0, 0.4, 2.5);
    const baseX = StudioMath.clamp(Number(v.image_offset_x) || 0, -60, 60);
    const baseY = StudioMath.clamp(Number(v.image_offset_y) || 0, -60, 60);
    const intensity =
      v.motion_intensity !== undefined && v.motion_intensity !== null
        ? StudioMath.clamp(Number(v.motion_intensity), 0, 2.0)
        : 1.0;
    const speed = StudioMath.clamp(Number(v.animation_speed) || 1.0, 0.4, 2.5);
    const p = StudioMath.clamp(pGlobal * speed, 0, 1);
    const phase = pGlobal * Math.PI * 2 * speed;

    let dScale = 1.0;
    let dxPct = 0;
    let dyPct = 0;
    let rotDeg = 0;

    if (anim === "ken_burns_in") {
      dScale = StudioMath.lerp(1.0, 1.0 + 0.12 * intensity, p);
      dxPct = StudioMath.lerp(-1.2, 1.2, p) * intensity;
      dyPct = StudioMath.lerp(0.8, -0.8, p) * intensity;
    } else if (anim === "ken_burns_out") {
      dScale = StudioMath.lerp(1.0 + 0.14 * intensity, 1.0, p);
      dxPct = StudioMath.lerp(1.2, -1.2, p) * intensity;
      dyPct = StudioMath.lerp(-0.8, 0.8, p) * intensity;
    } else if (anim === "pan_left") {
      dScale = 1.0 + 0.09 * intensity;
      dxPct = StudioMath.lerp(4.0, -4.0, p) * intensity;
    } else if (anim === "pan_right") {
      dScale = 1.0 + 0.09 * intensity;
      dxPct = StudioMath.lerp(-4.0, 4.0, p) * intensity;
    } else if (anim === "float") {
      dScale = 1.0 + 0.04 * intensity;
      dxPct = Math.sin(phase * 0.8) * 1.8 * intensity;
      dyPct = Math.cos(phase * 1.0) * 2.2 * intensity;
      rotDeg = Math.sin(phase * 0.6) * 1.4 * intensity;
    } else if (anim === "pulse") {
      dScale = 1.0 + (0.04 + Math.sin(phase * 1.4) * 0.045) * intensity;
    } else if (anim === "tilt") {
      dScale = 1.0 + 0.07 * intensity;
      rotDeg = StudioMath.lerp(-2.8, 2.8, p) * intensity;
      dxPct = StudioMath.lerp(-1.5, 1.5, p) * intensity;
    }

    const totalScale = baseScale * dScale;
    const totalX = baseX + dxPct;
    const totalY = baseY + dyPct;
    return {
      scale: totalScale,
      xPct: totalX,
      yPct: totalY,
      rotDeg,
      css: `translate3d(${totalX.toFixed(2)}%, ${totalY.toFixed(2)}%, 0) scale(${totalScale.toFixed(4)}) rotate(${rotDeg.toFixed(2)}deg)`,
    };
  }

  function evaluateElementEntrance(style, t, speed) {
    const kind = String(style || "vox_editorial").toLowerCase().trim();
    const s = StudioMath.clamp(Number(speed) || 1.0, 0.4, 2.5);
    const dur = Math.max(120, Math.round(420 / s));

    if (kind === "pop_bounce") {
      const p = StudioMath.backOut(StudioMath.progress(t, 0, dur), 1.65);
      const op = StudioMath.clamp(StudioMath.progress(t, 0, Math.round(dur * 0.45)), 0, 1);
      return {
        opacity: op,
        transform: `scale(${StudioMath.lerp(0.84, 1.0, p).toFixed(4)})`,
      };
    }
    if (kind === "slide_reveal") {
      const p = StudioMath.expoOut(StudioMath.progress(t, 0, dur));
      return {
        opacity: StudioMath.clamp(StudioMath.progress(t, 0, Math.round(dur * 0.55)), 0, 1),
        transform: `translate3d(${StudioMath.lerp(90, 0, p).toFixed(2)}px, 0, 0)`,
      };
    }
    if (kind === "type_fade") {
      const p = StudioMath.power2Out(StudioMath.progress(t, 0, Math.round(dur * 1.15)));
      return { opacity: p, transform: "none" };
    }
    if (kind === "dramatic_rise") {
      const p = StudioMath.power3Out(StudioMath.progress(t, 0, Math.round(dur * 1.15)));
      return {
        opacity: StudioMath.clamp(StudioMath.progress(t, 0, Math.round(dur * 0.6)), 0, 1),
        transform: `translate3d(0, ${StudioMath.lerp(110, 0, p).toFixed(2)}px, 0) scale(${StudioMath.lerp(0.94, 1.0, p).toFixed(4)})`,
      };
    }
    if (kind === "minimal") {
      const p = StudioMath.power2Out(StudioMath.progress(t, 0, Math.round(180 / s)));
      return { opacity: p, transform: "none" };
    }
    return { opacity: 1, transform: "none" };
  }

  /* --------------------------------------------------------------------------
     Atmosfera Viva Determinística (Luz/Spotlight, Grão Vivo, Partículas Parallax)
     -------------------------------------------------------------------------- */
  function resolveAtmosphere(rawAtmo, theme) {
    const norm = String(rawAtmo || "auto").toLowerCase().trim();
    if (
      norm === "warm_paper" ||
      norm === "dramatic_spotlight" ||
      norm === "grace_glow" ||
      norm === "ink_vignette"
    ) {
      return norm;
    }
    if (theme === "carvao") return "dramatic_spotlight";
    if (theme === "azul_marinho") return "ink_vignette";
    return "warm_paper";
  }

  function buildAtmosphereParticles(theme, atmosphere, sceneOrder) {
    const els = getEls();
    if (!els.atmoParticles) return [];

    const isDark = theme === "carvao" || theme === "azul_marinho";
    const seedBase = (Number(sceneOrder) || 1) * 17 + 7;
    const count = 14;
    const particles = [];
    const svgParts = [];

    for (let i = 0; i < count; i++) {
      // Pseudo-aleatório 100% determinístico baseado em índice + order
      const s1 = Math.sin((seedBase + i * 13.7) * 1.91) * 0.5 + 0.5;
      const s2 = Math.cos((seedBase + i * 29.3) * 1.37) * 0.5 + 0.5;
      const s3 = Math.sin((seedBase + i * 7.13) * 2.41) * 0.5 + 0.5;

      const x0 = 60 + s1 * 960;
      const y0 = 180 + s2 * 1520;
      const depth = i % 3 === 0 ? 1.35 : i % 2 === 0 ? 0.9 : 0.55;
      const size = 2.6 + s3 * 6.2;
      const driftX = (s3 - 0.5) * 42 * depth;
      const driftY = -(24 + s1 * 56) * depth;
      const freq = 0.6 + s2 * 1.1;
      const phase = s1 * Math.PI * 2;

      let fill = "#E5A93C";
      let baseOpacity = 0.28;
      if (atmosphere === "grace_glow") {
        fill = i % 3 === 0 ? "#FAF6EE" : "#E5A93C";
        baseOpacity = isDark ? 0.42 : 0.34;
      } else if (atmosphere === "dramatic_spotlight") {
        fill = i % 4 === 0 ? "#9E3B2E" : "#E5A93C";
        baseOpacity = 0.32;
      } else if (atmosphere === "ink_vignette") {
        fill = isDark ? "#E5A93C" : "#1E3A5F";
        baseOpacity = 0.22;
      } else {
        fill = i % 3 === 0 ? "#E5A93C" : isDark ? "#F4EDE1" : "#1E3A5F";
        baseOpacity = isDark ? 0.24 : 0.16;
      }

      const kind = i % 5 === 0 ? "cross" : i % 4 === 0 ? "diamond" : "dot";
      const id = `atmo-p-${i}`;

      if (kind === "cross") {
        const arm = (size * 1.35).toFixed(1);
        svgParts.push(
          `<g id="${id}" opacity="${baseOpacity.toFixed(2)}">` +
            `<line x1="-${arm}" y1="0" x2="${arm}" y2="0" stroke="${fill}" stroke-width="1.6" stroke-linecap="round" />` +
            `<line x1="0" y1="-${arm}" x2="0" y2="${arm}" stroke="${fill}" stroke-width="1.6" stroke-linecap="round" />` +
          `</g>`
        );
      } else if (kind === "diamond") {
        const d = (size * 1.15).toFixed(1);
        svgParts.push(
          `<g id="${id}" opacity="${baseOpacity.toFixed(2)}">` +
            `<polygon points="0,-${d} ${d},0 0,${d} -${d},0" fill="${fill}" />` +
          `</g>`
        );
      } else {
        svgParts.push(
          `<g id="${id}" opacity="${baseOpacity.toFixed(2)}">` +
            `<circle cx="0" cy="0" r="${size.toFixed(1)}" fill="${fill}" />` +
          `</g>`
        );
      }

      particles.push({ id, x0, y0, driftX, driftY, freq, phase, baseOpacity, depth });
    }

    els.atmoParticles.innerHTML = svgParts.join("");
    particles.forEach((p) => {
      p.el = document.getElementById(p.id);
    });
    return particles;
  }

  function updateAtmosphere(t, pGlobal, beatState, intensityRaw) {
    const els = getEls();
    const k =
      intensityRaw !== undefined && intensityRaw !== null
        ? StudioMath.clamp(Number(intensityRaw), 0, 2.0)
        : 1.0;

    // 1. Micro-jitter determinístico do grão cinematográfico (muda suavemente a ~9Hz)
    if (els.atmoGrainSvg) {
      const grainStep = Math.floor(t / 110);
      const gx = Math.sin(grainStep * 12.9898) * 18;
      const gy = Math.cos(grainStep * 78.233) * 18;
      els.atmoGrainSvg.style.transform = `translate3d(${gx.toFixed(1)}px, ${gy.toFixed(1)}px, 0)`;
    }

    // 2. Feixe de luz / spotlight respirando e reagindo aos beats
    const beatPulse = beatState && beatState.hasBeats
      ? Math.sin(StudioMath.clamp(beatState.transitionP, 0, 1) * Math.PI) * 0.22
      : 0;
    const activeEmphasis = beatState && beatState.activeBeat ? beatState.activeBeat.emphasis : "gold";

    if (els.atmoLightBeam) {
      const lx = Math.sin(pGlobal * Math.PI * 1.6) * 58 * k;
      const ly = Math.cos(pGlobal * Math.PI * 1.2) * 44 * k;
      const lScale = 1.0 + Math.sin(pGlobal * Math.PI * 2) * 0.06 + beatPulse * 0.28;
      const baseOp =
        state.activeAtmosphere === "grace_glow"
          ? 0.85
          : state.activeAtmosphere === "dramatic_spotlight"
            ? 0.78
            : state.activeAtmosphere === "ink_vignette"
              ? 0.56
              : 0.62;
      els.atmoLightBeam.style.opacity = String(StudioMath.clamp(baseOp + beatPulse * 0.25, 0.2, 1.0).toFixed(3));
      els.atmoLightBeam.style.transform = `translate3d(${lx.toFixed(1)}px, ${ly.toFixed(1)}px, 0) scale(${lScale.toFixed(4)})`;
    }

    if (els.atmoSecondaryGlow) {
      const sx = Math.cos(pGlobal * Math.PI * 1.3) * -46 * k;
      const sy = Math.sin(pGlobal * Math.PI * 1.8) * 38 * k;
      const emBoost = activeEmphasis === "terracotta" ? 0.62 : activeEmphasis === "gold" ? 0.52 : 0.34;
      els.atmoSecondaryGlow.dataset.emphasis = activeEmphasis;
      els.atmoSecondaryGlow.style.opacity = String((emBoost + beatPulse * 0.3).toFixed(3));
      els.atmoSecondaryGlow.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0)`;
    }

    // 3. Partículas parallax flutuando ao longo de toda a cena
    const list = state.atmosphereParticles || [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p.el) continue;
      const x = p.x0 + p.driftX * pGlobal + Math.sin(pGlobal * Math.PI * 2 * p.freq + p.phase) * 14 * p.depth * k;
      const y = p.y0 + p.driftY * pGlobal + Math.cos(pGlobal * Math.PI * 1.5 * p.freq + p.phase) * 10 * p.depth * k;
      const rot = (pGlobal * 36 * p.depth + p.phase * 15) % 360;
      const breathe = 0.65 + 0.35 * Math.sin(pGlobal * Math.PI * 3 * p.freq + p.phase);
      const op = StudioMath.clamp(p.baseOpacity * breathe * (1 + beatPulse * 0.5), 0.04, 0.72);
      p.el.setAttribute("transform", `translate(${x.toFixed(1)}, ${y.toFixed(1)}) rotate(${rot.toFixed(1)})`);
      p.el.setAttribute("opacity", op.toFixed(3));
    }
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
        const scale = vw / STAGE_W;
        frame.style.position = "fixed";
        frame.style.left = "0px";
        frame.style.top = "0px";
        frame.style.transformOrigin = "top left";
        frame.style.transform = `scale(${scale})`;
        return;
      }
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
     Aplicação de Paleta, Safe-Zones, Tema e Atmosfera
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

  function applyPresetAndTheme(preset, theme, atmosphere) {
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
    els.stage.dataset.atmosphere = atmosphere;

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

    const list = rawWords
      .map((w, idx) => {
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
      })
      .filter((w) => w.text.length > 0);
    return list;
  }

  /* --------------------------------------------------------------------------
     Legenda Editorial Sutil (blocos de 4–6 palavras, y <= 1474)
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
    const maxPerGroup = 5;
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

      // Micro-transição suave ao trocar de grupo de legenda
      const grpAge = Math.max(0, localTimeMs - entry.group.startMs);
      const grpP = StudioMath.power2Out(StudioMath.progress(grpAge, 0, 140));
      entry.el.style.opacity = String(StudioMath.lerp(0.65, 1.0, grpP).toFixed(3));
      entry.el.style.transform = `translate3d(0, ${StudioMath.lerp(6, 0, grpP).toFixed(2)}px, 0)`;

      entry.wordSpans.forEach(({ el, word }) => {
        const isActive = localTimeMs >= word.local_start_ms && localTimeMs <= word.local_end_ms + 45;
        const isPast = localTimeMs > word.local_end_ms + 45;
        el.classList.toggle("is-active", isActive);
        el.classList.toggle("is-past", isPast);
      });
    });

    const introP = StudioMath.power3Out(StudioMath.progress(localTimeMs, 120, 260));
    els.captionPill.style.opacity = String(introP);
    els.captionPill.style.transform = `translateY(${StudioMath.lerp(18, 0, introP).toFixed(2)}px)`;
  }

  /* --------------------------------------------------------------------------
     Transições Táteis & Cinematográficas (13 modos determinísticos)
     -------------------------------------------------------------------------- */
  function buildTransitionLayer(transitionIn, theme, speed) {
    const els = getEls();
    els.transitionLayer.innerHTML = "";
    const kind = String(transitionIn || "cut").toLowerCase().trim();
    const s = StudioMath.clamp(Number(speed) || 1.0, 0.4, 2.5);
    const scaleDur = (ms) => Math.max(80, Math.round(ms / s));

    if (kind === "editorial_wipe") {
      const bg1 = theme === "carvao" ? "#1E3A5F" : "#181A1F";
      const bg2 = "#E5A93C";
      els.transitionLayer.innerHTML = `
        <div class="tr-wipe-band tr-wipe-primary" style="background:${bg1};"></div>
        <div class="tr-wipe-band tr-wipe-accent" style="background:${bg2};"></div>
      `;
      const pEl = els.transitionLayer.querySelector(".tr-wipe-primary");
      const aEl = els.transitionLayer.querySelector(".tr-wipe-accent");
      const dur = scaleDur(460);

      return function seekEditorialWipe(t) {
        if (t >= dur) {
          pEl.style.opacity = "0";
          aEl.style.opacity = "0";
          return { tx: 0, ty: 0, scale: 1, skewX: 0, rot: 0, opacity: 1 };
        }
        const p = StudioMath.expoOut(StudioMath.progress(t, 0, dur));
        const p2 = StudioMath.expoOut(StudioMath.progress(t, Math.round(dur * 0.12), Math.round(dur * 0.88)));
        const fade = 1 - StudioMath.progress(t, Math.round(dur * 0.72), Math.round(dur * 0.28));
        pEl.style.opacity = String(fade.toFixed(3));
        aEl.style.opacity = String(fade.toFixed(3));
        pEl.style.transform = `translate3d(${StudioMath.lerp(-60, 1280, p).toFixed(1)}px, 0, 0) skewX(-10deg)`;
        aEl.style.transform = `translate3d(${StudioMath.lerp(-140, 1280, p2).toFixed(1)}px, 0, 0) skewX(-10deg)`;
        return {
          tx: StudioMath.lerp(-42, 0, p),
          ty: 0,
          scale: StudioMath.lerp(1.03, 1.0, p),
          skewX: 0,
          rot: 0,
          opacity: StudioMath.clamp(StudioMath.progress(t, 0, Math.round(dur * 0.35)), 0, 1),
        };
      };
    }

    if (kind === "cross_motion") {
      const veilColor = theme === "carvao" ? "#0F1115" : "#F4EDE1";
      els.transitionLayer.innerHTML = `<div class="tr-cross-veil" style="background:${veilColor};"></div>`;
      const veil = els.transitionLayer.querySelector(".tr-cross-veil");
      const dur = scaleDur(480);

      return function seekCrossMotion(t) {
        if (t >= dur) {
          veil.style.opacity = "0";
          return { tx: 0, ty: 0, scale: 1, skewX: 0, rot: 0, opacity: 1 };
        }
        const p = StudioMath.power3Out(StudioMath.progress(t, 0, dur));
        veil.style.opacity = String(((1 - p) * 0.72).toFixed(3));
        return {
          tx: 0,
          ty: StudioMath.lerp(52, 0, p),
          scale: StudioMath.lerp(1.045, 1.0, p),
          skewX: 0,
          rot: StudioMath.lerp(-0.6, 0, p),
          opacity: StudioMath.clamp(p * 1.35, 0, 1),
        };
      };
    }

    if (kind === "zoom_through") {
      els.transitionLayer.innerHTML = `<div class="tr-zoom-ring"></div>`;
      const ring = els.transitionLayer.querySelector(".tr-zoom-ring");
      const dur = scaleDur(460);

      return function seekZoomThrough(t) {
        if (t >= dur) {
          ring.style.opacity = "0";
          return { tx: 0, ty: 0, scale: 1, skewX: 0, rot: 0, opacity: 1 };
        }
        const p = StudioMath.expoOut(StudioMath.progress(t, 0, dur));
        ring.style.opacity = String(((1 - p) * 0.65).toFixed(3));
        ring.style.transform = `scale(${StudioMath.lerp(0.65, 2.2, p).toFixed(3)})`;
        return {
          tx: 0,
          ty: 0,
          scale: StudioMath.lerp(1.16, 1.0, p),
          skewX: 0,
          rot: 0,
          opacity: StudioMath.clamp(StudioMath.progress(t, 0, Math.round(dur * 0.45)), 0, 1),
        };
      };
    }

    if (kind === "ink_wash") {
      const inkFill = theme === "carvao" ? "#E5A93C" : "#181A1F";
      els.transitionLayer.innerHTML = `
        <svg class="tr-ink-svg" viewBox="0 0 1080 1920" preserveAspectRatio="none">
          <path class="tr-ink-blob" d="M-40,-40 L1120,-40 L1120,1960 L-40,1960 Z" fill="${inkFill}" opacity="0.88" />
        </svg>
      `;
      const blob = els.transitionLayer.querySelector(".tr-ink-blob");
      const dur = scaleDur(480);

      return function seekInkWash(t) {
        if (t >= dur) {
          blob.style.opacity = "0";
          return { tx: 0, ty: 0, scale: 1, skewX: 0, rot: 0, opacity: 1 };
        }
        const p = StudioMath.expoOut(StudioMath.progress(t, 0, dur));
        blob.style.opacity = String(((1 - p) * 0.85).toFixed(3));
        blob.style.transformOrigin = "540px 960px";
        blob.style.transform = `translate3d(0, ${(-p * 1960).toFixed(1)}px, 0) scaleY(${StudioMath.lerp(1.0, 0.25, p).toFixed(3)})`;
        return {
          tx: 0,
          ty: StudioMath.lerp(36, 0, p),
          scale: StudioMath.lerp(1.03, 1.0, p),
          skewX: 0,
          rot: 0,
          opacity: StudioMath.clamp(p * 1.4, 0, 1),
        };
      };
    }

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
      const dur = scaleDur(380);

      return function seekPaperTear(t) {
        if (t >= dur) {
          topEl.style.opacity = "0";
          botEl.style.opacity = "0";
          return { tx: 0, ty: 0, scale: 1, skewX: 0, rot: 0, opacity: 1 };
        }
        const p = StudioMath.expoOut(StudioMath.progress(t, 0, dur));
        const shift = p * 1120;
        const rot = p * 4.2;
        const opacity = 1 - StudioMath.progress(t, Math.round(dur * 0.63), Math.round(dur * 0.37));
        topEl.style.opacity = String(opacity);
        botEl.style.opacity = String(opacity);
        topEl.style.transform = `translate3d(0, ${(-shift).toFixed(2)}px, 0) rotate(${(-rot).toFixed(2)}deg)`;
        botEl.style.transform = `translate3d(0, ${shift.toFixed(2)}px, 0) rotate(${rot.toFixed(2)}deg)`;
        return { tx: 0, ty: 0, scale: StudioMath.lerp(1.045, 1.0, p), skewX: 0, rot: 0, opacity: 1 };
      };
    }

    if (kind === "whip_pan") {
      els.transitionLayer.innerHTML = `<div class="whip-streak"></div>`;
      const streakEl = els.transitionLayer.querySelector(".whip-streak");
      const dur = scaleDur(260);

      return function seekWhipPan(t) {
        if (t >= dur) {
          streakEl.style.opacity = "0";
          return { tx: 0, ty: 0, scale: 1, skewX: 0, rot: 0, opacity: 1 };
        }
        const p = StudioMath.expoOut(StudioMath.progress(t, 0, dur));
        const tx = StudioMath.lerp(960, 0, p);
        const skewX = StudioMath.lerp(-9, 0, p);
        const streakOpacity = Math.sin(StudioMath.progress(t, 0, dur) * Math.PI) * 0.85;
        streakEl.style.opacity = streakOpacity.toFixed(3);
        streakEl.style.transform = `translate3d(${StudioMath.lerp(520, -680, p).toFixed(1)}px, 0, 0)`;
        return { tx, ty: 0, scale: 1, skewX, rot: 0, opacity: 1 };
      };
    }

    if (kind === "stamp_drop") {
      const dur = scaleDur(320);
      const dropDur = scaleDur(220);
      return function seekStampDrop(t) {
        if (t >= dur) {
          return { tx: 0, ty: 0, scale: 1, skewX: 0, rot: 0, opacity: 1 };
        }
        const p = StudioMath.backOut(StudioMath.progress(t, 0, dropDur), 1.35);
        const scale = StudioMath.lerp(1.14, 1.0, p);
        const ty = StudioMath.lerp(-38, 0, p);
        let shakeX = 0;
        let shakeY = 0;
        const shakeStart = Math.round(dur * 0.31);
        if (t > shakeStart && t < dur) {
          const decay = 1 - (t - shakeStart) / Math.max(1, dur - shakeStart);
          shakeX = Math.sin(t * 0.14) * 6 * decay;
          shakeY = Math.cos(t * 0.19) * 5 * decay;
        }
        return { tx: shakeX, ty: ty + shakeY, scale, skewX: 0, rot: 0, opacity: 1 };
      };
    }

    if (kind === "fade_in") {
      const dur = scaleDur(420);
      return function seekFadeIn(t) {
        const p = StudioMath.power2Out(StudioMath.progress(t, 0, dur));
        return { tx: 0, ty: 0, scale: StudioMath.lerp(1.015, 1.0, p), skewX: 0, rot: 0, opacity: p };
      };
    }

    if (kind === "slide_up") {
      const dur = scaleDur(360);
      return function seekSlideUp(t) {
        const p = StudioMath.expoOut(StudioMath.progress(t, 0, dur));
        const op = StudioMath.clamp(StudioMath.progress(t, 0, Math.round(dur * 0.55)), 0, 1);
        return { tx: 0, ty: StudioMath.lerp(420, 0, p), scale: 1, skewX: 0, rot: 0, opacity: op };
      };
    }

    if (kind === "slide_left") {
      const dur = scaleDur(340);
      return function seekSlideLeft(t) {
        const p = StudioMath.expoOut(StudioMath.progress(t, 0, dur));
        const op = StudioMath.clamp(StudioMath.progress(t, 0, Math.round(dur * 0.55)), 0, 1);
        return { tx: StudioMath.lerp(560, 0, p), ty: 0, scale: 1, skewX: 0, rot: 0, opacity: op };
      };
    }

    if (kind === "zoom_punch") {
      const dur = scaleDur(320);
      return function seekZoomPunch(t) {
        const p = StudioMath.backOut(StudioMath.progress(t, 0, dur), 1.5);
        const op = StudioMath.clamp(StudioMath.progress(t, 0, Math.round(dur * 0.45)), 0, 1);
        return { tx: 0, ty: 0, scale: StudioMath.lerp(0.82, 1.0, p), skewX: 0, rot: StudioMath.lerp(-2.4, 0, p), opacity: op };
      };
    }

    if (kind === "iris_reveal") {
      const fillPrimary = theme === "carvao" ? "#0E1015" : "#1E3A5F";
      const accent = "#E5A93C";
      els.transitionLayer.innerHTML = `
        <div class="iris-curtain-left" style="background:${fillPrimary};border-right:8px solid ${accent};"></div>
        <div class="iris-curtain-right" style="background:${fillPrimary};border-left:8px solid ${accent};"></div>
      `;
      const leftEl = els.transitionLayer.querySelector(".iris-curtain-left");
      const rightEl = els.transitionLayer.querySelector(".iris-curtain-right");
      const dur = scaleDur(440);
      return function seekIrisReveal(t) {
        if (t >= dur) {
          leftEl.style.opacity = "0";
          rightEl.style.opacity = "0";
          return { tx: 0, ty: 0, scale: 1, skewX: 0, rot: 0, opacity: 1 };
        }
        const p = StudioMath.expoOut(StudioMath.progress(t, 0, dur));
        const shift = p * 590;
        const op = 1 - StudioMath.progress(t, Math.round(dur * 0.7), Math.round(dur * 0.3));
        leftEl.style.opacity = String(op);
        rightEl.style.opacity = String(op);
        leftEl.style.transform = `translate3d(${(-shift).toFixed(2)}px, 0, 0)`;
        rightEl.style.transform = `translate3d(${shift.toFixed(2)}px, 0, 0)`;
        return { tx: 0, ty: 0, scale: StudioMath.lerp(1.035, 1.0, p), skewX: 0, rot: 0, opacity: 1 };
      };
    }

    // cut padrão: micro-assentamento editorial sutil
    const cutDur = scaleDur(140);
    return function seekCut(t) {
      const p = StudioMath.power3Out(StudioMath.progress(t, 0, cutDur));
      return { tx: 0, ty: 0, scale: StudioMath.lerp(1.012, 1.0, p), skewX: 0, rot: 0, opacity: 1 };
    };
  }

  /* --------------------------------------------------------------------------
     Movimento de Câmera Contínuo + Reativo aos Beats (Safe-Zone Guaranteed)
     -------------------------------------------------------------------------- */
  function cameraShiftTarget(shiftName, k) {
    const s = String(shiftName || "none").toLowerCase().trim();
    if (s === "push_in") return { tx: 0, ty: -3 * k, scale: 0.022 * k, rot: 0.18 * k };
    if (s === "pull_out") return { tx: 0, ty: 2 * k, scale: -0.014 * k, rot: -0.12 * k };
    if (s === "pan_left") return { tx: -7 * k, ty: 0, scale: 0.01 * k, rot: -0.22 * k };
    if (s === "pan_right") return { tx: 7 * k, ty: 0, scale: 0.01 * k, rot: 0.22 * k };
    if (s === "tilt_drama") return { tx: 3 * k, ty: -4 * k, scale: 0.024 * k, rot: -0.55 * k };
    if (s === "settle") return { tx: 0, ty: 0, scale: 0, rot: 0 };
    return { tx: 0, ty: 0, scale: 0, rot: 0 };
  }

  function evaluateBeatCameraModulation(beatState, k) {
    if (!beatState || !beatState.hasBeats || !beatState.activeBeat || k <= 0.001) {
      return { tx: 0, ty: 0, scale: 0, rot: 0 };
    }
    const prevTgt = beatState.prevBeat
      ? cameraShiftTarget(beatState.prevBeat.camera_shift, k)
      : { tx: 0, ty: 0, scale: 0, rot: 0 };
    const currTgt = cameraShiftTarget(beatState.activeBeat.camera_shift, k);
    const e = StudioMath.power3InOut(StudioMath.progress(beatState.localT, 0, 560));
    return {
      tx: StudioMath.lerp(prevTgt.tx, currTgt.tx, e),
      ty: StudioMath.lerp(prevTgt.ty, currTgt.ty, e),
      scale: StudioMath.lerp(prevTgt.scale, currTgt.scale, e),
      rot: StudioMath.lerp(prevTgt.rot, currTgt.rot, e),
    };
  }

  function evaluateCameraMotion(motion, localTimeMs, durationMs, intensityRaw, beatState) {
    const p = StudioMath.clamp(durationMs > 0 ? localTimeMs / durationMs : 0, 0, 1);
    const kind = String(motion || "subtle_zoom_in").toLowerCase().trim();
    const k =
      intensityRaw !== undefined && intensityRaw !== null
        ? StudioMath.clamp(Number(intensityRaw), 0, 2.0)
        : 1.0;

    if (kind === "none" || kind === "static" || k <= 0.001) {
      return { tx: 0, ty: 0, scale: 1.0, rot: 0 };
    }

    const beatMod = evaluateBeatCameraModulation(beatState, k);
    let base;

    if (kind === "subtle_zoom_out") {
      base = { tx: 0, ty: 0, scale: StudioMath.lerp(1.0 + 0.032 * k, 1.0, p), rot: 0 };
    } else if (kind === "dramatic_zoom_in") {
      base = { tx: 0, ty: 0, scale: StudioMath.lerp(1.0, 1.0 + 0.055 * k, p), rot: Math.sin(p * Math.PI) * 0.35 * k };
    } else if (kind === "cinematic_push") {
      base = {
        tx: Math.sin(p * Math.PI * 1.4) * 4.2 * k,
        ty: Math.cos(p * Math.PI * 1.1) * 3.4 * k,
        scale: StudioMath.lerp(0.992, 1.0 + 0.042 * k, StudioMath.smoothstep(p)),
        rot: Math.sin(p * Math.PI * 1.2) * 0.34 * k,
      };
    } else if (kind === "editorial_glide") {
      base = {
        tx: StudioMath.lerp(-7 * k, 7 * k, StudioMath.smoothstep(p)),
        ty: Math.sin(p * Math.PI * 1.5) * 3.5 * k,
        scale: 1.0 + 0.018 * k + Math.sin(p * Math.PI) * 0.012 * k,
        rot: StudioMath.lerp(-0.35 * k, 0.35 * k, p),
      };
    } else if (kind === "beat_reactive") {
      base = {
        tx: Math.sin(p * Math.PI * 2.0) * 3.2 * k,
        ty: Math.cos(p * Math.PI * 1.5) * 2.6 * k,
        scale: StudioMath.lerp(0.996, 1.0 + 0.024 * k, p),
        rot: Math.sin(p * Math.PI * 1.3) * 0.22 * k,
      };
    } else if (kind === "pan_up") {
      base = { tx: 0, ty: StudioMath.lerp(10 * k, -10 * k, p), scale: 1.0 + 0.02 * k, rot: 0 };
    } else if (kind === "pan_down") {
      base = { tx: 0, ty: StudioMath.lerp(-10 * k, 10 * k, p), scale: 1.0 + 0.02 * k, rot: 0 };
    } else if (kind === "pan_left" || kind === "subtle_pan_left") {
      base = { tx: StudioMath.lerp(10 * k, -10 * k, p), ty: 0, scale: 1.0 + 0.02 * k, rot: 0 };
    } else if (kind === "pan_right" || kind === "subtle_pan_right") {
      base = { tx: StudioMath.lerp(-10 * k, 10 * k, p), ty: 0, scale: 1.0 + 0.02 * k, rot: 0 };
    } else if (kind === "handheld_drift") {
      base = {
        tx: Math.sin(p * Math.PI * 2.4) * 6.5 * k,
        ty: Math.cos(p * Math.PI * 1.9) * 5.5 * k,
        scale: 1.0 + 0.018 * k + Math.sin(p * Math.PI) * 0.01 * k,
        rot: Math.sin(p * Math.PI * 1.6) * 0.45 * k,
      };
    } else if (kind === "tilt_drift") {
      base = {
        tx: StudioMath.lerp(-5 * k, 5 * k, p),
        ty: StudioMath.lerp(4 * k, -4 * k, p),
        scale: 1.0 + 0.024 * k,
        rot: StudioMath.lerp(-0.75 * k, 0.75 * k, p),
      };
    } else {
      // subtle_zoom_in padrão Vox documental
      base = {
        tx: Math.sin(p * Math.PI * 1.5) * 2.2 * k,
        ty: Math.cos(p * Math.PI) * 1.9 * k,
        scale: StudioMath.lerp(1.0, 1.0 + 0.028 * k, p),
        rot: Math.sin(p * Math.PI) * 0.16 * k,
      };
    }

    // Limita deslocamento composto para garantir matematicamente 100% dentro das safe-zones 9:16
    return {
      tx: StudioMath.clamp(base.tx + beatMod.tx, -5, 5),
      ty: StudioMath.clamp(base.ty + beatMod.ty, -5, 5),
      scale: StudioMath.clamp(base.scale + beatMod.scale, 0.985, 1.022),
      rot: StudioMath.clamp(base.rot + beatMod.rot, -0.45, 0.45),
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
    pickSceneAsset,
    resolveImageLayout,
    evaluateImageTransform,
    resolveSceneBeats,
    evaluateBeats,
    assertNoPlaceholder,
    isForbiddenSeal,

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

      // Guardrail Fail-Fast: bloqueia placeholders editoriais antes de montar o DOM
      assertNoPlaceholder(payload);

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
      const atmosphere = resolveAtmosphere(visual.atmosphere, theme);
      applyPresetAndTheme(preset, theme, atmosphere);

      state.payload = payload;
      state.preset = preset;
      state.scene = scene;
      state.durationMs = durationMs;
      state.sceneStartMs = resolvedStart;
      state.assetUrls = payload.asset_urls || {};
      state.scriptureRef = payload.scripture_ref || null;
      state.showSafeZones = Boolean(payload.show_safe_zones);
      state.captionsEnabled = payload.captions_enabled !== false;
      state.activeTheme = theme;
      state.activeAtmosphere = atmosphere;
      state.words = buildLocalWords(payload.words || [], resolvedStart, durationMs);
      state.beats = resolveSceneBeats(visual, state.words, durationMs);
      state.atmosphereParticles = buildAtmosphereParticles(theme, atmosphere, scene.order);

      els.stage.dataset.template = templateName;
      els.safeZonesOverlay.hidden = !state.showSafeZones;

      // Cabeçalho editorial superior (sempre dentro da safe-zone)
      els.chromeSeries.textContent = inferSeriesLabel(payload);
      const orderNum = Number(scene.order);
      els.chromeOrder.textContent =
        Number.isFinite(orderNum) && orderNum > 0
          ? String(orderNum).padStart(2, "0")
          : String(scene.scene_id || "01").toUpperCase();
      els.chromeHandle.textContent = preset.channel_handle || "@pastorandrebezerra";

      // Camada universal de imagem (background / background_blur / cutout_overlay)
      const assetEntry = pickSceneAsset(scene, state.assetUrls);
      const resolvedImageLayout = resolveImageLayout(visual, templateName, assetEntry);
      state.activeAssetEntry = assetEntry;
      state.activeImageLayout = resolvedImageLayout;

      if (els.mediaBg && els.mediaBgImg) {
        const useBg = Boolean(
          assetEntry && (resolvedImageLayout === "background" || resolvedImageLayout === "background_blur")
        );
        els.mediaBg.hidden = !useBg;
        els.mediaBg.classList.toggle("is-blurred", resolvedImageLayout === "background_blur");
        if (useBg) {
          els.mediaBgImg.src = assetEntry.url;
          els.mediaBgImg.style.objectFit = visual.image_fit === "contain" ? "contain" : "cover";
          const rawOp =
            visual.image_opacity !== undefined && visual.image_opacity !== null
              ? StudioMath.clamp(Number(visual.image_opacity), 0.1, 1.0)
              : 1.0;
          const isAutoTypo =
            (!visual.image_layout || visual.image_layout === "auto") &&
            templateName !== "paper_collage" &&
            templateName !== "tier2_video";
          els.mediaBgImg.style.opacity = String(isAutoTypo ? Math.min(rawOp, 0.55) : rawOp);
        } else {
          els.mediaBgImg.removeAttribute("src");
        }
      }

      if (els.mediaCutout && els.mediaCutoutImg) {
        const useCutout = Boolean(assetEntry && resolvedImageLayout === "cutout_overlay");
        els.mediaCutout.hidden = !useCutout;
        if (useCutout) {
          els.mediaCutoutImg.src = assetEntry.url;
          els.mediaCutoutImg.style.opacity = String(
            StudioMath.clamp(Number(visual.image_opacity) || 1.0, 0.1, 1.0)
          );
        } else {
          els.mediaCutoutImg.removeAttribute("src");
        }
      }

      // Montagem do template específico (fallback para paper_collage)
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
        atmosphere,
        words: state.words,
        beats: state.beats,
        motionData: (visual && visual.motion_data && typeof visual.motion_data === "object") ? visual.motion_data : {},
        durationMs: state.durationMs,
        sceneStartMs: state.sceneStartMs,
        assetUrls: state.assetUrls,
        assetEntry,
        imageLayout: resolvedImageLayout,
        scriptureRef: state.scriptureRef,
        Math: StudioMath,
        evaluateBeats: (tNow) => evaluateBeats(state.beats, tNow, state.durationMs),
      });

      setupCaptionBar(
        state.words,
        visual.highlight_word_ids || [],
        templateName,
        state.captionsEnabled
      );

      state.activeTransition = buildTransitionLayer(visual.transition_in, theme, visual.animation_speed);

      updateViewportScale();
      STUDIO.seek(0);

      return waitForImages(els.stage).then(() => {
        STUDIO.seek(state.currentTimeMs);
        return {
          ok: true,
          template: templateName,
          duration_ms: state.durationMs,
          word_count: state.words.length,
          beat_count: state.beats.length,
        };
      });
    },

    seek(localTimeMs) {
      const els = getEls();
      const t = StudioMath.clamp(Number(localTimeMs) || 0, 0, Math.max(1, state.durationMs));
      state.currentTimeMs = t;
      const visual = (state.scene && state.scene.visual) || {};
      const animSpeed = StudioMath.clamp(Number(visual.animation_speed) || 1.0, 0.4, 2.5);
      const tEffective = StudioMath.clamp(t * animSpeed, 0, Math.max(1, state.durationMs));

      // Progresso no cabeçalho editorial
      const pGlobal = StudioMath.clamp(t / Math.max(1, state.durationMs), 0, 1);
      els.chromeProgress.style.transform = `scaleX(${pGlobal.toFixed(4)})`;

      // Avaliação de beats no tempo real t (sincronizado com áudio/word_id)
      const beatState = evaluateBeats(state.beats, t, state.durationMs);

      // Atmosfera viva (grão, luz, partículas parallax)
      updateAtmosphere(t, pGlobal, beatState, visual.motion_intensity);

      // Transição + câmera composta (reativa a beats)
      const tr = state.activeTransition
        ? state.activeTransition(t)
        : { tx: 0, ty: 0, scale: 1, skewX: 0, rot: 0, opacity: 1 };
      const cam = evaluateCameraMotion(
        visual.camera_motion,
        t,
        state.durationMs,
        visual.motion_intensity,
        beatState
      );

      const tx = cam.tx + tr.tx;
      const ty = cam.ty + tr.ty;
      const sc = cam.scale * tr.scale;
      const rot = cam.rot + tr.rot;
      const skewX = tr.skewX || 0;
      const rigOp = tr.opacity !== undefined ? tr.opacity : 1;

      els.cameraRig.style.opacity = String(StudioMath.clamp(rigOp, 0, 1));
      els.cameraRig.style.transform =
        `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${sc.toFixed(4)}) rotate(${rot.toFixed(3)}deg) skewX(${skewX.toFixed(2)}deg)`;

      // Estilo de entrada dos elementos da cena
      const elemAnim = evaluateElementEntrance(visual.element_animation, t, animSpeed);
      els.sceneRoot.style.opacity = String(elemAnim.opacity);
      els.sceneRoot.style.transform = elemAnim.transform;

      // Animação determinística da camada universal de imagem (background / cutout_overlay)
      if (state.activeAssetEntry) {
        const imgTf = evaluateImageTransform(visual, pGlobal, t, state.durationMs);
        if (
          els.mediaBg &&
          !els.mediaBg.hidden &&
          els.mediaBgImg &&
          (state.activeImageLayout === "background" || state.activeImageLayout === "background_blur")
        ) {
          els.mediaBgImg.style.transform = imgTf.css;
        }
        if (
          els.mediaCutout &&
          !els.mediaCutout.hidden &&
          els.mediaCutoutImg &&
          state.activeImageLayout === "cutout_overlay"
        ) {
          const cutIntro = StudioMath.backOut(StudioMath.progress(t, 80, Math.round(420 / animSpeed)), 1.4);
          const cutOp =
            StudioMath.clamp(StudioMath.progress(t, 60, 180), 0, 1) *
            StudioMath.clamp(Number(visual.image_opacity) || 1.0, 0.1, 1.0);
          els.mediaCutoutImg.style.opacity = String(cutOp.toFixed(3));
          els.mediaCutoutImg.style.transform = `translate3d(0, ${StudioMath.lerp(48, 0, cutIntro).toFixed(2)}px, 0) ${imgTf.css}`;
        }
      }

      // Delegação determinística ao template ativo (passa tEffective, pGlobal, beatState, tReal)
      if (state.activeTemplate && typeof state.activeTemplate.seek === "function") {
        state.activeTemplate.seek(tEffective, pGlobal, beatState, t);
      }

      // Atualização determinística da legenda editorial (usa t real para sincronia perfeita com áudio!)
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
        beat_count: state.beats.length,
        atmosphere: state.activeAtmosphere,
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
      words && words.length > 0 ? words.map((w) => w.text).join(" ") : originalTerm;

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

        if (mediaImg) {
          const imgTf = evaluateImageTransform(visual, pGlobal, t, durationMs);
          mediaImg.style.objectFit = visual.image_fit === "contain" ? "contain" : "cover";
          mediaImg.style.opacity = String(StudioMath.clamp(Number(visual.image_opacity) || 1.0, 0.1, 1.0));
          mediaImg.style.transform = imgTf.css;
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
          const comp = item.scene && item.scene.visual && item.scene.visual.composition;
          btn.textContent = `${idx + 1}. ${comp ? comp : item.scene.template}`;
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
      const replyOrigin = event.origin && event.origin !== "null" ? event.origin : "*";

      if (data.type === "STUDIO_PING") {
        if (replyTarget && typeof replyTarget.postMessage === "function") {
          replyTarget.postMessage({ type: "STUDIO_READY", state: STUDIO.getState() }, replyOrigin);
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
      window.parent.postMessage({ type: "STUDIO_READY", state: STUDIO.getState() }, "*");
    }
  });
})();
