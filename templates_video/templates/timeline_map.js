/* ============================================================================
   Template 4: timeline_map (Cartografia Histórica & Linha do Tempo AT → NT)
   - 100% Offline, determinístico em seek(localTimeMs), Zero CSS animation/rAF
   - Estritamente dentro das Safe-Zones 9:16 (x: 76..908, y: 236..1474)
   - Modo A (Mapa Cartográfico Histórico): Oriente Médio / Galileia → Jerusalém,
     grade 31°46'N · 35°13'E, Mediterrâneo/Galileia/Jordão/Mar Morto, rosa-dos-ventos
     girando com seek(ms), 3 marcos geográficos, rota tracejada curva animada com
     stroke-dashoffset e ondas de pulso concêntricas no pino de destino.
   - Modo B (Linha do Tempo Bíblica AT → NT): Trilho cronológico com 3 nós temporais
     (ANTIGO TESTAMENTO · SOMBRA/PROMESSA → CONEXÃO PROFÉTICA → NOVO TESTAMENTO · CUMPRIMENTO),
     arco conector dourado #E5A93C via stroke-dashoffset e carimbo terracota.
   ============================================================================ */

(function () {
  "use strict";

  function fitSvgTypography(text, maxWidthPx, maxSize, minSize, maxTracking) {
    const str = String(text || "").trim();
    const len = Math.max(1, str.length);
    const tracking = len <= 10 ? maxTracking : len <= 18 ? Math.min(1.5, maxTracking) : 0.5;
    const rawSize = (maxWidthPx - len * tracking) / (len * 0.66);
    const fontSize = Math.max(minSize, Math.min(maxSize, Math.floor(rawSize)));
    const needsCompress = len * (fontSize * 0.66 + tracking) > maxWidthPx;
    return {
      fontSize,
      tracking,
      textLengthAttr: needsCompress
        ? ` textLength="${Math.floor(maxWidthPx)}" lengthAdjust="spacingAndGlyphs"`
        : "",
    };
  }

  function fitHeadlineSize(text) {
    const len = String(text || "").trim().length;
    if (len <= 16) return 58;
    if (len <= 24) return 50;
    if (len <= 34) return 43;
    return 38;
  }

  function detectTimelineMode(formatType, visual) {
    const fmt = String(formatType || "").toLowerCase().trim();
    if (fmt === "conexao_at_nt") return "timeline";

    const orig = String((visual && visual.original_term) || "").trim();
    const headline = String((visual && visual.headline) || "").trim();
    const subtext = String((visual && visual.subtext) || "").trim();
    const combined = `${headline} ${subtext} ${orig}`;

    // Se mencionar explicitamente locais cartográficos clássicos e não for conexao_at_nt, prioriza mapa
    const hasExplicitGeo =
      /\b(cafarnaum|galileia|jerusal[eé]m|jord[aã]o|mediterr[aâ]neo|babil[oô]nia|egito| damasco|samaria|judeia|mapa|rota|km|coordenadas)\b/i.test(
        orig
      );
    if (hasExplicitGeo && !/\b(at\s*->\s*nt|at\s*→\s*nt|antigo testamento|novo testamento|profecia)\b/i.test(orig)) {
      return "map";
    }

    const timelineRegex =
      /\b(at|nt|a\.t\.|n\.t\.|antigo testamento|novo testamento|profecia|profecias|prof[eé]tica|prof[eé]tico|tempo|tempos|s[eé]culo|s[eé]culos|anos|cumprimento|promessa)\b/i;

    if (timelineRegex.test(combined)) {
      return "timeline";
    }
    return "map";
  }

  function parseWaypoints(mode, visual) {
    const rawOrig = String((visual && visual.original_term) || "").trim();
    const rawHead = String((visual && visual.headline) || "").trim();
    const rawSub = String((visual && visual.subtext) || "").trim();

    const splitArrow = (str) =>
      str
        .split(/\s*(?:→|->|—|»|\|>)\s*/)
        .map((s) => s.trim())
        .filter(Boolean);

    let parts = splitArrow(rawOrig);
    if (parts.length < 2) {
      const headParts = splitArrow(rawHead.replace(/^ROTA:\s*/i, ""));
      if (headParts.length >= 2) parts = headParts;
    }

    if (mode === "timeline") {
      if (parts.length >= 3) {
        return [
          {
            code: "NÓ 01 · AT",
            title: parts[0].toUpperCase(),
            subtitle: "ANTIGO TESTAMENTO · SOMBRA / PROMESSA",
          },
          {
            code: "NÓ 02 · ELO",
            title: parts[1].toUpperCase(),
            subtitle: "CONEXÃO PROFÉTICA · REVELAÇÃO",
          },
          {
            code: "NÓ 03 · NT",
            title: parts[2].toUpperCase(),
            subtitle: "NOVO TESTAMENTO · CUMPRIMENTO",
          },
        ];
      }
      if (parts.length === 2) {
        return [
          {
            code: "NÓ 01 · AT",
            title: parts[0].toUpperCase(),
            subtitle: "ANTIGO TESTAMENTO · SOMBRA / PROMESSA",
          },
          {
            code: "NÓ 02 · ELO",
            title: (rawSub || "CONEXÃO PROFÉTICA").toUpperCase(),
            subtitle: "TRAJETÓRIA REDENTIVA · ESCRITURAS",
          },
          {
            code: "NÓ 03 · NT",
            title: parts[1].toUpperCase(),
            subtitle: "NOVO TESTAMENTO · CUMPRIMENTO",
          },
        ];
      }
      return [
        {
          code: "NÓ 01 · AT",
          title: "SOMBRA & PROMESSA",
          subtitle: "ANTIGO TESTAMENTO · LEI & PROFETAS",
        },
        {
          code: "NÓ 02 · ELO",
          title: "CONEXÃO PROFÉTICA",
          subtitle: rawSub ? rawSub.toUpperCase() : "TIPOLOGIA & ALIANÇA",
        },
        {
          code: "NÓ 03 · NT",
          title: "CUMPRIMENTO EM CRISTO",
          subtitle: "NOVO TESTAMENTO · EVANGELHO",
        },
      ];
    }

    // Modo A — Mapa Cartográfico Histórico
    if (parts.length >= 3) {
      return [
        { code: "01 · ORIGEM", title: parts[0].toUpperCase(), coords: "32°52'N · 35°34'E" },
        { code: "02 · ROTA", title: parts[1].toUpperCase(), coords: "32°11'N · 35°31'E" },
        { code: "03 · DESTINO", title: parts[2].toUpperCase(), coords: "31°46'N · 35°13'E" },
      ];
    }
    if (parts.length === 2) {
      return [
        { code: "01 · ORIGEM", title: parts[0].toUpperCase(), coords: "32°52'N · 35°34'E" },
        { code: "02 · TRAJETO", title: "VALE DO JORDÃO", coords: "32°11'N · 35°31'E" },
        { code: "03 · DESTINO", title: parts[1].toUpperCase(), coords: "31°46'N · 35°13'E" },
      ];
    }
    if (rawOrig.length > 0) {
      return [
        { code: "01 · ORIGEM", title: "CAFARNAUM", coords: "32°52'N · 35°34'E" },
        { code: "02 · TRAJETO", title: "VALE DO JORDÃO", coords: "32°11'N · 35°31'E" },
        { code: "03 · DESTINO", title: rawOrig.toUpperCase(), coords: "31°46'N · 35°13'E" },
      ];
    }
    return [
      { code: "01 · ORIGEM", title: "CAFARNAUM", coords: "32°52'N · 35°34'E" },
      { code: "02 · TRAJETO", title: "VALE DO JORDÃO", coords: "32°11'N · 35°31'E" },
      { code: "03 · DESTINO", title: "JERUSALÉM", coords: "31°46'N · 35°13'E" },
    ];
  }

  /* Avalia ponto (x, y) em curva Bézier cúbica para o cursor viajante determinístico */
  function cubicBezierPoint(p0, p1, p2, p3, t) {
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * t;
    const x = uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x;
    const y = uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y;
    return { x, y };
  }

  function evaluateRoutePosition(segments, progress01) {
    const p = Math.max(0, Math.min(1, progress01));
    if (p < 0.5) {
      const localT = p * 2;
      return cubicBezierPoint(segments[0].p0, segments[0].p1, segments[0].p2, segments[0].p3, localT);
    }
    const localT = (p - 0.5) * 2;
    return cubicBezierPoint(segments[1].p0, segments[1].p1, segments[1].p2, segments[1].p3, localT);
  }

  function buildMapSvg(waypoints, subtext, isDark, M) {
    const wp0 = waypoints[0];
    const wp1 = waypoints[1];
    const wp2 = waypoints[2];

    const fit0 = fitSvgTypography(wp0.title, 200, 21, 13, 1.2);
    const fit1 = fitSvgTypography(wp1.title, 200, 20, 13, 1.2);
    const fit2 = fitSvgTypography(wp2.title, 216, 22, 13, 1.4);
    const fitSub = fitSvgTypography(subtext || "120 KM · LEVANTE HISTÓRICO", 340, 16, 12, 1.5);

    const landFill1 = isDark ? "#232832" : "#EFE3CC";
    const landFill2 = isDark ? "#1B1E26" : "#DFCCA8";
    const seaFill = isDark ? "#132945" : "#1E3A5F";
    const gridStroke = isDark ? "#F4EDE1" : "#1E3A5F";
    const contourStroke = isDark ? "#E5A93C" : "#8A6B3F";

    return `
      <svg class="tm-svg" viewBox="0 0 800 560" xmlns="http://www.w3.org/2000/svg" aria-label="Mapa Cartográfico Histórico">
        <defs>
          <linearGradient id="tmLandGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${landFill1}" />
            <stop offset="100%" stop-color="${landFill2}" />
          </linearGradient>
          <linearGradient id="tmSeaGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${seaFill}" />
            <stop offset="100%" stop-color="#142740" />
          </linearGradient>
        </defs>

        <!-- Fundo cartográfico pergaminho/carvão -->
        <rect x="0" y="0" width="800" height="560" fill="url(#tmLandGrad)" />

        <!-- Relevo topográfico estilizado (curvas de nível da Galileia, Samaria e Judeia) -->
        <g fill="none" stroke="${contourStroke}" stroke-opacity="0.24" stroke-width="1.4" stroke-dasharray="6 5">
          <ellipse cx="470" cy="126" rx="145" ry="64" />
          <ellipse cx="470" cy="126" rx="105" ry="44" />
          <ellipse cx="395" cy="285" rx="130" ry="72" />
          <ellipse cx="375" cy="422" rx="148" ry="78" />
          <ellipse cx="375" cy="422" rx="96" ry="48" />
        </g>

        <!-- Costa do Mar Mediterrâneo (oeste) -->
        <path d="M 0,0 L 245,0 C 232,58 214,112 196,158 C 188,176 204,190 192,216 C 174,264 156,338 134,412 C 116,472 92,522 72,560 L 0,560 Z"
              fill="url(#tmSeaGrad)" opacity="0.92" />
        <path d="M 253,0 C 240,58 222,112 204,158 C 196,176 212,190 200,216 C 182,264 164,338 142,412 C 124,472 100,522 80,560"
              fill="none" stroke="#E5A93C" stroke-width="2" stroke-opacity="0.55" stroke-dasharray="5 4" />

        <!-- Batimetria e rótulo do Mar Mediterrâneo -->
        <g stroke="#F4EDE1" stroke-opacity="0.18" stroke-width="1.2">
          <line x1="24" y1="110" x2="148" y2="110" />
          <line x1="18" y1="220" x2="132" y2="220" />
          <line x1="16" y1="330" x2="108" y2="330" />
        </g>
        <text x="96" y="268" text-anchor="middle" font-family="Consolas, monospace" font-size="14" font-weight="700"
              fill="#F4EDE1" opacity="0.72" letter-spacing="3" transform="rotate(-74 96 268)">MAR MEDITERRÂNEO</text>

        <!-- Sistema Hidrográfico: Rio Jordão Superior + Mar da Galileia + Rio Jordão + Mar Morto -->
        <!-- Afluente Hermom -> Galileia -->
        <path d="M 488,24 C 484,56 476,78 472,98" fill="none" stroke="${seaFill}" stroke-width="3.5" stroke-linecap="round" />

        <!-- Mar da Galileia (formato de harpa) -->
        <path d="M 472,96 C 492,98 504,116 498,138 C 493,156 476,168 462,164 C 446,159 442,138 448,118 C 453,104 461,95 472,96 Z"
              fill="${seaFill}" stroke="#E5A93C" stroke-width="2" />
        <text x="514" y="124" font-family="Consolas, monospace" font-size="12" font-weight="700"
              fill="${isDark ? "#E5A93C" : "#1E3A5F"}" opacity="0.85" letter-spacing="1">MAR DA GALILEIA</text>

        <!-- Rio Jordão serpenteando até o Mar Morto -->
        <path d="M 466,164 C 458,192 480,214 468,242 C 456,270 482,296 468,324 C 456,348 466,368 458,390"
              fill="none" stroke="${seaFill}" stroke-width="5.5" stroke-linecap="round" />
        <path d="M 466,164 C 458,192 480,214 468,242 C 456,270 482,296 468,324 C 456,348 466,368 458,390"
              fill="none" stroke="#E5A93C" stroke-width="1.4" stroke-opacity="0.65" stroke-dasharray="3 4" />

        <!-- Mar Morto (ao sul) -->
        <path d="M 458,388 C 478,392 486,422 480,462 C 475,494 462,518 446,516 C 432,514 428,486 434,450 C 439,418 445,386 458,388 Z"
              fill="${seaFill}" stroke="#E5A93C" stroke-width="2" />
        <text x="494" y="476" font-family="Consolas, monospace" font-size="12" font-weight="700"
              fill="${isDark ? "#E5A93C" : "#1E3A5F"}" opacity="0.85" letter-spacing="1">MAR MORTO</text>

        <!-- Grade Cartográfica de Coordenadas (31°46'N · 35°13'E) -->
        <g stroke="${gridStroke}" stroke-opacity="0.15" stroke-width="1">
          <line x1="0" y1="92" x2="800" y2="92" />
          <line x1="0" y1="204" x2="800" y2="204" />
          <line x1="0" y1="316" x2="800" y2="316" />
          <line x1="0" y1="428" x2="800" y2="428" />
          <line x1="160" y1="0" x2="160" y2="560" />
          <line x1="320" y1="0" x2="320" y2="560" />
          <line x1="480" y1="0" x2="480" y2="560" />
          <line x1="640" y1="0" x2="640" y2="560" />
        </g>

        <!-- Marcações de Latitude/Longitude nas bordas -->
        <g font-family="Consolas, monospace" font-size="12" font-weight="700" fill="${gridStroke}" opacity="0.62">
          <text x="742" y="86">32°52'N</text>
          <text x="742" y="198">32°20'N</text>
          <text x="742" y="310">32°02'N</text>
          <text x="742" y="422">31°46'N</text>
          <text x="272" y="22">34°45'E</text>
          <text x="432" y="22">35°13'E</text>
          <text x="592" y="22">35°45'E</text>
        </g>

        <!-- Trilha base fantasma da rota histórica -->
        <path d="M 446,118 C 392,164 494,218 468,268 C 444,316 420,374 368,424"
              fill="none" stroke="#181A1F" stroke-opacity="0.22" stroke-width="9" stroke-linecap="round" />
        <path d="M 446,118 C 392,164 494,218 468,268 C 444,316 420,374 368,424"
              fill="none" stroke="#E5A93C" stroke-opacity="0.35" stroke-width="5" stroke-linecap="round" stroke-dasharray="10 10" />

        <!-- Rota Principal Animada (stroke-dashoffset determinístico + sobreposição tracejada) -->
        <path class="tm-route-path" data-len="460"
              d="M 446,118 C 392,164 494,218 468,268 C 444,316 420,374 368,424"
              fill="none" stroke="#9E3B2E" stroke-width="7.5" stroke-linecap="round" />
        <path class="tm-route-dashes"
              d="M 446,118 C 392,164 494,218 468,268 C 444,316 420,374 368,424"
              fill="none" stroke="#E5A93C" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="10 14" />

        <!-- Ondas de pulso concêntricas no Pino de Destino (368, 424) -->
        <circle class="tm-pulse-ring-1" cx="368" cy="424" r="18" fill="none" stroke="#9E3B2E" stroke-width="3.5" opacity="0" />
        <circle class="tm-pulse-ring-2" cx="368" cy="424" r="18" fill="none" stroke="#E5A93C" stroke-width="2.5" opacity="0" />

        <!-- Cursor Viajante Determinístico ao longo da rota -->
        <g class="tm-route-traveler" transform="translate(446, 118)">
          <circle cx="0" cy="0" r="13" fill="#E5A93C" opacity="0.34" />
          <circle cx="0" cy="0" r="7.5" fill="#9E3B2E" stroke="#FAF6EE" stroke-width="2.5" />
        </g>

        <!-- MARCO 1: Origem (Galileia / Cafarnaum) -->
        <g class="tm-pin-group tm-pin-1" transform="translate(446, 118)">
          <circle cx="0" cy="0" r="13" fill="#1E3A5F" stroke="#FAF6EE" stroke-width="3.5" />
          <circle cx="0" cy="0" r="5" fill="#E5A93C" />
          <!-- Placa de Rótulo 1 (à esquerda do pino) -->
          <g transform="translate(-244, -34)">
            <rect x="0" y="0" width="224" height="62" rx="6" fill="#181A1F" stroke="#E5A93C" stroke-width="2" />
            <text x="14" y="21" font-family="Consolas, monospace" font-size="12" font-weight="700" fill="#E5A93C" letter-spacing="1.2">${M.escapeHtml(wp0.code)}</text>
            <text x="14" y="45" font-family="Georgia, serif" font-size="${fit0.fontSize}" font-weight="700" fill="#FAF6EE" letter-spacing="${fit0.tracking}"${fit0.textLengthAttr}>${M.escapeHtml(wp0.title)}</text>
          </g>
        </g>

        <!-- MARCO 2: Ponto Intermediário (Vale do Jordão) -->
        <g class="tm-pin-group tm-pin-2" transform="translate(468, 268)">
          <circle cx="0" cy="0" r="12" fill="#E5A93C" stroke="#181A1F" stroke-width="3.5" />
          <circle cx="0" cy="0" r="4.5" fill="#9E3B2E" />
          <!-- Placa de Rótulo 2 (à direita do pino) -->
          <g transform="translate(22, -30)">
            <rect x="0" y="0" width="224" height="60" rx="6" fill="#FAF6EE" stroke="#1E3A5F" stroke-width="2" />
            <text x="14" y="20" font-family="Consolas, monospace" font-size="12" font-weight="700" fill="#9E3B2E" letter-spacing="1.2">${M.escapeHtml(wp1.code)}</text>
            <text x="14" y="44" font-family="Georgia, serif" font-size="${fit1.fontSize}" font-weight="700" fill="#181A1F" letter-spacing="${fit1.tracking}"${fit1.textLengthAttr}>${M.escapeHtml(wp1.title)}</text>
          </g>
        </g>

        <!-- MARCO 3: Destino Principal (Jerusalém) -->
        <g class="tm-pin-group tm-pin-3" transform="translate(368, 424)">
          <circle cx="0" cy="0" r="16" fill="#9E3B2E" stroke="#FAF6EE" stroke-width="4" />
          <circle cx="0" cy="0" r="6" fill="#E5A93C" />
          <!-- Placa de Rótulo 3 (à esquerda/abaixo do pino) -->
          <g transform="translate(-258, -32)">
            <rect x="0" y="0" width="238" height="68" rx="6" fill="#9E3B2E" stroke="#FAF6EE" stroke-width="2.5" />
            <text x="14" y="22" font-family="Consolas, monospace" font-size="12" font-weight="700" fill="#E5A93C" letter-spacing="1.4">${M.escapeHtml(wp2.code)}</text>
            <text x="14" y="49" font-family="Georgia, serif" font-size="${fit2.fontSize}" font-weight="700" fill="#FAF6EE" letter-spacing="${fit2.tracking}"${fit2.textLengthAttr}>${M.escapeHtml(wp2.title)}</text>
          </g>
        </g>

        <!-- Rosa-dos-Ventos Editorial (gira sutilmente com seek) -->
        <g class="tm-compass-rose" transform="translate(692, 118)">
          <circle cx="0" cy="0" r="64" fill="#FAF6EE" fill-opacity="0.88" stroke="#1E3A5F" stroke-width="2.5" />
          <circle cx="0" cy="0" r="52" fill="none" stroke="#1E3A5F" stroke-width="1.2" stroke-dasharray="4 4" />
          <polygon points="0,-48 10,-10 0,-18 -10,-10" fill="#9E3B2E" />
          <polygon points="0,48 10,10 0,18 -10,10" fill="#1E3A5F" />
          <polygon points="48,0 10,10 18,0 10,-10" fill="#E5A93C" />
          <polygon points="-48,0 -10,10 -18,0 -10,-10" fill="#1E3A5F" opacity="0.65" />
          <circle cx="0" cy="0" r="6" fill="#181A1F" />
          <text x="0" y="-53" text-anchor="middle" font-family="Consolas, monospace" font-size="12" font-weight="800" fill="#9E3B2E">N</text>
        </g>

        <!-- Barra de Escala Cartográfica & Coordenadas -->
        <g transform="translate(26, 502)">
          <rect x="0" y="0" width="388" height="40" rx="5" fill="#181A1F" fill-opacity="0.88" stroke="#E5A93C" stroke-width="1.5" />
          <path d="M 16,26 L 96,26 M 16,20 L 16,30 M 56,22 L 56,29 M 96,20 L 96,30" stroke="#E5A93C" stroke-width="2.2" />
          <text x="16" y="15" font-family="Consolas, monospace" font-size="11" font-weight="700" fill="#E5A93C" letter-spacing="1">31°46'N · 35°13'E</text>
          <text x="114" y="25" font-family="Consolas, monospace" font-size="${fitSub.fontSize}" font-weight="700" fill="#FAF6EE" letter-spacing="${fitSub.tracking}"${fitSub.textLengthAttr}>${M.escapeHtml((subtext || "120 KM · ROTA HISTÓRICA").toUpperCase())}</text>
        </g>
      </svg>
    `;
  }

  function buildTimelineSvg(waypoints, subtext, isDark, M) {
    const wp0 = waypoints[0];
    const wp1 = waypoints[1];
    const wp2 = waypoints[2];

    const fit0 = fitSvgTypography(wp0.title, 286, 23, 14, 1.2);
    const fit1 = fitSvgTypography(wp1.title, 286, 22, 14, 1.2);
    const fit2 = fitSvgTypography(wp2.title, 286, 24, 14, 1.3);
    const fitSub0 = fitSvgTypography(wp0.subtitle, 286, 13, 10, 1.0);
    const fitSub1 = fitSvgTypography(wp1.subtitle, 286, 13, 10, 1.0);
    const fitSub2 = fitSvgTypography(wp2.subtitle, 286, 13, 10, 1.0);

    const bg1 = isDark ? "#1E222B" : "#F2E6D0";
    const bg2 = isDark ? "#15181F" : "#E1CEA9";
    const gridStroke = isDark ? "#F4EDE1" : "#1E3A5F";

    return `
      <svg class="tm-svg" viewBox="0 0 800 560" xmlns="http://www.w3.org/2000/svg" aria-label="Linha do Tempo Bíblica AT para NT">
        <defs>
          <linearGradient id="tmTimeGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${bg1}" />
            <stop offset="100%" stop-color="${bg2}" />
          </linearGradient>
        </defs>

        <rect x="0" y="0" width="800" height="560" fill="url(#tmTimeGrad)" />

        <!-- Grade Cronológica e Eixos de Séculos -->
        <g stroke="${gridStroke}" stroke-opacity="0.16" stroke-width="1.2">
          <line x1="0" y1="112" x2="800" y2="112" />
          <line x1="0" y1="280" x2="800" y2="280" />
          <line x1="0" y1="448" x2="800" y2="448" />
          <line x1="160" y1="0" x2="160" y2="560" stroke-dasharray="6 6" />
          <line x1="400" y1="0" x2="400" y2="560" stroke-dasharray="6 6" />
          <line x1="640" y1="0" x2="640" y2="560" stroke-dasharray="6 6" />
        </g>

        <!-- Marca d'água tipológica AT -> NT -->
        <text x="48" y="516" font-family="Georgia, serif" font-size="92" font-weight="800"
              fill="${gridStroke}" opacity="0.08" letter-spacing="4">AT → NT</text>

        <!-- Arco Profético Superior Fantasma -->
        <path d="M 160,118 C 340,28 520,120 640,438"
              fill="none" stroke="#E5A93C" stroke-opacity="0.28" stroke-width="3" stroke-dasharray="8 8" />

        <!-- Trilho Cronológico Diagonal Base -->
        <path d="M 160,118 C 250,180 310,220 400,278 C 490,336 550,382 640,438"
              fill="none" stroke="#181A1F" stroke-opacity="0.22" stroke-width="10" stroke-linecap="round" />

        <!-- Arco Conector Dourado #E5A93C Animado via stroke-dashoffset -->
        <path class="tm-route-path" data-len="580"
              d="M 160,118 C 250,180 310,220 400,278 C 490,336 550,382 640,438"
              fill="none" stroke="#E5A93C" stroke-width="8" stroke-linecap="round" />
        <path class="tm-route-dashes"
              d="M 160,118 C 250,180 310,220 400,278 C 490,336 550,382 640,438"
              fill="none" stroke="#9E3B2E" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="12 14" />

        <!-- Ondas de pulso concêntricas no Nó 3 (Cumprimento NT: 640, 438) -->
        <circle class="tm-pulse-ring-1" cx="640" cy="438" r="20" fill="none" stroke="#E5A93C" stroke-width="4" opacity="0" />
        <circle class="tm-pulse-ring-2" cx="640" cy="438" r="20" fill="none" stroke="#9E3B2E" stroke-width="2.5" opacity="0" />

        <!-- Cursor Viajante Cronológico -->
        <g class="tm-route-traveler" transform="translate(160, 118)">
          <circle cx="0" cy="0" r="14" fill="#E5A93C" opacity="0.36" />
          <circle cx="0" cy="0" r="8" fill="#9E3B2E" stroke="#FAF6EE" stroke-width="2.5" />
        </g>

        <!-- NÓ 1: ANTIGO TESTAMENTO · SOMBRA / PROMESSA (160, 118) -->
        <g class="tm-pin-group tm-pin-1" transform="translate(160, 118)">
          <circle cx="0" cy="0" r="17" fill="#1E3A5F" stroke="#FAF6EE" stroke-width="4" />
          <circle cx="0" cy="0" r="6" fill="#E5A93C" />
          <g transform="translate(28, -42)">
            <rect x="0" y="0" width="320" height="82" rx="6" fill="#1E3A5F" stroke="#E5A93C" stroke-width="2.2" />
            <text x="16" y="23" font-family="Consolas, monospace" font-size="${fitSub0.fontSize}" font-weight="700" fill="#E5A93C" letter-spacing="${fitSub0.tracking}"${fitSub0.textLengthAttr}>${M.escapeHtml(wp0.subtitle)}</text>
            <text x="16" y="56" font-family="Georgia, serif" font-size="${fit0.fontSize}" font-weight="700" fill="#FAF6EE" letter-spacing="${fit0.tracking}"${fit0.textLengthAttr}>${M.escapeHtml(wp0.title)}</text>
          </g>
        </g>

        <!-- NÓ 2: CONEXÃO PROFÉTICA (400, 278) -->
        <g class="tm-pin-group tm-pin-2" transform="translate(400, 278)">
          <circle cx="0" cy="0" r="16" fill="#E5A93C" stroke="#181A1F" stroke-width="4" />
          <circle cx="0" cy="0" r="6" fill="#9E3B2E" />
          <g transform="translate(-344, -40)">
            <rect x="0" y="0" width="318" height="80" rx="6" fill="#FAF6EE" stroke="#181A1F" stroke-width="2.2" />
            <text x="16" y="23" font-family="Consolas, monospace" font-size="${fitSub1.fontSize}" font-weight="700" fill="#9E3B2E" letter-spacing="${fitSub1.tracking}"${fitSub1.textLengthAttr}>${M.escapeHtml(wp1.subtitle)}</text>
            <text x="16" y="55" font-family="Georgia, serif" font-size="${fit1.fontSize}" font-weight="700" fill="#181A1F" letter-spacing="${fit1.tracking}"${fit1.textLengthAttr}>${M.escapeHtml(wp1.title)}</text>
          </g>
        </g>

        <!-- NÓ 3: NOVO TESTAMENTO · CUMPRIMENTO (640, 438) -->
        <g class="tm-pin-group tm-pin-3" transform="translate(640, 438)">
          <circle cx="0" cy="0" r="19" fill="#9E3B2E" stroke="#FAF6EE" stroke-width="4" />
          <circle cx="0" cy="0" r="7" fill="#E5A93C" />
          <g transform="translate(-352, -42)">
            <rect x="0" y="0" width="324" height="84" rx="6" fill="#9E3B2E" stroke="#E5A93C" stroke-width="2.5" />
            <text x="16" y="24" font-family="Consolas, monospace" font-size="${fitSub2.fontSize}" font-weight="700" fill="#E5A93C" letter-spacing="${fitSub2.tracking}"${fitSub2.textLengthAttr}>${M.escapeHtml(wp2.subtitle)}</text>
            <text x="16" y="58" font-family="Georgia, serif" font-size="${fit2.fontSize}" font-weight="700" fill="#FAF6EE" letter-spacing="${fit2.tracking}"${fit2.textLengthAttr}>${M.escapeHtml(wp2.title)}</text>
          </g>
        </g>

        <!-- Emblema Cronológico / Astrolábio Editorial (gira sutilmente com seek) -->
        <g class="tm-compass-rose" transform="translate(690, 108)">
          <circle cx="0" cy="0" r="58" fill="#FAF6EE" fill-opacity="0.88" stroke="#1E3A5F" stroke-width="2.5" />
          <circle cx="0" cy="0" r="44" fill="none" stroke="#9E3B2E" stroke-width="1.5" stroke-dasharray="5 4" />
          <line x1="-42" y1="0" x2="42" y2="0" stroke="#1E3A5F" stroke-width="2" />
          <line x1="0" y1="-42" x2="0" y2="42" stroke="#1E3A5F" stroke-width="2" />
          <circle cx="0" cy="0" r="14" fill="#E5A93C" stroke="#181A1F" stroke-width="2" />
          <text x="0" y="4" text-anchor="middle" font-family="Georgia, serif" font-size="11" font-weight="700" fill="#181A1F">Α·Ω</text>
        </g>
      </svg>
    `;
  }

  function buildContextWordsHtml(words, visual, scriptureRef, durationMs, M) {
    const hlIdSet = new Set((visual && visual.highlight_word_ids) || []);
    let tokens = [];

    if (Array.isArray(words) && words.length > 0) {
      tokens = words.map((w, idx) => ({
        text: w.text,
        local_start_ms: w.local_start_ms,
        local_end_ms: w.local_end_ms,
        isHl: hlIdSet.has(w.word_id),
        idx,
      }));
    } else {
      const fallbackStr =
        (scriptureRef && scriptureRef.exact_text) ||
        (visual && visual.headline) ||
        "Da Galileia a Jerusalém, cada marco geográfico revela o contexto real das Escrituras.";
      const rawList = String(fallbackStr).trim().split(/\s+/).filter(Boolean);
      const step = Math.max(160, Math.floor((durationMs - 500) / Math.max(1, rawList.length)));
      tokens = rawList.map((text, idx) => ({
        text,
        local_start_ms: 200 + idx * step,
        local_end_ms: 200 + (idx + 1) * step,
        isHl: idx === rawList.length - 1 || text.length >= 7,
        idx,
      }));
    }

    if (!tokens.some((tk) => tk.isHl) && tokens.length > 0) {
      let best = tokens[tokens.length - 1];
      tokens.forEach((tk) => {
        if (M.normalizeToken(tk.text).length >= M.normalizeToken(best.text).length) {
          best = tk;
        }
      });
      best.isHl = true;
    }

    return {
      tokens,
      html: tokens
        .map((tk, i) => {
          const hlSpan = tk.isHl ? `<span class="tm-ctx-hl"></span>` : "";
          return `<span class="tm-ctx-word" data-idx="${i}" data-hl="${tk.isHl ? "1" : "0"}">${hlSpan}${M.escapeHtml(tk.text)}</span>`;
        })
        .join(" "),
    };
  }

  window.__STUDIO__.registerTemplate("timeline_map", function createTimelineMap(ctx) {
    const { root, scene, visual, theme, words, durationMs, scriptureRef, formatType, payload, assetEntry, imageLayout, Math: M } = ctx;
    const useCardImage = Boolean(assetEntry && imageLayout === "card");
    const fitStyle = visual.image_fit === "contain" ? "object-fit:contain;" : "object-fit:cover;";
    const opStyle = `opacity:${M.clamp(Number(visual.image_opacity) || 1.0, 0.1, 1.0)};`;
    const rawStamp = String(visual.stamp_text || "").trim();
    const isForbidden = window.__STUDIO__ && window.__STUDIO__.isForbiddenSeal(rawStamp);
    const showStamp = !isForbidden && visual.show_stamp !== false;

    const effectiveFormat =
      formatType ||
      (payload && payload.format_type) ||
      (scene && scene.format_type) ||
      "mapa_contexto";

    const mode = detectTimelineMode(effectiveFormat, visual);
    const waypoints = parseWaypoints(mode, visual);
    const isDark = theme === "carvao" || theme === "azul_marinho";

    const headline =
      visual.headline ||
      (mode === "timeline" ? "DA PROMESSA AO CUMPRIMENTO" : "ROTA: GALILEIA → JERUSALÉM");
    const subtext =
      visual.subtext ||
      (mode === "timeline" ? "Conexão Profética · AT → NT" : "120 km · Contexto Histórico");

    const coordTag =
      mode === "timeline"
        ? "LINHA DO TEMPO · AT → NT"
        : "31°46'N · 35°13'E · CARTOGRAFIA";

    const stampLabel =
      visual.stamp_text ||
      (mode === "timeline" ? "CUMPRIDO" : "ROTA HISTÓRICA");

    const svgMarkup =
      mode === "timeline"
        ? buildTimelineSvg(waypoints, subtext, isDark, M)
        : buildMapSvg(waypoints, subtext, isDark, M);

    const ctxWords = buildContextWordsHtml(words, visual, scriptureRef, durationMs, M);
    const routeSummary = `${waypoints[0].title} → ${waypoints[waypoints.length - 1].title}`;
    const refLabel =
      (scriptureRef && scriptureRef.citation
        ? `${scriptureRef.citation} · ${scriptureRef.translation || "NVI"}`
        : subtext);

    root.innerHTML = `
      <div class="tm-scene" data-mode="${mode}">
        <!-- Cabeçalho Cartográfico / Cronológico -->
        <header class="tm-header">
          <div class="tm-kicker-row">
            <span class="tm-coord-badge">${M.escapeHtml(coordTag)}</span>
            <span class="tm-subtext-pill">${M.escapeHtml(subtext)}</span>
          </div>
          <h1 class="tm-headline" style="font-size:${fitHeadlineSize(headline)}px;">
            <span class="tm-headline-text">${M.escapeHtml(headline)}</span>
            <span class="tm-headline-bar"></span>
          </h1>
        </header>

        <!-- Prancha Cartográfica / Linha do Tempo SVG com Borda de Papel Rasgado -->
        <div class="tm-board-wrap">
          <div class="tm-back-sheet"></div>
          <div class="tm-board-shadow">
            <div class="vox-tape tm-tape-tl"></div>
            <div class="vox-tape tm-tape-br"></div>
            <div class="tm-board-outer">
              <div class="tm-board-inner">
                ${
                  useCardImage
                    ? `<img class="tpl-inline-media-img" style="${fitStyle}${opStyle}" src="${M.escapeHtml(assetEntry.url)}" alt="${M.escapeHtml(headline)}" />`
                    : svgMarkup
                }
              </div>
            </div>
          </div>
          ${showStamp ? `<div class="vox-stamp tm-stamp">${M.escapeHtml(stampLabel)}</div>` : ""}
        </div>

        <!-- Cartão de Citação / Contexto na Base Segura com Marca-Texto #E5A93C -->
        <footer class="tm-context-card">
          <div class="tm-context-meta">
            <span class="tm-route-pill">${M.escapeHtml(routeSummary)}</span>
            <span class="tm-ref-tag">${M.escapeHtml(refLabel)}</span>
          </div>
          <div class="tm-context-body">
            ${ctxWords.html}
          </div>
        </footer>
      </div>
    `;

    const headerEl = root.querySelector(".tm-header");
    const headlineBar = root.querySelector(".tm-headline-bar");
    const backSheet = root.querySelector(".tm-back-sheet");
    const boardShadow = root.querySelector(".tm-board-shadow");
    const tapeTl = root.querySelector(".tm-tape-tl");
    const tapeBr = root.querySelector(".tm-tape-br");
    const routePath = root.querySelector(".tm-route-path");
    const routeDashes = root.querySelector(".tm-route-dashes");
    const travelerEl = root.querySelector(".tm-route-traveler");
    const pin1 = root.querySelector(".tm-pin-1");
    const pin2 = root.querySelector(".tm-pin-2");
    const pin3 = root.querySelector(".tm-pin-3");
    const pulse1 = root.querySelector(".tm-pulse-ring-1");
    const pulse2 = root.querySelector(".tm-pulse-ring-2");
    const compassEl = root.querySelector(".tm-compass-rose");
    const stampEl = root.querySelector(".tm-stamp");
    const contextCard = root.querySelector(".tm-context-card");
    const ctxWordEls = Array.from(root.querySelectorAll(".tm-ctx-word"));
    const boardImg = root.querySelector(".tpl-inline-media-img");

    const routeLen = Number((routePath && routePath.dataset.len) || 520);
    if (routePath) {
      routePath.style.strokeDasharray = String(routeLen);
      routePath.style.strokeDashoffset = String(routeLen);
    }

    const routeSegments =
      mode === "timeline"
        ? [
            {
              p0: { x: 160, y: 118 },
              p1: { x: 250, y: 180 },
              p2: { x: 310, y: 220 },
              p3: { x: 400, y: 278 },
            },
            {
              p0: { x: 400, y: 278 },
              p1: { x: 490, y: 336 },
              p2: { x: 550, y: 382 },
              p3: { x: 640, y: 438 },
            },
          ]
        : [
            {
              p0: { x: 446, y: 118 },
              p1: { x: 392, y: 164 },
              p2: { x: 494, y: 218 },
              p3: { x: 468, y: 268 },
            },
            {
              p0: { x: 468, y: 268 },
              p1: { x: 444, y: 316 },
              p2: { x: 420, y: 374 },
              p3: { x: 368, y: 424 },
            },
          ];

    const compassCenter = mode === "timeline" ? { x: 690, y: 108 } : { x: 692, y: 118 };
    const pinCoords =
      mode === "timeline"
        ? [
            { x: 160, y: 118 },
            { x: 400, y: 278 },
            { x: 640, y: 438 },
          ]
        : [
            { x: 446, y: 118 },
            { x: 468, y: 268 },
            { x: 368, y: 424 },
          ];

    return {
      seek(t, pGlobal, beatState, tReal) {
        const tm = Number.isFinite(tReal) ? tReal : t;
        // Evolução multi-beat do headline e subtext em cenas longas
        if (beatState && beatState.hasBeats && beatState.activeBeat) {
          const headSpan = headerEl && headerEl.querySelector(".tm-headline-text");
          if (headSpan && beatState.activeBeat.headline && headSpan.textContent !== beatState.activeBeat.headline) {
            headSpan.textContent = beatState.activeBeat.headline;
          }
          const subPill = headerEl && headerEl.querySelector(".tm-subtext-pill");
          if (subPill && beatState.activeBeat.subtext && subPill.textContent !== beatState.activeBeat.subtext) {
            subPill.textContent = beatState.activeBeat.subtext;
          }
        }
        // 1. Cabeçalho e barra dourada de título
        const headP = M.power3Out(M.progress(t, 40, 320));
        headerEl.style.opacity = String(headP);
        headerEl.style.transform = `translate3d(0, ${M.lerp(-22, 0, headP).toFixed(2)}px, 0)`;

        const barP = M.expoOut(M.progress(t, 220, 460));
        headlineBar.style.transform = `scaleX(${barP.toFixed(4)})`;

        // 2. Folha traseira e prancha cartográfica principal com flutuação suave contínua
        const backP = M.backOut(M.progress(t, 60, 420), 1.2);
        backSheet.style.opacity = String(M.clamp(M.progress(t, 40, 200), 0, 1));
        backSheet.style.transform = `translate3d(${M.lerp(-26, -8, backP).toFixed(2)}px, ${M.lerp(28, 10, backP).toFixed(2)}px, 0) rotate(${(M.lerp(-3.5, -1.4, backP) + Math.sin(pGlobal * Math.PI * 2) * 0.45).toFixed(2)}deg)`;

        const boardP = M.backOut(M.progress(t, 100, 460), 1.35);
        const floatY = Math.sin(pGlobal * Math.PI * 2) * 4;
        boardShadow.style.opacity = String(M.clamp(M.progress(t, 80, 200), 0, 1));
        boardShadow.style.transform = `translate3d(0, ${(M.lerp(56, 0, boardP) + floatY).toFixed(2)}px, 0) scale(${M.lerp(0.92, 1.0, boardP).toFixed(4)}) rotate(${(M.lerp(1.8, 0.4, boardP) + Math.cos(pGlobal * Math.PI * 1.5) * 0.35).toFixed(2)}deg)`;

        if (boardImg && window.__STUDIO__ && typeof window.__STUDIO__.evaluateImageTransform === "function") {
          const imgTf = window.__STUDIO__.evaluateImageTransform(visual, pGlobal, tm, durationMs);
          boardImg.style.transform = imgTf.css;
        }

        // 3. Fitas crepe
        const tape1P = M.expoOut(M.progress(t, 260, 220));
        const tape2P = M.expoOut(M.progress(t, 340, 220));
        tapeTl.style.opacity = String(tape1P);
        tapeBr.style.opacity = String(tape2P);

        // 4. Traçado SVG determinístico da rota / arco conector (acompanha toda a duração da cena)
        const routeDrawDuration = Math.max(900, Math.min(4800, durationMs * 0.72));
        const routeP = M.power2Out(M.progress(tm, 260, routeDrawDuration));
        if (routePath) {
          routePath.style.strokeDashoffset = String((routeLen * (1 - routeP)).toFixed(2));
        }
        if (routeDashes) {
          routeDashes.style.opacity = String(M.clamp(routeP * 1.2, 0, 0.92).toFixed(3));
          routeDashes.style.strokeDashoffset = String((-t * 0.035).toFixed(2));
        }

        // Posição determinística do cursor viajante ao longo da curva
        if (travelerEl) {
          const pt = evaluateRoutePosition(routeSegments, routeP);
          travelerEl.setAttribute("transform", `translate(${pt.x.toFixed(2)}, ${pt.y.toFixed(2)})`);
          travelerEl.style.opacity = String(M.clamp(M.progress(t, 220, 140), 0, 1));
        }

        // 5. Pinos / Nós com entrada escalonada sincronizada à chegada da rota
        const pinTimings = [180, 260 + routeDrawDuration * 0.36, 260 + routeDrawDuration * 0.76];
        [pin1, pin2, pin3].forEach((pinEl, idx) => {
          if (!pinEl) return;
          const pPin = M.backOut(M.progress(t, pinTimings[idx], 320), 1.45);
          const opPin = M.clamp(M.progress(t, pinTimings[idx], 150), 0, 1);
          const c = pinCoords[idx];
          pinEl.style.opacity = String(opPin.toFixed(3));
          pinEl.setAttribute(
            "transform",
            `translate(${c.x}, ${c.y}) scale(${M.lerp(0.65, 1.0, pPin).toFixed(4)})`
          );
        });

        // 6. Ondas de pulso concêntricas determinísticas no pino de destino / cumprimento
        const pulseCycle1 = ((t % 1200) + 1200) % 1200 / 1200;
        const pulseCycle2 = (((t + 600) % 1200) + 1200) % 1200 / 1200;
        const pulseActive = M.clamp(M.progress(t, 360, 300), 0, 1);
        if (pulse1) {
          pulse1.setAttribute("r", String(M.lerp(16, 52, pulseCycle1).toFixed(2)));
          pulse1.setAttribute("opacity", String(((1 - pulseCycle1) * 0.82 * pulseActive).toFixed(3)));
        }
        if (pulse2) {
          pulse2.setAttribute("r", String(M.lerp(16, 52, pulseCycle2).toFixed(2)));
          pulse2.setAttribute("opacity", String(((1 - pulseCycle2) * 0.68 * pulseActive).toFixed(3)));
        }

        // 7. Rosa-dos-ventos / Astrolábio girando sutilmente com seek(ms)
        if (compassEl) {
          const angle = M.lerp(-14, 18, pGlobal);
          compassEl.setAttribute(
            "transform",
            `translate(${compassCenter.x}, ${compassCenter.y}) rotate(${angle.toFixed(2)})`
          );
        }

        // 8. Carimbo Terracota
        if (stampEl) {
          const stampTrigger = Math.min(720, durationMs * 0.28);
          const stP = M.backOut(M.progress(t, stampTrigger, 260), 1.6);
          const stOp = M.clamp(M.progress(t, stampTrigger, 100), 0, 1);
          stampEl.style.opacity = String(stOp.toFixed(3));
          stampEl.style.transform = `scale(${M.lerp(1.75, 1.0, stP).toFixed(4)}) rotate(${M.lerp(-16, -7, stP).toFixed(2)}deg)`;
        }

        // 9. Cartão de Citação/Contexto na Base Segura + Marca-Texto #E5A93C palavra por palavra
        if (contextCard) {
          const ctxP = M.power3Out(M.progress(t, 280, 340));
          contextCard.style.opacity = String(ctxP);
          contextCard.style.transform = `translate3d(0, ${M.lerp(24, 0, ctxP).toFixed(2)}px, 0)`;
        }

        ctxWordEls.forEach((wEl, idx) => {
          const tk = ctxWords.tokens[idx];
          if (!tk) return;
          const isReached = t >= tk.local_start_ms - 40;
          const isSpeaking = t >= tk.local_start_ms && t <= tk.local_end_ms + 60;
          wEl.style.opacity = isReached ? "1" : "0.62";
          wEl.classList.toggle("is-speaking", isSpeaking);

          if (tk.isHl) {
            const hlEl = wEl.querySelector(".tm-ctx-hl");
            if (hlEl) {
              const hlP = M.expoOut(M.progress(t, tk.local_start_ms, 280));
              hlEl.style.transform = `scaleX(${hlP.toFixed(4)})`;
              wEl.classList.toggle("is-hl-active", hlP > 0.35);
            }
          }
        });
      },
    };
  });
})();
