/* ============================================================================
   Template 1: paper_collage (Estilo Editorial Vox Bíblico)
   - Moldura de papel rasgado SVG + sombra realista + fita crepe translúcida
   - Suporta imagem recortada via asset_urls OU ilustração SVG documental rica
   - Headline Serif forte + Subtext Mono + Marcador-texto #E5A93C + Seta SVG
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
    const bag = [
      visual.headline || "",
      visual.subtext || "",
      scene.scene_id || "",
      ...(Array.isArray(scene.assets) ? scene.assets.map((a) => `${a.asset_id || ""} ${a.prompt || ""}`) : []),
    ]
      .join(" ")
      .toLowerCase();

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
    // Estimativa conservadora de largura média de caractere maiúsculo em Georgia Bold (~0.70 em)
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
          <!-- Terreno estilizado -->
          <path d="M-20,380 Q120,310 250,340 T540,260 T750,190 L750,510 L-20,510 Z" fill="#C9B08A" opacity="0.45"/>
          <!-- Rota histórica desenhada -->
          <path class="pc-draw-path" data-len="580" d="M105,365 C195,295 250,245 360,255 C455,264 510,165 605,135" fill="none" stroke="#9E3B2E" stroke-width="6" stroke-linecap="round" stroke-dasharray="14 10"/>
          <!-- Pinos de localização -->
          <circle cx="105" cy="365" r="14" fill="#1E3A5F" stroke="#FAF6EE" stroke-width="4"/>
          <circle cx="360" cy="255" r="11" fill="#E5A93C" stroke="#181A1F" stroke-width="3"/>
          <circle cx="605" cy="135" r="16" fill="#9E3B2E" stroke="#FAF6EE" stroke-width="4"/>
          <!-- Bússola editorial -->
          <g transform="translate(565, 355)">
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
          <!-- Folha de arquivo documental -->
          <g transform="translate(76, 44) rotate(-2)">
            <rect x="0" y="0" width="465" height="395" rx="4" fill="#FAF6EE" stroke="#1E3A5F" stroke-opacity="0.22" stroke-width="2"/>
            <rect x="34" y="34" width="160" height="16" rx="2" fill="#1E3A5F" opacity="0.82"/>
            <rect x="34" y="76" width="390" height="12" rx="2" fill="#181A1F" opacity="0.18"/>
            <rect x="34" y="106" width="350" height="12" rx="2" fill="#181A1F" opacity="0.18"/>
            <!-- Marca-texto no documento -->
            <rect class="pc-svg-hl" x="28" y="146" width="368" height="48" rx="4" fill="#E5A93C" opacity="0.88"/>
            <text x="44" y="170" dominant-baseline="central" font-family="Georgia, serif" font-size="${loupeFit.fontSize}" font-weight="700" fill="#181A1F"${loupeFit.textLengthAttr}>${cleanWord}</text>
            <rect x="34" y="218" width="380" height="12" rx="2" fill="#181A1F" opacity="0.18"/>
            <rect x="34" y="248" width="315" height="12" rx="2" fill="#181A1F" opacity="0.18"/>
            <rect x="34" y="278" width="360" height="12" rx="2" fill="#181A1F" opacity="0.15"/>
            <rect x="34" y="330" width="140" height="28" rx="3" fill="none" stroke="#9E3B2E" stroke-width="3"/>
            <text x="48" y="350" font-family="Consolas, monospace" font-size="15" font-weight="700" fill="#9E3B2E">TEXTO BASE</text>
          </g>
          <!-- Lupa Editorial Vox -->
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
          <!-- Sol dourado editorial -->
          <circle cx="360" cy="200" r="104" fill="#E5A93C" opacity="0.92"/>
          <circle cx="360" cy="200" r="130" fill="none" stroke="#FAF6EE" stroke-width="2" stroke-dasharray="8 8" opacity="0.55"/>
          <!-- Arco clássico recortado em pergaminho -->
          <path d="M0,490 L0,115 L155,115 L155,490 Z M565,490 L565,115 L720,115 L720,490 Z" fill="#F4EDE1"/>
          <path d="M135,490 L135,235 A225,225 0 0,1 585,235 L585,490 L525,490 L525,240 A165,165 0 0,0 195,240 L195,490 Z" fill="#E5D6BE" stroke="#181A1F" stroke-width="3"/>
          <!-- Linhas de proporção desenhadas -->
          <path class="pc-draw-path" data-len="460" d="M110,415 L610,415 M360,55 L360,415" stroke="#FAF6EE" stroke-width="2" stroke-dasharray="6 6" opacity="0.75"/>
          <rect x="148" y="336" width="424" height="58" rx="4" fill="#181A1F"/>
          <text x="360" y="365" text-anchor="middle" dominant-baseline="central" font-family="Georgia, serif" font-size="${archFit.fontSize}" font-weight="700" fill="#E5A93C" letter-spacing="${archFit.tracking}"${archFit.textLengthAttr}>${cleanWord}</text>
        </svg>`;
    }

    // Padrão: Pergaminho / Papiro Grego Documental
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
        <!-- Fibras horizontais sutis de papiro -->
        <g stroke="#8A6B3F" stroke-opacity="0.16" stroke-width="1.5">
          <line x1="0" y1="45" x2="720" y2="45"/>
          <line x1="0" y1="95" x2="720" y2="95"/>
          <line x1="0" y1="150" x2="720" y2="150"/>
          <line x1="0" y1="210" x2="720" y2="210"/>
          <line x1="0" y1="275" x2="720" y2="275"/>
          <line x1="0" y1="340" x2="720" y2="340"/>
          <line x1="0" y1="415" x2="720" y2="415"/>
        </g>
        <!-- Rolo de pergaminho central -->
        <g transform="translate(70, 56)">
          <rect x="18" y="0" width="544" height="378" rx="6" fill="url(#pcPapyrus)" stroke="#7A5B32" stroke-width="2.5"/>
          <!-- Cilindros laterais do papiro -->
          <rect x="0" y="-12" width="32" height="402" rx="14" fill="#B6905D" stroke="#5A4120" stroke-width="2.5"/>
          <rect x="548" y="-12" width="32" height="402" rx="14" fill="#B6905D" stroke="#5A4120" stroke-width="2.5"/>
          <!-- Linhas de manuscrito uncial antigo -->
          <text x="64" y="72" font-family="Georgia, serif" font-size="22" fill="#4A3822" opacity="0.48" letter-spacing="4">ΕΝ ΑΡΧΗ · ΚΑΤΑ ΜΑΤΘΑΙΟΝ</text>
          <text x="64" y="114" font-family="Georgia, serif" font-size="22" fill="#4A3822" opacity="0.38" letter-spacing="3">ΟΙ ΠΤΩΧΟΙ ΤΩ ΠΝΕΥΜΑΤΙ</text>
          <!-- Destaque dourado Vox sobre o termo grego / chave (escala dinâmica sem corte) -->
          <rect class="pc-svg-hl" x="56" y="148" width="448" height="84" rx="6" fill="#E5A93C" opacity="0.90"/>
          <text x="280" y="190" text-anchor="middle" dominant-baseline="central" font-family="Georgia, serif" font-size="${papyrusFit.fontSize}" font-weight="700" fill="#181A1F" letter-spacing="${papyrusFit.tracking}"${papyrusFit.textLengthAttr}>${cleanGreek}</text>
          <!-- Traçado editorial sob a palavra -->
          <path class="pc-draw-path" data-len="430" d="M68,248 Q280,262 492,244" fill="none" stroke="#9E3B2E" stroke-width="5" stroke-linecap="round"/>
          <text x="64" y="302" font-family="Consolas, monospace" font-size="${subFit.fontSize}" font-weight="700" fill="#1E3A5F" letter-spacing="${subFit.tracking}"${subFit.textLengthAttr}>${cleanSub}</text>
          <!-- Selo de cera terracota -->
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

    // Se nenhum token coincidiu diretamente com highlight_word_ids, destaca a palavra mais forte
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
    if (len <= 12) return 86;
    if (len <= 20) return 72;
    if (len <= 32) return 60;
    return 50;
  }

  window.__STUDIO__.registerTemplate("paper_collage", function createPaperCollage(ctx) {
    const { root, scene, visual, words, durationMs, assetUrls, Math: M } = ctx;

    const headline = visual.headline || "MAKÁRIOS";
    const subtext = visual.subtext || "Contexto Editorial";
    const assetEntry = pickAssetEntry(scene, assetUrls);
    const variant = pickIllustrationVariant(scene, visual);

    // Mapeia palavras destacadas e seu instante de disparo
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

    // Nota editorial curta (se houver texto falado que complemente o headline)
    const spokenPreview = words
      .map((w) => w.text)
      .join(" ")
      .trim();
    const showNote =
      spokenPreview.length > 0 &&
      M.normalizeToken(spokenPreview) !== M.normalizeToken(headline) &&
      spokenPreview.length <= 92;

    const showStamp =
      String(visual.transition_in || "").toLowerCase() === "stamp_drop" ||
      Boolean(visual.stamp_text);
    const stampLabel = visual.stamp_text || (/mito/i.test(`${headline} ${subtext}`) ? "MITO" : "ATENÇÃO");

    const mediaHtml = assetEntry
      ? `<img class="pc-cutout-img${assetEntry.isCutout ? " is-cutout" : ""}" src="${M.escapeHtml(assetEntry.url)}" alt="${M.escapeHtml(headline)}" />`
      : buildFallbackSvg(variant, headline, subtext, visual.original_term, M);

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
                <div class="pc-caption-sticker">${M.escapeHtml(subtext)}</div>
              </div>
            </div>
          </div>
          ${showStamp ? `<div class="vox-stamp pc-stamp" style="top:34px;right:24px;">${M.escapeHtml(stampLabel)}</div>` : ""}
        </div>

        <!-- Seta SVG editorial desenhada com stroke-dashoffset -->
        <svg class="pc-arrow-svg" viewBox="0 0 150 120" fill="none" aria-hidden="true">
          <path class="pc-arrow-path" d="M126,12 C118,56 84,88 26,96" stroke="#E5A93C" stroke-width="6" stroke-linecap="round" />
          <path class="pc-arrow-head" d="M44,80 L22,97 L46,108" stroke="#E5A93C" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>

        <div class="pc-text-block">
          <div class="pc-subtext-row">
            <div class="pc-subtext-badge">
              <span>${M.escapeHtml(subtext)}</span>
            </div>
            <div class="pc-subtext-rule"></div>
          </div>

          <div class="pc-headline-mask">
            <h1 class="pc-headline" style="font-size:${fitHeadlineFontSize(headline)}px;">
              ${buildHeadlineHtml(headline, hlWordsNorm, M)}
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
    const subRule = root.querySelector(".pc-subtext-rule");
    const headlineEl = root.querySelector(".pc-headline");
    const hlWords = Array.from(root.querySelectorAll(".pc-headline .hl-word"));
    const noteEl = root.querySelector(".pc-editorial-note");
    const stampEl = root.querySelector(".pc-stamp");
    const arrowPath = root.querySelector(".pc-arrow-path");
    const arrowHead = root.querySelector(".pc-arrow-head");
    const svgDrawPaths = Array.from(root.querySelectorAll(".pc-draw-path"));
    const svgHlRect = root.querySelector(".pc-svg-hl");
    const svgLoupe = root.querySelector(".pc-loupe-group");

    const arrowLen = 165;
    arrowPath.style.strokeDasharray = String(arrowLen);
    arrowHead.style.strokeDasharray = "70";

    svgDrawPaths.forEach((p) => {
      const len = Number(p.dataset.len) || 480;
      p.style.strokeDasharray = String(len);
    });

    return {
      seek(t, pGlobal) {
        // 1. Folha de fundo desliza com atraso sutil e micro-oscilação
        const backP = M.backOut(M.progress(t, 40, 420), 1.25);
        const backRot = M.lerp(-6.5, -2.6, backP) + Math.sin(pGlobal * Math.PI) * 0.4;
        backSheet.style.opacity = String(M.clamp(M.progress(t, 30, 220), 0, 1));
        backSheet.style.transform =
          `translate3d(${M.lerp(-42, -10, backP).toFixed(2)}px, ${M.lerp(48, 12, backP).toFixed(2)}px, 0) rotate(${backRot.toFixed(2)}deg)`;

        // 2. Moldura principal de papel rasgado entra com overshoot suave (back.out)
        const cardP = M.backOut(M.progress(t, 90, 460), 1.45);
        const cardY = M.lerp(76, 0, cardP);
        const cardScale = M.lerp(0.88, 1.0, cardP);
        const cardRot = M.lerp(3.2, 0.8, cardP) + Math.sin(pGlobal * Math.PI * 1.4) * 0.35;
        paperShadow.style.opacity = String(M.clamp(M.progress(t, 80, 200), 0, 1));
        paperShadow.style.transform =
          `translate3d(0, ${cardY.toFixed(2)}px, 0) scale(${cardScale.toFixed(4)}) rotate(${cardRot.toFixed(2)}deg)`;

        // Micro-zoom interno na imagem se houver cutout
        if (cutoutImg) {
          const imgScale = M.lerp(1.0, 1.07, pGlobal);
          cutoutImg.style.transform = `scale(${imgScale.toFixed(4)})`;
        }

        // 3. Fitas crepe colam logo após o papel pousar
        const tape1P = M.expoOut(M.progress(t, 280, 240));
        const tape2P = M.expoOut(M.progress(t, 360, 240));
        tapeTl.style.opacity = String(tape1P);
        tapeTl.style.transform = `translate3d(0, ${M.lerp(-18, 0, tape1P).toFixed(1)}px, 0) rotate(-22deg) scale(${M.lerp(1.12, 1, tape1P).toFixed(3)})`;
        tapeBr.style.opacity = String(tape2P);
        tapeBr.style.transform = `translate3d(0, ${M.lerp(18, 0, tape2P).toFixed(1)}px, 0) rotate(-16deg) scale(${M.lerp(1.12, 1, tape2P).toFixed(3)})`;

        // Etiqueta interna no recorte
        const stickP = M.power3Out(M.progress(t, 320, 260));
        sticker.style.opacity = String(stickP);
        sticker.style.transform = `translate3d(${M.lerp(-24, 0, stickP).toFixed(1)}px, 0, 0)`;

        // 4. Animações internas do SVG documental (traçado + marca-texto + lupa)
        svgDrawPaths.forEach((pathEl) => {
          const len = Number(pathEl.dataset.len) || 480;
          const drawP = M.expoOut(M.progress(t, 420, 760));
          pathEl.style.strokeDashoffset = String((len * (1 - drawP)).toFixed(2));
        });
        if (svgHlRect) {
          const svgHlP = M.expoOut(M.progress(t, 360, 520));
          svgHlRect.style.transformOrigin = "56px 190px";
          svgHlRect.style.transform = `scaleX(${svgHlP.toFixed(4)})`;
        }
        if (svgLoupe) {
          const lx = 490 + Math.sin(pGlobal * Math.PI * 1.3) * 14;
          const ly = 248 + Math.cos(pGlobal * Math.PI) * 10;
          svgLoupe.setAttribute("transform", `translate(${lx.toFixed(1)}, ${ly.toFixed(1)})`);
        }

        // 5. Subtext badge + régua editorial
        const subP = M.power3Out(M.progress(t, 240, 320));
        subBadge.style.opacity = String(subP);
        subBadge.style.transform = `translate3d(${M.lerp(-28, 0, subP).toFixed(2)}px, 0, 0)`;
        subRule.style.transform = `scaleX(${M.expoOut(M.progress(t, 340, 420)).toFixed(4)})`;

        // 6. Headline Serif com overshoot suave
        const headP = M.backOut(M.progress(t, 280, 420), 1.15);
        headlineEl.style.opacity = String(M.clamp(M.progress(t, 260, 180), 0, 1));
        headlineEl.style.transform = `translate3d(0, ${M.lerp(42, 0, headP).toFixed(2)}px, 0)`;

        // 7. Marcador-texto dourado #E5A93C animado esquerda -> direita
        hlWords.forEach((wordEl, idx) => {
          const bar = wordEl.querySelector(".hl-bar");
          const start = hlTriggerMs + idx * 140;
          const barP = M.expoOut(M.progress(t, start, 380));
          bar.style.transform = `scaleX(${barP.toFixed(4)})`;
          wordEl.classList.toggle("is-highlighted", barP > 0.35);
        });

        // 8. Seta SVG ligando o recorte ao headline
        const arrowP = M.expoOut(M.progress(t, 520, 440));
        arrowPath.style.strokeDashoffset = String((arrowLen * (1 - arrowP)).toFixed(2));
        const headArrowP = M.expoOut(M.progress(t, 840, 180));
        arrowHead.style.strokeDashoffset = String((70 * (1 - headArrowP)).toFixed(2));

        // 9. Nota editorial de apoio
        if (noteEl) {
          const noteP = M.power3Out(M.progress(t, 480, 360));
          noteEl.style.opacity = String(noteP);
          noteEl.style.transform = `translate3d(0, ${M.lerp(20, 0, noteP).toFixed(2)}px, 0)`;
        }

        // 10. Carimbo terracota (se ativo)
        if (stampEl) {
          const stP = M.backOut(M.progress(t, 360, 260), 1.65);
          stampEl.style.opacity = String(M.clamp(M.progress(t, 340, 120), 0, 1));
          stampEl.style.transform =
            `scale(${M.lerp(1.75, 1.0, stP).toFixed(4)}) rotate(${M.lerp(-18, -8, stP).toFixed(2)}deg)`;
        }
      },
    };
  });
})();
