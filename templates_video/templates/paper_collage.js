/* ============================================================================
   Template 1: paper_collage (Estilo Editorial Vox Bíblico — Evolução Multi-Beat)
   - Moldura de papel rasgado SVG + sombra realista + fita crepe translúcida
   - Suporta imagem recortada via asset_urls OU ilustração SVG documental rica
   - Novas ilustrações narrativas (ex: iron_grip / prisão / crueldade) além das 4 originais
   - Suporte completo a beats[] para cenas longas (4–8s) com movimento contínuo
   - 100% retrocompatível com piloto-makarios
   ============================================================================ */

(function () {
  "use strict";

  function pickAssetEntry(scene, assetUrls) {
    if (!assetUrls || typeof assetUrls !== "object") return null;
    const assets = Array.isArray(scene.assets) ? scene.assets : [];
    for (let i = 0; i < assets.length; i++) {
      const id = assets[i] && assets[i].asset_id;
      if (id && assetUrls[id]) {
        return { url: assetUrls[id], isCutout: Boolean(assets[i].apply_rembg) };
      }
    }
    const keys = Object.keys(assetUrls);
    return keys.length ? { url: assetUrls[keys[0]], isCutout: false } : null;
  }

  function pickIllustrationVariant(scene, visual) {
    const explicit = String((visual && visual.illustration_variant) || "auto").toLowerCase().trim();
    if (
      explicit === "greek_papyrus" ||
      explicit === "compass_map" ||
      explicit === "editorial_loupe" ||
      explicit === "ancient_arch"
    ) {
      return explicit;
    }
    const bag = [
      visual.headline || "",
      visual.subtext || "",
      visual.original_term || "",
      scene.scene_id || "",
      ...(Array.isArray(scene.assets) ? scene.assets.map((a) => `${a.asset_id || ""} ${a.prompt || ""}`) : []),
    ]
      .join(" ")
      .toLowerCase();

    if (/pris[aã]o|prender|pesco[cç]o|agarrou|cruel|grade|corrente|cobran[cç]a/.test(bag)) {
      return "prison_bars";
    }
    if (/mapa|rota|viagem|bussola|bússola|cidade|galileia|jerusal|cafarnaum|geograf/.test(bag)) {
      return "compass_map";
    }
    if (/mito|erro|falso|carimbo|contraste|duvida|dúvida|traduc|lupa/.test(bag)) {
      return "editorial_loupe";
    }
    if (/reino|coroa|coluna|templo|alianca|aliança|cruz|historia|história/.test(bag)) {
      return "ancient_arch";
    }
    return "greek_papyrus";
  }

  function fitSvgTypography(text, maxWidthPx, maxSize, minSize, maxTracking) {
    const str = String(text || "").trim();
    const len = Math.max(1, str.length);
    const tracking = len <= 10 ? maxTracking : len <= 16 ? Math.min(2, maxTracking) : 1;
    const rawSize = (maxWidthPx - len * tracking) / (len * 0.70);
    const fontSize = Math.max(minSize, Math.min(maxSize, Math.floor(rawSize)));
    const needsCompress = len * (fontSize * 0.70 + tracking) > maxWidthPx;
    return {
      fontSize,
      tracking,
      textLengthAttr: needsCompress ? ` textLength="${Math.floor(maxWidthPx)}" lengthAdjust="spacingAndGlyphs"` : "",
    };
  }

  function buildFallbackSvg(variant, headline, subtext, originalTerm, M) {
    const rawWord = String(headline || "ΜΑΚΑΡΙΟΣ").trim();
    const rawGreek = String(originalTerm || headline || "ΜΑΚΑΡΙΟΣ").trim().toUpperCase();
    const rawSub = String(subtext || "MANUSCRITO · KOINE").trim();

    const cleanWord = M.escapeHtml(rawWord);
    const cleanGreek = M.escapeHtml(rawGreek);
    const cleanSub = M.escapeHtml(rawSub);

    const papyrusFit = fitSvgTypography(rawGreek, 412, 48, 22, 4);
    const archFit = fitSvgTypography(rawWord, 384, 28, 18, 1.5);
    const loupeFit = fitSvgTypography(rawWord, 332, 28, 17, 1);
    const subFit = fitSvgTypography(rawSub, 360, 19, 13, 2);

    if (variant === "prison_bars") {
      const barFit = fitSvgTypography(rawGreek, 420, 34, 18, 2);
      return `
        <svg class="pc-svg-art" viewBox="0 0 720 490" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="pcPrisonBg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#22252E"/>
              <stop offset="55%" stop-color="#181A1F"/>
              <stop offset="100%" stop-color="#2B1917"/>
            </linearGradient>
          </defs>
          <rect width="720" height="490" fill="url(#pcPrisonBg)"/>
          <!-- Feixe diagonal dramático de cela -->
          <polygon class="pc-prison-beam" points="140,0 440,0 590,490 220,490" fill="#E5A93C" opacity="0.11"/>
          <!-- Elos pesados de cobrança no fundo -->
          <g stroke="#9E3B2E" stroke-opacity="0.45" stroke-width="8" fill="none">
            <rect x="64" y="340" width="90" height="42" rx="21" transform="rotate(-14 109 361)"/>
            <rect x="136" y="352" width="90" height="42" rx="21" transform="rotate(-14 181 373)"/>
            <rect x="520" y="96" width="90" height="42" rx="21" transform="rotate(16 565 117)"/>
          </g>
          <!-- Grades verticais que descem ao vivo via stroke-dashoffset -->
          <g class="pc-prison-bars" stroke="#E5D6BE" stroke-width="14" stroke-linecap="round">
            <path class="pc-draw-path" data-len="490" d="M 140,0 L 140,490" stroke-opacity="0.72"/>
            <path class="pc-draw-path" data-len="490" d="M 250,0 L 250,490" stroke-opacity="0.82"/>
            <path class="pc-draw-path" data-len="490" d="M 360,0 L 360,490" stroke-opacity="0.86"/>
            <path class="pc-draw-path" data-len="490" d="M 470,0 L 470,490" stroke-opacity="0.82"/>
            <path class="pc-draw-path" data-len="490" d="M 580,0 L 580,490" stroke-opacity="0.72"/>
          </g>
          <!-- Barra transversal de ferro -->
          <rect x="0" y="182" width="720" height="22" fill="#181A1F" stroke="#9E3B2E" stroke-width="3"/>
          <!-- Faixa dramática central -->
          <rect class="pc-svg-hl" x="108" y="206" width="504" height="84" rx="6" fill="#9E3B2E" opacity="0.96"/>
          <text x="360" y="248" text-anchor="middle" dominant-baseline="central" font-family="Georgia, serif" font-size="${barFit.fontSize}" font-weight="800" fill="#FAF6EE" letter-spacing="${barFit.tracking}"${barFit.textLengthAttr}>${cleanGreek}</text>
          <rect x="196" y="318" width="328" height="42" rx="6" fill="#181A1F" fill-opacity="0.92" stroke="#E5A93C" stroke-width="1.5"/>
          <text x="360" y="340" text-anchor="middle" dominant-baseline="central" font-family="Consolas, monospace" font-size="${subFit.fontSize}" font-weight="700" fill="#E5A93C" letter-spacing="${subFit.tracking}"${subFit.textLengthAttr}>${cleanSub}</text>
        </svg>`;
    }

    if (variant === "compass_map") {
      return `
        <svg class="pc-svg-art" viewBox="0 0 720 490" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="pcMapBg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#EFE4CE"/>
              <stop offset="100%" stop-color="#D8C3A0"/>
            </linearGradient>
          </defs>
          <rect width="720" height="490" fill="url(#pcMapBg)"/>
          <g stroke="#1E3A5F" stroke-opacity="0.16" stroke-width="1.2">
            <line x1="0" y1="98" x2="720" y2="98"/>
            <line x1="0" y1="196" x2="720" y2="196"/>
            <line x1="0" y1="294" x2="720" y2="294"/>
            <line x1="0" y1="392" x2="720" y2="392"/>
            <line x1="144" y1="0" x2="144" y2="490"/>
            <line x1="288" y1="0" x2="288" y2="490"/>
            <line x1="432" y1="0" x2="432" y2="490"/>
            <line x1="576" y1="0" x2="576" y2="490"/>
          </g>
          <path d="M-20,380 Q120,310 250,340 T540,260 T750,190 L750,510 L-20,510 Z" fill="#C9B08A" opacity="0.45"/>
          <path class="pc-draw-path" data-len="580" d="M105,365 C195,295 250,245 360,255 C455,264 510,165 605,135" fill="none" stroke="#9E3B2E" stroke-width="6" stroke-linecap="round" stroke-dasharray="14 10"/>
          <circle cx="105" cy="365" r="14" fill="#1E3A5F" stroke="#FAF6EE" stroke-width="4"/>
          <circle cx="360" cy="255" r="11" fill="#E5A93C" stroke="#181A1F" stroke-width="3"/>
          <circle cx="605" cy="135" r="16" fill="#9E3B2E" stroke="#FAF6EE" stroke-width="4"/>
          <g class="pc-compass-spin" transform="translate(565, 355)">
            <circle cx="0" cy="0" r="72" fill="#FAF6EE" fill-opacity="0.72" stroke="#1E3A5F" stroke-width="3"/>
            <circle cx="0" cy="0" r="56" fill="none" stroke="#1E3A5F" stroke-width="1.5" stroke-dasharray="4 4"/>
            <polygon points="0,-54 11,-8 0,-18 -11,-8" fill="#9E3B2E"/>
            <polygon points="0,54 11,8 0,18 -11,8" fill="#1E3A5F"/>
            <polygon points="54,0 8,11 18,0 8,-11" fill="#E5A93C"/>
            <polygon points="-54,0 -8,11 -18,0 -8,-11" fill="#1E3A5F" opacity="0.65"/>
            <circle cx="0" cy="0" r="7" fill="#181A1F"/>
          </g>
          <text x="48" y="68" font-family="Consolas, monospace" font-size="${subFit.fontSize}" font-weight="700" fill="#1E3A5F" letter-spacing="${subFit.tracking}"${subFit.textLengthAttr}>${cleanSub}</text>
        </svg>`;
    }

    if (variant === "editorial_loupe") {
      return `
        <svg class="pc-svg-art" viewBox="0 0 720 490" xmlns="http://www.w3.org/2000/svg">
          <rect width="720" height="490" fill="#EFE4D1"/>
          <g transform="translate(76, 44) rotate(-2)">
            <rect x="0" y="0" width="465" height="395" rx="4" fill="#FAF6EE" stroke="#1E3A5F" stroke-opacity="0.22" stroke-width="2"/>
            <rect x="34" y="34" width="160" height="16" rx="2" fill="#1E3A5F" opacity="0.82"/>
            <rect x="34" y="76" width="390" height="12" rx="2" fill="#181A1F" opacity="0.18"/>
            <rect x="34" y="106" width="350" height="12" rx="2" fill="#181A1F" opacity="0.18"/>
            <rect class="pc-svg-hl" x="28" y="146" width="368" height="48" rx="4" fill="#E5A93C" opacity="0.88"/>
            <text x="44" y="170" dominant-baseline="central" font-family="Georgia, serif" font-size="${loupeFit.fontSize}" font-weight="700" fill="#181A1F"${loupeFit.textLengthAttr}>${cleanWord}</text>
            <rect x="34" y="218" width="380" height="12" rx="2" fill="#181A1F" opacity="0.18"/>
            <rect x="34" y="248" width="315" height="12" rx="2" fill="#181A1F" opacity="0.18"/>
            <rect x="34" y="278" width="360" height="12" rx="2" fill="#181A1F" opacity="0.15"/>
            <rect x="34" y="330" width="140" height="28" rx="3" fill="none" stroke="#9E3B2E" stroke-width="3"/>
            <text x="48" y="350" font-family="Consolas, monospace" font-size="15" font-weight="700" fill="#9E3B2E">TEXTO BASE</text>
          </g>
          <g class="pc-loupe-group" transform="translate(490, 248)">
            <line x1="72" y1="72" x2="152" y2="152" stroke="#181A1F" stroke-width="22" stroke-linecap="round"/>
            <line x1="72" y1="72" x2="152" y2="152" stroke="#E5A93C" stroke-width="8" stroke-linecap="round"/>
            <circle cx="0" cy="0" r="102" fill="#FAF6EE" fill-opacity="0.34" stroke="#1E3A5F" stroke-width="14"/>
            <circle cx="0" cy="0" r="88" fill="none" stroke="#E5A93C" stroke-width="3"/>
            <path d="M-56,-46 A72,72 0 0,1 32,-64" fill="none" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round" opacity="0.72"/>
          </g>
        </svg>`;
    }

    if (variant === "ancient_arch") {
      return `
        <svg class="pc-svg-art" viewBox="0 0 720 490" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="pcSky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#1E3A5F"/>
              <stop offset="100%" stop-color="#2D5280"/>
            </linearGradient>
          </defs>
          <rect width="720" height="490" fill="url(#pcSky)"/>
          <circle cx="360" cy="200" r="104" fill="#E5A93C" opacity="0.92"/>
          <circle cx="360" cy="200" r="130" fill="none" stroke="#FAF6EE" stroke-width="2" stroke-dasharray="8 8" opacity="0.55"/>
          <path d="M0,490 L0,115 L155,115 L155,490 Z M565,490 L565,115 L720,115 L720,490 Z" fill="#F4EDE1"/>
          <path d="M135,490 L135,235 A225,225 0 0,1 585,235 L585,490 L525,490 L525,240 A165,165 0 0,0 195,240 L195,490 Z" fill="#E5D6BE" stroke="#181A1F" stroke-width="3"/>
          <path class="pc-draw-path" data-len="460" d="M110,415 L610,415 M360,55 L360,415" stroke="#FAF6EE" stroke-width="2" stroke-dasharray="6 6" opacity="0.75"/>
          <rect x="148" y="336" width="424" height="58" rx="4" fill="#181A1F"/>
          <text x="360" y="365" text-anchor="middle" dominant-baseline="central" font-family="Georgia, serif" font-size="${archFit.fontSize}" font-weight="700" fill="#E5A93C" letter-spacing="${archFit.tracking}"${archFit.textLengthAttr}>${cleanWord}</text>
        </svg>`;
    }

    return `
      <svg class="pc-svg-art" viewBox="0 0 720 490" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="pcPapyrus" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="#F2E4C8"/>
            <stop offset="55%" stop-color="#E3CEAA"/>
            <stop offset="100%" stop-color="#CFAF80"/>
          </linearGradient>
        </defs>
        <rect width="720" height="490" fill="#E9DAC1"/>
        <g stroke="#8A6B3F" stroke-opacity="0.16" stroke-width="1.5">
          <line x1="0" y1="45" x2="720" y2="45"/>
          <line x1="0" y1="95" x2="720" y2="95"/>
          <line x1="0" y1="150" x2="720" y2="150"/>
          <line x1="0" y1="210" x2="720" y2="210"/>
          <line x1="0" y1="275" x2="720" y2="275"/>
          <line x1="0" y1="340" x2="720" y2="340"/>
          <line x1="0" y1="415" x2="720" y2="415"/>
        </g>
        <g transform="translate(70, 56)">
          <rect x="18" y="0" width="544" height="378" rx="6" fill="url(#pcPapyrus)" stroke="#7A5B32" stroke-width="2.5"/>
          <rect x="0" y="-12" width="32" height="402" rx="14" fill="#B6905D" stroke="#5A4120" stroke-width="2.5"/>
          <rect x="548" y="-12" width="32" height="402" rx="14" fill="#B6905D" stroke="#5A4120" stroke-width="2.5"/>
          <text x="64" y="72" font-family="Georgia, serif" font-size="22" fill="#4A3822" opacity="0.48" letter-spacing="4">ΕΝ ΑΡΧΗ · ΚΑΤΑ ΜΑΤΘΑΙΟΝ</text>
          <text x="64" y="114" font-family="Georgia, serif" font-size="22" fill="#4A3822" opacity="0.38" letter-spacing="3">ΟΙ ΠΤΩΧΟΙ ΤΩ ΠΝΕΥΜΑΤΙ</text>
          <rect class="pc-svg-hl" x="56" y="148" width="448" height="84" rx="6" fill="#E5A93C" opacity="0.90"/>
          <text x="280" y="190" text-anchor="middle" dominant-baseline="central" font-family="Georgia, serif" font-size="${papyrusFit.fontSize}" font-weight="700" fill="#181A1F" letter-spacing="${papyrusFit.tracking}"${papyrusFit.textLengthAttr}>${cleanGreek}</text>
          <path class="pc-draw-path" data-len="430" d="M68,248 Q280,262 492,244" fill="none" stroke="#9E3B2E" stroke-width="5" stroke-linecap="round"/>
          <text x="64" y="302" font-family="Consolas, monospace" font-size="${subFit.fontSize}" font-weight="700" fill="#1E3A5F" letter-spacing="${subFit.tracking}"${subFit.textLengthAttr}>${cleanSub}</text>
          <g transform="translate(476, 306)">
            <circle cx="0" cy="0" r="36" fill="#9E3B2E" stroke="#6E241A" stroke-width="3"/>
            <circle cx="0" cy="0" r="24" fill="none" stroke="#F4EDE1" stroke-width="2" stroke-dasharray="4 3"/>
            <text x="0" y="7" text-anchor="middle" font-family="Georgia, serif" font-size="20" font-weight="700" fill="#F4EDE1">V·B</text>
          </g>
        </g>
      </svg>`;
  }

  function buildHeadlineHtml(headline, highlightWordsNorm, M) {
    const tokens = String(headline || "VOX BÍBLICO").trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return "";

    let anyMatched = false;
    const flags = tokens.map((tok) => {
      const norm = M.normalizeToken(tok);
      const hit = highlightWordsNorm.has(norm);
      if (hit) anyMatched = true;
      return hit;
    });

    if (!anyMatched) {
      let bestIdx = tokens.length - 1;
      let bestLen = 0;
      tokens.forEach((tok, i) => {
        const len = M.normalizeToken(tok).length;
        if (len >= bestLen) {
          bestLen = len;
          bestIdx = i;
        }
      });
      flags[bestIdx] = true;
    }

    return tokens
      .map((tok, idx) => {
        if (flags[idx]) {
          return `<span class="hl-word" data-hl="1"><span class="hl-bar"></span>${M.escapeHtml(tok)}</span>`;
        }
        return `<span>${M.escapeHtml(tok)}</span>`;
      })
      .join(" ");
  }

  function fitHeadlineFontSize(text) {
    const len = String(text || "").length;
    if (len <= 12) return 82;
    if (len <= 20) return 68;
    if (len <= 32) return 56;
    return 46;
  }

  window.__STUDIO__.registerTemplate("paper_collage", function createPaperCollage(ctx) {
    const { root, scene, visual, words, beats, durationMs, assetUrls, imageLayout, Math: M } = ctx;

    const baseHeadline = visual.headline || "MAKÁRIOS";
    const baseSubtext = visual.subtext || "Contexto Editorial";
    const assetEntry = ctx.assetEntry || pickAssetEntry(scene, assetUrls);
    const useCardImage = Boolean(assetEntry && (imageLayout === "card" || !imageLayout));
    const variant = pickIllustrationVariant(scene, visual);

    const hlIdSet = new Set(visual.highlight_word_ids || []);
    const hlWordsNorm = new Set();
    let hlTriggerMs = Math.min(720, durationMs * 0.25);

    words.forEach((w) => {
      if (hlIdSet.has(w.word_id)) {
        hlWordsNorm.add(M.normalizeToken(w.text));
        hlTriggerMs = Math.min(hlTriggerMs, w.local_start_ms);
      }
    });
    if (hlIdSet.size > 0) {
      const firstHl = words.find((w) => hlIdSet.has(w.word_id));
      if (firstHl) hlTriggerMs = Math.max(260, firstHl.local_start_ms);
    }

    const spokenPreview = words
      .map((w) => w.text)
      .join(" ")
      .trim();
    const showNote =
      spokenPreview.length > 0 &&
      M.normalizeToken(spokenPreview) !== M.normalizeToken(baseHeadline) &&
      spokenPreview.length <= 105;

    const rawStamp = String(visual.stamp_text || "").trim();
    const isForbidden = window.__STUDIO__ && window.__STUDIO__.isForbiddenSeal(rawStamp);
    const showStamp =
      isForbidden || visual.show_stamp === false
        ? false
        : visual.show_stamp === true ||
          String(visual.transition_in || "").toLowerCase() === "stamp_drop" ||
          Boolean(rawStamp);
    const stampLabel = rawStamp || (/mito/i.test(`${baseHeadline} ${baseSubtext}`) ? "MITO" : "ATENÇÃO");

    const fitStyle = visual.image_fit === "contain" ? "object-fit:contain;" : "object-fit:cover;";
    const opStyle = `opacity:${M.clamp(Number(visual.image_opacity) || 1.0, 0.1, 1.0)};`;
    const mediaHtml = useCardImage
      ? `<img class="pc-cutout-img${assetEntry.isCutout ? " is-cutout" : ""}" style="${fitStyle}${opStyle}" src="${M.escapeHtml(assetEntry.url)}" alt="${M.escapeHtml(baseHeadline)}" />`
      : buildFallbackSvg(variant, baseHeadline, baseSubtext, visual.original_term, M);

    root.innerHTML = `
      <div class="pc-scene">
        <div class="pc-collage-area">
          <div class="pc-back-sheet"></div>
          <div class="pc-paper-shadow">
            <div class="vox-tape pc-tape-tl"></div>
            <div class="vox-tape pc-tape-br"></div>
            <div class="pc-paper-outer">
              <div class="pc-paper-inner">
                ${mediaHtml}
                <div class="pc-caption-sticker">${M.escapeHtml(baseSubtext)}</div>
              </div>
            </div>
          </div>
          ${showStamp ? `<div class="vox-stamp pc-stamp" style="top:34px;right:24px;">${M.escapeHtml(stampLabel)}</div>` : ""}
        </div>

        <svg class="pc-arrow-svg" viewBox="0 0 150 120" fill="none" aria-hidden="true">
          <path class="pc-arrow-path" d="M126,12 C118,56 84,88 26,96" stroke="#E5A93C" stroke-width="6" stroke-linecap="round" />
          <path class="pc-arrow-head" d="M44,80 L22,97 L46,108" stroke="#E5A93C" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>

        <div class="pc-text-block">
          <div class="pc-subtext-row">
            <div class="pc-subtext-badge">
              <span class="pc-subtext-span">${M.escapeHtml(baseSubtext)}</span>
            </div>
            <div class="pc-subtext-rule"></div>
          </div>

          <div class="pc-headline-mask">
            <h1 class="pc-headline" style="font-size:${fitHeadlineFontSize(baseHeadline)}px;">
              ${buildHeadlineHtml(baseHeadline, hlWordsNorm, M)}
            </h1>
          </div>

          ${showNote ? `<p class="pc-editorial-note">${M.escapeHtml(spokenPreview)}</p>` : ""}
        </div>
      </div>
    `;

    const backSheet = root.querySelector(".pc-back-sheet");
    const paperShadow = root.querySelector(".pc-paper-shadow");
    const cutoutImg = root.querySelector(".pc-cutout-img");
    const tapeTl = root.querySelector(".pc-tape-tl");
    const tapeBr = root.querySelector(".pc-tape-br");
    const sticker = root.querySelector(".pc-caption-sticker");
    const subBadge = root.querySelector(".pc-subtext-badge");
    const subSpan = root.querySelector(".pc-subtext-span");
    const subRule = root.querySelector(".pc-subtext-rule");
    const headlineEl = root.querySelector(".pc-headline");
    const noteEl = root.querySelector(".pc-editorial-note");
    const stampEl = root.querySelector(".pc-stamp");
    const arrowPath = root.querySelector(".pc-arrow-path");
    const arrowHead = root.querySelector(".pc-arrow-head");
    const svgDrawPaths = Array.from(root.querySelectorAll(".pc-draw-path"));
    const svgHlRect = root.querySelector(".pc-svg-hl");
    const svgLoupe = root.querySelector(".pc-loupe-group");
    const svgCompass = root.querySelector(".pc-compass-spin");
    const prisonBeam = root.querySelector(".pc-prison-beam");

    const arrowLen = 165;
    arrowPath.style.strokeDasharray = String(arrowLen);
    arrowHead.style.strokeDasharray = "70";

    svgDrawPaths.forEach((p) => {
      const len = Number(p.dataset.len) || 480;
      p.style.strokeDasharray = String(len);
    });

    const stampTriggerMs =
      beats && beats.length >= 2 ? beats[beats.length - 1].startMs : 360;

    return {
      seek(t, pGlobal, beatState, tReal) {
        const tm = Number.isFinite(tReal) ? tReal : t;

        // Evolução multi-beat do headline e subtext em cenas longas (4–8s)
        const activeHead = (beatState && beatState.activeBeat && beatState.activeBeat.headline) || baseHeadline;
        const activeSub = (beatState && beatState.activeBeat && beatState.activeBeat.subtext) || baseSubtext;
        if (headlineEl.dataset.lastHead !== activeHead) {
          headlineEl.innerHTML = buildHeadlineHtml(activeHead, hlWordsNorm, M);
          headlineEl.style.fontSize = `${fitHeadlineFontSize(activeHead)}px`;
          headlineEl.dataset.lastHead = activeHead;
        }
        if (subSpan && subSpan.textContent !== activeSub) {
          subSpan.textContent = activeSub;
          if (sticker) sticker.textContent = activeSub;
        }

        const hlWords = Array.from(headlineEl.querySelectorAll(".hl-word"));

        // 1. Folha de fundo com respiração contínua ao longo de toda a cena
        const backP = M.backOut(M.progress(t, 40, 420), 1.25);
        const backRot = M.lerp(-6.5, -2.6, backP) + Math.sin(pGlobal * Math.PI * 2.0) * 0.7;
        backSheet.style.opacity = String(M.clamp(M.progress(t, 30, 220), 0, 1));
        backSheet.style.transform =
          `translate3d(${(M.lerp(-42, -10, backP) + Math.cos(pGlobal * Math.PI * 1.6) * 4).toFixed(2)}px, ${M.lerp(48, 12, backP).toFixed(2)}px, 0) rotate(${backRot.toFixed(2)}deg)`;

        // 2. Moldura principal de papel rasgado com flutuação viva
        const cardP = M.backOut(M.progress(t, 90, 460), 1.45);
        const cardY = M.lerp(76, 0, cardP) + Math.sin(pGlobal * Math.PI * 2.2) * 5;
        const beatBump = beatState && beatState.hasBeats
          ? Math.sin(M.clamp(beatState.transitionP, 0, 1) * Math.PI) * 0.018
          : 0;
        const cardScale = M.lerp(0.88, 1.0, cardP) + beatBump;
        const cardRot = M.lerp(3.2, 0.8, cardP) + Math.sin(pGlobal * Math.PI * 1.6) * 0.55;
        paperShadow.style.opacity = String(M.clamp(M.progress(t, 80, 200), 0, 1));
        paperShadow.style.transform =
          `translate3d(0, ${cardY.toFixed(2)}px, 0) scale(${cardScale.toFixed(4)}) rotate(${cardRot.toFixed(2)}deg)`;

        if (cutoutImg && window.__STUDIO__ && typeof window.__STUDIO__.evaluateImageTransform === "function") {
          const imgTf = window.__STUDIO__.evaluateImageTransform(visual, pGlobal, tm, durationMs);
          cutoutImg.style.transform = imgTf.css;
        } else if (cutoutImg) {
          const imgScale = M.lerp(1.0, 1.08, pGlobal);
          cutoutImg.style.transform = `scale(${imgScale.toFixed(4)})`;
        }

        // 3. Fitas crepe
        const tape1P = M.expoOut(M.progress(t, 280, 240));
        const tape2P = M.expoOut(M.progress(t, 360, 240));
        tapeTl.style.opacity = String(tape1P);
        tapeTl.style.transform = `translate3d(0, ${M.lerp(-18, 0, tape1P).toFixed(1)}px, 0) rotate(-22deg) scale(${M.lerp(1.12, 1, tape1P).toFixed(3)})`;
        tapeBr.style.opacity = String(tape2P);
        tapeBr.style.transform = `translate3d(0, ${M.lerp(18, 0, tape2P).toFixed(1)}px, 0) rotate(-16deg) scale(${M.lerp(1.12, 1, tape2P).toFixed(3)})`;

        const stickP = M.power3Out(M.progress(t, 320, 260));
        sticker.style.opacity = String(stickP);
        sticker.style.transform = `translate3d(${M.lerp(-24, 0, stickP).toFixed(1)}px, 0, 0)`;

        // 4. Animações internas do SVG documental (escalonadas para vida contínua)
        svgDrawPaths.forEach((pathEl, idx) => {
          const len = Number(pathEl.dataset.len) || 480;
          const drawP = M.expoOut(M.progress(tm, 320 + idx * 140, 820));
          pathEl.style.strokeDashoffset = String((len * (1 - drawP)).toFixed(2));
        });
        if (svgHlRect) {
          const svgHlP = M.expoOut(M.progress(tm, 360, 560));
          svgHlRect.style.transformOrigin = "56px 190px";
          svgHlRect.style.transform = `scaleX(${svgHlP.toFixed(4)})`;
        }
        if (svgLoupe) {
          const lx = 490 + Math.sin(pGlobal * Math.PI * 2.2) * 18;
          const ly = 248 + Math.cos(pGlobal * Math.PI * 1.6) * 14;
          svgLoupe.setAttribute("transform", `translate(${lx.toFixed(1)}, ${ly.toFixed(1)})`);
        }
        if (svgCompass) {
          svgCompass.setAttribute("transform", `translate(565, 355) rotate(${(pGlobal * 32).toFixed(1)})`);
        }
        if (prisonBeam) {
          prisonBeam.setAttribute("opacity", String((0.08 + Math.sin(pGlobal * Math.PI * 2) * 0.06).toFixed(3)));
        }

        // 5. Subtext badge + régua
        const subP = M.power3Out(M.progress(t, 240, 320));
        subBadge.style.opacity = String(subP);
        subBadge.style.transform = `translate3d(${M.lerp(-28, 0, subP).toFixed(2)}px, 0, 0)`;
        subRule.style.transform = `scaleX(${M.expoOut(M.progress(t, 340, 480)).toFixed(4)})`;

        // 6. Headline Serif (pulsa suavemente nas viradas de beat)
        const headP = M.backOut(M.progress(t, 280, 420), 1.15);
        const beatEnter = beatState && beatState.hasBeats && beatState.activeIndex > 0
          ? M.power3Out(M.progress(beatState.localT, 0, 340))
          : 1;
        headlineEl.style.opacity = String((M.clamp(M.progress(t, 260, 180), 0, 1) * M.lerp(0.35, 1.0, beatEnter)).toFixed(3));
        headlineEl.style.transform = `translate3d(0, ${(M.lerp(42, 0, headP) + M.lerp(14, 0, beatEnter)).toFixed(2)}px, 0)`;

        // 7. Marcador-texto dourado #E5A93C animado esquerda -> direita
        const hlStartBase =
          beatState && beatState.hasBeats && beatState.activeIndex > 0
            ? beatState.activeBeat.startMs + 80
            : hlTriggerMs;
        hlWords.forEach((wordEl, idx) => {
          const bar = wordEl.querySelector(".hl-bar");
          const start = hlStartBase + idx * 140;
          const barP = M.expoOut(M.progress(tm, start, 380));
          bar.style.transform = `scaleX(${barP.toFixed(4)})`;
          wordEl.classList.toggle("is-highlighted", barP > 0.35);
        });

        // 8. Seta SVG
        const arrowP = M.expoOut(M.progress(t, 520, 480));
        arrowPath.style.strokeDashoffset = String((arrowLen * (1 - arrowP)).toFixed(2));
        const headArrowP = M.expoOut(M.progress(t, 860, 200));
        arrowHead.style.strokeDashoffset = String((70 * (1 - headArrowP)).toFixed(2));

        // 9. Nota editorial de apoio
        if (noteEl) {
          const noteP = M.power3Out(M.progress(t, 480, 360));
          noteEl.style.opacity = String(noteP);
          noteEl.style.transform = `translate3d(0, ${M.lerp(20, 0, noteP).toFixed(2)}px, 0)`;
        }

        // 10. Carimbo terracota (se ativo — dispara no beat final quando multi-beat)
        if (stampEl) {
          const stP = M.backOut(M.progress(tm, stampTriggerMs, 280), 1.65);
          stampEl.style.opacity = String(M.clamp(M.progress(tm, stampTriggerMs, 110), 0, 1));
          stampEl.style.transform =
            `scale(${M.lerp(1.75, 1.0, stP).toFixed(4)}) rotate(${M.lerp(-18, -8, stP).toFixed(2)}deg)`;
        }
      },
    };
  });
})();
