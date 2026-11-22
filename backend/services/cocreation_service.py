"""Serviço de Co-criação Guiada (Macro-Fase 1): recomendação de série, roteiro, refino e storyboard.

Mantém estritamente contexto isolado por nó (AGENTS.md Regra 3) e fallback determinístico
editorial PT-BR caso OPENROUTER_API_KEY esteja ausente ou sem rede.
"""

from __future__ import annotations

import json
import logging
import re
import unicodedata
from typing import Any, Literal

import httpx

from backend.core.config import StudioSettings
from backend.models.briefing import Briefing, RecommendedFormat
from backend.models.preset import (
    FormatType,
    HookType,
    ImageProvider,
    SceneStatus,
    SceneTemplate,
    StylePreset,
    TransitionIn,
)
from backend.models.project import ProjectManifest
from backend.models.scene import Scene, SceneAsset, SceneBeat, SceneTiming, SceneVisual, SfxCue
from backend.models.script import (
    CoverSpec,
    DistributionPack,
    HookOption,
    NarrationSegment,
    Script,
    ScriptureRef,
    SegmentRole,
)
from backend.models.storyboard import Storyboard
from backend.models.validation import assert_no_placeholders, find_placeholder_match
from backend.services.alignment_service import normalize_biblical_text, tokenize_display_text

logger = logging.getLogger(__name__)

_OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
_OPENROUTER_MODEL = "google/gemini-2.5-flash"

# Sinais lexicais para classificação dos 4 Formatos-Série Vox Bíblico
_FORMAT_SIGNALS: dict[FormatType, tuple[str, ...]] = {
    FormatType.PERDIDO_TRADUCAO: (
        "grego",
        "hebraico",
        "aramaico",
        "traducao",
        "traduz",
        "original",
        "palavra",
        "termo",
        "significa",
        "significado",
        "makarios",
        "shalom",
        "metanoia",
        "agape",
        "hesed",
        "bem-aventurado",
        "raiz",
        "idioma",
    ),
    FormatType.MAPA_CONTEXTO: (
        "mapa",
        "cidade",
        "distancia",
        "km",
        "quilometro",
        "rota",
        "viagem",
        "imperio",
        "roma",
        "babilonia",
        "cafarnaum",
        "jerusalem",
        "galileia",
        "arqueologia",
        "geografia",
        "deserto",
        "samaria",
        "egito",
        "judeia",
        "regiao",
        "caminho",
        "paulo",
    ),
    FormatType.MITO_VS_TEXTO: (
        "mito",
        "nunca disse",
        "nao esta na biblia",
        "mentira",
        "erro",
        "cliche",
        "atribuida",
        "frase",
        "interpretam errado",
        "fora de contexto",
        "distorcida",
        "falso",
        "popular",
        "verdade",
        "acham que",
        "errado",
    ),
    FormatType.CONEXAO_AT_NT: (
        "profecia",
        "antigo testamento",
        "novo testamento",
        "paralelo",
        "simbolo",
        "sombra",
        "cumprimento",
        "pascoa",
        "cordeiro",
        "tabernaculo",
        "cruz",
        "exodo",
        "isaias",
        "salmo",
        "genesis",
        "conexao",
        "aponta para",
        "prefigura",
        "alianca",
        "parabola",
        "filho prodigo",
    ),
}

_FORMAT_RATIONALES: dict[FormatType, str] = {
    FormatType.PERDIDO_TRADUCAO: (
        "O núcleo do tema depende da nuance linguística do texto original (grego/hebraico) "
        "em contraste com o sentido moderno em português."
    ),
    FormatType.MAPA_CONTEXTO: (
        "A clareza da passagem ganha força com localização geográfica, rotas e contexto histórico "
        "do primeiro século ou do Antigo Oriente."
    ),
    FormatType.MITO_VS_TEXTO: (
        "O gancho funciona melhor desmontando uma leitura popular distorcida e revelando o que o "
        "texto bíblico realmente afirma no contexto."
    ),
    FormatType.CONEXAO_AT_NT: (
        "O tema revela paralelos profundos entre promessas, símbolos ou narrativas do Antigo e do "
        "Novo Testamento que iluminam o Evangelho."
    ),
}

_INLINE_REF_RE = re.compile(
    r"\b(?:[123]\s*)?(?:Gênesis|Genesis|Êxodo|Exodo|Levítico|Levitico|Números|Numeros|"
    r"Deuteronômio|Deuteronomio|Josué|Josue|Juízes|Juizes|Rute|Samuel|Reis|Crônicas|Cronicas|"
    r"Esdras|Neemias|Ester|Jó|Salmos?|Provérbios|Proverbios|Eclesiastes|Isaías|Isaias|"
    r"Jeremias|Ezequiel|Daniel|Jonas|Mateus|Marcos|Lucas|João|Joao|Atos|Romanos|"
    r"Coríntios|Corintios|Gálatas|Galatas|Efésios|Efesios|Filipenses|Colossenses|"
    r"Tessalonicenses|Timóteo|Timoteo|Hebreus|Tiago|Pedro|Judas|Apocalipse|"
    r"Gn|Ex|Sl|Pv|Is|Mt|Mc|Lc|Jo|At|Rm|1Co|2Co|Gl|Ef|Fp|Hb|Tg|Ap)\s+\d{1,3}(?::\d{1,3}(?:[-–]\d{1,3})?)?",
    re.IGNORECASE,
)


def _fold_text(text: str) -> str:
    nfkd = unicodedata.normalize("NFKD", text.lower())
    return "".join(ch for ch in nfkd if not unicodedata.combining(ch))


def slugify_title(title: str) -> str:
    """Converte título em slug válido (`^[a-z0-9][a-z0-9_-]*$`)."""
    folded = _fold_text(title)
    cleaned = re.sub(r"[^a-z0-9]+", "-", folded).strip("-")
    if not cleaned:
        cleaned = "video-vox"
    return cleaned[:48].rstrip("-") or "video-vox"


def _clamp_hook_words(text: str, max_words: int = 8) -> str:
    words = text.strip().split()
    if len(words) <= max_words:
        return " ".join(words)
    clipped = " ".join(words[:max_words]).rstrip(",;:")
    if clipped and clipped[-1] not in ".!?":
        clipped += "."
    return clipped


def _extract_reference(briefing: Briefing) -> str:
    if briefing.seed_reference and briefing.seed_reference.strip():
        return briefing.seed_reference.strip()
    match = _INLINE_REF_RE.search(briefing.raw_idea)
    if match:
        return match.group(0).strip()
    return "Mateus 5:3"


def _extract_topic_phrase(raw_idea: str, max_words: int = 5) -> str:
    cleaned = re.sub(r"^(explicar|mostrar|falar|ensinar|sobre|a|o)\s+", "", raw_idea.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"^(que|como)\s+", "", cleaned, flags=re.IGNORECASE)
    words = [w.strip(".,;:!?\"'()") for w in cleaned.split() if w.strip(".,;:!?\"'()")]
    if not words:
        return "esta passagem bíblica"
    return " ".join(words[:max_words])


def _split_raw_sentences(text: str) -> list[str]:
    """Divide texto livre em frases preservando referências bíblicas com ':'."""
    sentences: list[str] = []
    for block in re.split(r"\n+", text.strip()):
        cleaned_block = re.sub(r"\s+", " ", block).strip()
        if not cleaned_block:
            continue
        parts = re.split(r"(?<=[.!?])\s+", cleaned_block)
        for part in parts:
            item = part.strip()
            if item:
                sentences.append(item)
    return sentences


def _is_ready_script(raw_idea: str) -> bool:
    """Identifica quando o usuário forneceu um roteiro completo (>2 frases) em vez de uma ideia curta."""
    sentences = _split_raw_sentences(raw_idea)
    word_count = len(raw_idea.split())
    return len(sentences) >= 3 or word_count >= 28


def _split_long_sentence(sentence: str, max_words: int = 16) -> list[str]:
    """Quebra frases longas em trechos menores para manter o ritmo de legendas 9:16."""
    words = sentence.split()
    if len(words) <= max_words:
        return [sentence]

    clauses = [c.strip() for c in re.split(r"(?<=[,;:])\s+", sentence) if c.strip()]
    chunks: list[str] = []
    current = ""
    for clause in clauses:
        candidate = f"{current} {clause}".strip() if current else clause
        if len(candidate.split()) <= max_words:
            current = candidate
        else:
            if current:
                chunks.append(current)
            if len(clause.split()) <= max_words:
                current = clause
            else:
                clause_words = clause.split()
                total_cw = len(clause_words)
                # Divide em partes equilibradas (sem deixar palavras órfãs < 5 palavras no final)
                num_parts = max(2, (total_cw + max_words - 1) // max_words)
                step = (total_cw + num_parts - 1) // num_parts
                for idx in range(0, total_cw, step):
                    chunks.append(" ".join(clause_words[idx : idx + step]))
                current = ""
    if current:
        chunks.append(current)
    return chunks or [sentence]


def _classify_segment_role(text: str, index: int, total: int) -> SegmentRole:
    if index == 0:
        return SegmentRole.HOOK
    lower = _fold_text(text)
    has_cta_kw = any(
        kw in lower
        for kw in ("comenta", "salva", "compartilha", "inscreva", "proximo video")
    )
    if has_cta_kw:
        return SegmentRole.CTA
    if index == total - 1:
        if "?" in text:
            return SegmentRole.CTA
        return SegmentRole.APPLICATION
    if total >= 4 and index == total - 2:
        return SegmentRole.APPLICATION
    if re.match(r"^(mas|porem|todavia|so que|na verdade|acontece que|presta atencao|olha so)\b", lower):
        return SegmentRole.PIVOT
    return SegmentRole.BODY


def _coalesce_short_pieces(pieces: list[str], *, min_words: int = 5, max_merged_words: int = 20) -> list[str]:
    """Elimina fragmentos órfãos de 1–4 palavras (ex.: 'devia.', 'precisado dela.') fundindo com vizinhos."""
    if len(pieces) <= 1:
        return pieces

    merged: list[str] = []
    idx = 0
    while idx < len(pieces):
        piece = pieces[idx].strip()
        w_count = len(piece.split())
        if w_count < min_words:
            if merged and len(merged[-1].split()) + w_count <= max_merged_words:
                merged[-1] = f"{merged[-1]} {piece}".strip()
                idx += 1
                continue
            if idx + 1 < len(pieces) and w_count + len(pieces[idx + 1].split()) <= max_merged_words:
                pieces[idx + 1] = f"{piece} {pieces[idx + 1]}".strip()
                idx += 1
                continue
        merged.append(piece)
        idx += 1

    # Segunda passada caso o último pedaço ainda tenha ficado órfão (< min_words)
    if len(merged) >= 2 and len(merged[-1].split()) < min_words:
        merged[-2] = f"{merged[-2]} {merged[-1]}".strip()
        merged.pop()
    return merged


def _build_segments_from_ready_script(raw_idea: str) -> list[tuple[str, SegmentRole, str]]:
    """Segmenta um roteiro pronto preservando seu texto original sem criar fragmentos órfãos de 1–4 palavras."""
    sentences = _split_raw_sentences(raw_idea)
    pieces: list[str] = []
    for sentence in sentences:
        pieces.extend(_split_long_sentence(sentence, max_words=16))
    pieces = _coalesce_short_pieces(pieces, min_words=5, max_merged_words=20)

    total = len(pieces)
    return [
        (f"seg_{idx + 1:02d}", _classify_segment_role(piece, idx, total), piece)
        for idx, piece in enumerate(pieces)
    ]


def _extract_json_block(raw_content: str) -> dict[str, Any]:
    text = raw_content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("Resposta LLM não contém objeto JSON válido.")
    return json.loads(text[start : end + 1])


def _call_openrouter_json(
    *,
    system_prompt: str,
    user_payload: dict[str, Any],
    settings: StudioSettings,
    timeout_sec: float = 12.0,
) -> dict[str, Any] | None:
    """Chama OpenRouter com contexto isolado e timeout curto; nunca loga chaves."""
    if settings.openrouter_api_key is None:
        return None

    api_key = settings.openrouter_api_key.get_secret_value()
    if not api_key:
        return None

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:8740",
        "X-Title": "Studio Video Vox Biblico",
    }
    body = {
        "model": _OPENROUTER_MODEL,
        "temperature": 0.4,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
        ],
    }

    try:
        with httpx.Client(timeout=timeout_sec) as client:
            resp = client.post(_OPENROUTER_URL, headers=headers, json=body)
            resp.raise_for_status()
            data = resp.json()
        choices = data.get("choices") or []
        if not choices:
            return None
        content = choices[0].get("message", {}).get("content", "")
        if not content:
            return None
        return _extract_json_block(content)
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as exc:
        logger.warning("Chamada OpenRouter indisponível (%s); acionando fallback editorial local.", type(exc).__name__)
        return None


def recommend_format(
    raw_idea: str,
    seed_reference: str | None,
    preset: StylePreset,
) -> RecommendedFormat:
    """Recomenda 1 dos 4 Formatos-Série com confidence e rationale em PT-BR."""
    combined = _fold_text(f"{raw_idea} {seed_reference or ''}")
    scores: dict[FormatType, int] = {fmt: 0 for fmt in FormatType}
    matched_terms: dict[FormatType, list[str]] = {fmt: [] for fmt in FormatType}

    for fmt, keywords in _FORMAT_SIGNALS.items():
        for kw in keywords:
            if kw in combined:
                weight = 2 if len(kw) >= 6 else 1
                scores[fmt] += weight
                matched_terms[fmt].append(kw)

    best_fmt = max(scores, key=lambda f: scores[f])
    best_score = scores[best_fmt]

    if best_score == 0:
        # Heurística de desempate editorial coerente
        if seed_reference and seed_reference.strip():
            best_fmt = FormatType.CONEXAO_AT_NT
            confidence = 0.78
            rationale = (
                f"A referência {seed_reference.strip()} abre um arco narrativo forte para conectar "
                "contexto bíblico, mensagem central e aplicação prática no estilo Vox."
            )
        else:
            best_fmt = FormatType.MITO_VS_TEXTO
            confidence = 0.75
            rationale = _FORMAT_RATIONALES[best_fmt]
    else:
        confidence = min(0.96, round(0.76 + best_score * 0.04, 2))
        spec = preset.get_format_spec(best_fmt)
        signals_preview = ", ".join(matched_terms[best_fmt][:3])
        rationale = (
            f"Série '{spec.label}' recomendada pelos sinais ({signals_preview}). "
            f"{_FORMAT_RATIONALES[best_fmt]}"
        )

    return RecommendedFormat(
        format_type=best_fmt,
        confidence=confidence,
        rationale=rationale,
    )


def _build_local_script(briefing: Briefing, preset: StylePreset) -> Script:
    """Gerador determinístico editorial PT-BR no padrão Vox Bíblico (3 hooks <=8 palavras, ~40s)."""
    fmt = briefing.selected_format_type
    ref = _extract_reference(briefing)
    topic = _extract_topic_phrase(briefing.raw_idea, max_words=5)
    translation = briefing.bible_translation
    spec = preset.get_format_spec(fmt)

    if fmt == FormatType.PERDIDO_TRADUCAO:
        hooks = [
            HookOption(
                id="hook_1",
                hook_type=HookType.TRADUCAO,
                spoken_text=_clamp_hook_words(f"Uma palavra muda tudo em {ref}."),
                visual_interrupt="Rasgo de papel revelando o termo original com marca-texto dourado Vox.",
            ),
            HookOption(
                id="hook_2",
                hook_type=HookType.PARADOXO,
                spoken_text=_clamp_hook_words("Você leu esse versículo pela metade."),
                visual_interrupt="Carimbo terracota sobre o sentido raso em fundo carvão editorial.",
            ),
            HookOption(
                id="hook_3",
                hook_type=HookType.MITO,
                spoken_text=_clamp_hook_words("Essa tradução esconde um detalhe vital."),
                visual_interrupt="Palavra moderna riscada e substituída pelo termo bíblico original.",
            ),
        ]
    elif fmt == FormatType.MAPA_CONTEXTO:
        hooks = [
            HookOption(
                id="hook_1",
                hook_type=HookType.MAPA,
                spoken_text=_clamp_hook_words(f"O mapa explica o segredo de {ref}."),
                visual_interrupt="Zoom rápido em mapa editorial com pino terracota destacando o local.",
            ),
            HookOption(
                id="hook_2",
                hook_type=HookType.PARADOXO,
                spoken_text=_clamp_hook_words("Esse detalhe geográfico muda a história."),
                visual_interrupt="Rota histórica traçada em dourado sobre pergaminho texturizado.",
            ),
            HookOption(
                id="hook_3",
                hook_type=HookType.MITO,
                spoken_text=_clamp_hook_words("Quase ninguém olha onde isso aconteceu."),
                visual_interrupt="Recorte de mapa antigo surgindo com sombra e som de rasgo.",
            ),
        ]
    elif fmt == FormatType.MITO_VS_TEXTO:
        hooks = [
            HookOption(
                id="hook_1",
                hook_type=HookType.MITO,
                spoken_text=_clamp_hook_words("A Bíblia não diz o que repetem."),
                visual_interrupt="Carimbo terracota 'MITO' caindo sobre a frase popular distorcida.",
            ),
            HookOption(
                id="hook_2",
                hook_type=HookType.PARADOXO,
                spoken_text=_clamp_hook_words(f"Leia {ref} sem o clichê popular."),
                visual_interrupt="Rasgo de papel revelando o versículo exato com marca-texto dourado.",
            ),
            HookOption(
                id="hook_3",
                hook_type=HookType.TRADUCAO,
                spoken_text=_clamp_hook_words("O contexto corrige essa frase famosa."),
                visual_interrupt="Cartão de versículo inclinado destacando a palavra-chave no centro.",
            ),
        ]
    else:  # CONEXAO_AT_NT
        hooks = [
            HookOption(
                id="hook_1",
                hook_type=HookType.PARADOXO,
                spoken_text=_clamp_hook_words(f"Olha o detalhe oculto em {ref}."),
                visual_interrupt="Linha do tempo conectando Antigo e Novo Testamento em dourado Vox.",
            ),
            HookOption(
                id="hook_2",
                hook_type=HookType.MAPA,
                spoken_text=_clamp_hook_words("Essa história liga toda a Bíblia."),
                visual_interrupt="Recorte editorial de pergaminho com seta ligando promessa e cumprimento.",
            ),
            HookOption(
                id="hook_3",
                hook_type=HookType.MITO,
                spoken_text=_clamp_hook_words("Você já reparou nesse detalhe central?"),
                visual_interrupt="Cartão de contraste em carvão revelando o foco real da passagem.",
            ),
        ]

    selected_hook = hooks[0]
    if _is_ready_script(briefing.raw_idea):
        segment_drafts = _build_segments_from_ready_script(briefing.raw_idea)
        if segment_drafts:
            first_hook_text = _clamp_hook_words(segment_drafts[0][2], 8)
            if first_hook_text:
                hooks[0] = hooks[0].model_copy(update={"spoken_text": first_hook_text})
                selected_hook = hooks[0]
    else:
        segment_drafts = [
            ("seg_01", SegmentRole.HOOK, selected_hook.spoken_text),
            ("seg_02", SegmentRole.BODY, f"Quando olhamos para {topic}, quase sempre passamos rápido demais pelo texto."),
            ("seg_03", SegmentRole.BODY, f"Mas abra comigo exatamente em {ref} na tradução {translation}."),
            ("seg_04", SegmentRole.PIVOT, "É aqui que a leitura rasa cai por terra diante do contexto."),
            ("seg_05", SegmentRole.BODY, f"Na série {spec.label}, cada detalhe histórico revela a intenção do autor."),
            ("seg_06", SegmentRole.PIVOT, "Presta atenção na virada que o próprio texto constrói logo depois."),
            ("seg_07", SegmentRole.BODY, "Deus não está falando de aparência externa, mas de transformação real do coração."),
            ("seg_08", SegmentRole.BODY, "Esse ensino aponta diretamente para a graça e o caráter fiel de Cristo."),
            ("seg_09", SegmentRole.APPLICATION, "Quando você entende o texto no contexto, sua fé ganha raiz profunda."),
            ("seg_10", SegmentRole.CTA, "Qual passagem bíblica você quer que eu explique no próximo vídeo?"),
        ]

    narration_segments = [
        NarrationSegment(
            segment_id=sid,
            role=role,
            display_text=display,
            tts_text=normalize_biblical_text(display).replace("\n", " "),
        )
        for sid, role, display in segment_drafts
    ]

    scripture_refs = [
        ScriptureRef(
            ref_id="ref_01",
            citation=ref,
            translation=translation,
            exact_text=f"[Conferir texto exato de {ref} ({translation}) antes da aprovação do Gate 1.]",
            verified_by_human=False,
        )
    ]

    series_tag = f"#{re.sub(r'[^a-z0-9]+', '', _fold_text(spec.label))}"
    ref_tag = f"#{re.sub(r'[^a-z0-9]+', '', _fold_text(ref))}"
    cover_words = [w.upper() for w in re.findall(r"[A-Za-zÀ-ÿ0-9]+", topic)][:3]
    headline = " ".join(cover_words) if cover_words else "O TEXTO REVELA"
    highlight_word = cover_words[-1] if cover_words else "REVELA"

    shorts_title = f"{ref}: {briefing.raw_idea.strip()}"
    if len(shorts_title) > 58:
        shorts_title = shorts_title[:55].rstrip(" ,;:-") + "..."

    distribution_pack = DistributionPack(
        shorts_title=shorts_title,
        caption_reels_tiktok=(
            f"O contexto de {ref} muda a forma como lemos essa passagem. "
            "Salva este estudo e comenta qual texto quer ver no próximo episódio."
        ),
        hashtags=["#pastorandrebezerra", "#estudobiblico", series_tag, ref_tag],
        pinned_comment=(
            f"Texto base: {ref} ({translation}). "
            "Qual passagem ou palavra bíblica você quer que eu explique no próximo vídeo?"
        ),
        cover_spec=CoverSpec(
            headline=headline,
            subheadline=f"{ref.upper()} · {spec.label.upper()}",
            highlight_word=highlight_word,
        ),
    )

    return Script(
        selected_hook_id=selected_hook.id,
        hooks=hooks,
        narration_segments=narration_segments,
        scripture_refs=scripture_refs,
        distribution_pack=distribution_pack,
    )


def generate_script(
    briefing: Briefing,
    preset: StylePreset,
    *,
    settings: StudioSettings,
    use_llm: bool = True,
) -> tuple[Script, Literal["llm", "local"]]:
    """Gera script.json usando contexto isolado (briefing + resumo do formato) com fallback local."""
    if use_llm and settings.openrouter_api_key is not None:
        format_spec = preset.get_format_spec(briefing.selected_format_type)
        system_prompt = (
            "Você é roteirista editorial do canal Pastor André Bezerra (estilo Vox Bíblico 9:16, PT-BR). "
            "Responda APENAS JSON válido no contrato script.json: "
            "selected_hook_id, hooks (exatamente 3 hooks com <= 8 palavras em spoken_text), "
            "narration_segments (8 a 10 segmentos curtos de 6 a 14 palavras para ideia curta, "
            "ou quantos segmentos forem necessários caso o usuário forneça um roteiro pronto), "
            "scripture_refs (ao menos 1 referência com verified_by_human=false), "
            "distribution_pack (shorts_title <= 60 chars, caption_reels_tiktok, hashtags, pinned_comment, cover_spec). "
            "IMPORTANTE: Se briefing.raw_idea já contiver um roteiro pronto (mais de 2 frases ou múltiplos parágrafos), "
            "preserve fielmente a mensagem, argumentos, ordem e voz pastoral do texto fornecido, "
            "apenas ajustando o ritmo e dividindo em narration_segments naturais (>= 5 palavras cada, sem fragmentos de 1–3 palavras). "
            "NUNCA escreva placeholders como '[Conferir...]', '[TODO]', 'TBD' ou '[Inserir...]' em nenhum campo. "
            "Em scripture_refs[].exact_text escreva o versículo bíblico real na tradução solicitada. "
            "Sem saudações genéricas."
        )
        # Contexto estritamente isolado: apenas briefing + resumo do formato-série
        isolated_payload = {
            "briefing": briefing.model_dump(mode="json"),
            "format_spec": format_spec.model_dump(mode="json"),
            "channel_handle": preset.channel_handle,
            "target_duration_sec": briefing.target_duration_sec,
        }
        llm_data = _call_openrouter_json(
            system_prompt=system_prompt,
            user_payload=isolated_payload,
            settings=settings,
        )
        if llm_data is not None:
            try:
                candidate = Script.model_validate(llm_data)
                # Garante invariantes editoriais (<= 8 palavras nos hooks, tts normalizado, verified_by_human=False)
                fixed_hooks = [
                    h.model_copy(update={"spoken_text": _clamp_hook_words(h.spoken_text, 8)})
                    for h in candidate.hooks[:3]
                ]
                fixed_segments = [
                    s.model_copy(
                        update={"tts_text": normalize_biblical_text(s.tts_text or s.display_text).replace("\n", " ")}
                    )
                    for s in candidate.narration_segments
                ]
                fixed_refs = [
                    r.model_copy(update={"verified_by_human": False})
                    for r in candidate.scripture_refs
                ]
                if not fixed_refs:
                    ref = _extract_reference(briefing)
                    fixed_refs = [
                        ScriptureRef(
                            ref_id="ref_01",
                            citation=ref,
                            translation=briefing.bible_translation,
                            exact_text=f"[Conferir texto exato de {ref} ({briefing.bible_translation}).]",
                            verified_by_human=False,
                        )
                    ]
                selected_id = (
                    candidate.selected_hook_id
                    if any(h.id == candidate.selected_hook_id for h in fixed_hooks)
                    else fixed_hooks[0].id
                )
                return (
                    candidate.model_copy(
                        update={
                            "selected_hook_id": selected_id,
                            "hooks": fixed_hooks,
                            "narration_segments": fixed_segments,
                            "scripture_refs": fixed_refs,
                        }
                    ),
                    "llm",
                )
            except ValueError as exc:
                logger.warning("Saída LLM rejeitada pelo Pydantic (%s); usando fallback local.", exc)

    return _build_local_script(briefing, preset), "local"


def refine_script(
    script: Script,
    briefing: Briefing,
    preset: StylePreset,
    *,
    target: Literal["hooks", "segments", "distribution"],
    instruction: str,
    settings: StudioSettings,
    use_llm: bool = True,
) -> tuple[Script, Literal["llm", "local"]]:
    """Refina pontualmente apenas o alvo selecionado (contexto mínimo do nó)."""
    clean_instruction = instruction.strip()
    if not clean_instruction:
        raise ValueError("instruction não pode ser vazia.")

    if use_llm and settings.openrouter_api_key is not None:
        target_data: Any
        if target == "hooks":
            target_data = [h.model_dump(mode="json") for h in script.hooks]
            expected_key = "hooks"
        elif target == "segments":
            target_data = [s.model_dump(mode="json") for s in script.narration_segments]
            expected_key = "narration_segments"
        else:
            target_data = script.distribution_pack.model_dump(mode="json")
            expected_key = "distribution_pack"

        system_prompt = (
            "Você está refinando pontualmente um único nó do roteiro Vox Bíblico (PT-BR). "
            f"Retorne APENAS JSON com a chave '{expected_key}' atualizada conforme a instrução. "
            "Se target='hooks', mantenha 3 hooks com spoken_text <= 8 palavras."
        )
        # Contexto mínimo: somente o trecho do alvo + instrução + referência
        isolated_payload = {
            "target": target,
            "instruction": clean_instruction,
            "format_type": briefing.selected_format_type.value,
            "seed_reference": briefing.seed_reference,
            expected_key: target_data,
        }
        llm_data = _call_openrouter_json(
            system_prompt=system_prompt,
            user_payload=isolated_payload,
            settings=settings,
        )
        if llm_data is not None and expected_key in llm_data:
            try:
                if target == "hooks":
                    refined_hooks = [
                        HookOption.model_validate(h).model_copy(
                            update={"spoken_text": _clamp_hook_words(h["spoken_text"], 8)}
                        )
                        for h in llm_data["hooks"][:3]
                    ]
                    sel = (
                        script.selected_hook_id
                        if any(h.id == script.selected_hook_id for h in refined_hooks)
                        else refined_hooks[0].id
                    )
                    return script.model_copy(update={"hooks": refined_hooks, "selected_hook_id": sel}), "llm"
                if target == "segments":
                    refined_segs = [
                        NarrationSegment.model_validate(s).model_copy(
                            update={"tts_text": normalize_biblical_text(s.get("tts_text") or s["display_text"]).replace("\n", " ")}
                        )
                        for s in llm_data["narration_segments"]
                    ]
                    return script.model_copy(update={"narration_segments": refined_segs}), "llm"
                refined_dist = DistributionPack.model_validate(llm_data["distribution_pack"])
                return script.model_copy(update={"distribution_pack": refined_dist}), "llm"
            except (ValueError, KeyError, TypeError) as exc:
                logger.warning("Refino LLM inválido (%s); aplicando refino editorial local.", exc)

    # Fallback determinístico local coerente com a instrução
    folded_inst = _fold_text(clean_instruction)
    ref = _extract_reference(briefing)

    if target == "hooks":
        is_provocative = any(k in folded_inst for k in ("diret", "forte", "provoc", "impact", "curt", "tens"))
        is_question = any(k in folded_inst for k in ("pergunt", "curios", "duvid"))
        new_hooks: list[HookOption] = []
        for idx, hook in enumerate(script.hooks):
            if is_question:
                templates = (
                    f"Por que ignoram esse detalhe em {ref}?",
                    "Você realmente entendeu o que Jesus disse?",
                    f"O que ninguém te contou sobre {ref}?",
                )
                spoken = _clamp_hook_words(templates[idx % len(templates)], 8)
            elif is_provocative:
                templates = (
                    f"Pare de ler {ref} fora de contexto.",
                    "Esse detalhe muda sua leitura inteira.",
                    "A leitura rápida esconde a verdade central.",
                )
                spoken = _clamp_hook_words(templates[idx % len(templates)], 8)
            else:
                # Enxuga e torna mais incisivo mantendo <= 8 palavras
                base_words = [w for w in hook.spoken_text.split() if len(w) > 0]
                spoken = _clamp_hook_words(" ".join(base_words[:6]) + " — veja agora.", 8)
            new_hooks.append(hook.model_copy(update={"spoken_text": spoken}))

        # Sincroniza o segmento de hook com o hook selecionado
        selected = next((h for h in new_hooks if h.id == script.selected_hook_id), new_hooks[0])
        updated_segments = list(script.narration_segments)
        if updated_segments and updated_segments[0].role == SegmentRole.HOOK:
            updated_segments[0] = updated_segments[0].model_copy(
                update={
                    "display_text": selected.spoken_text,
                    "tts_text": normalize_biblical_text(selected.spoken_text).replace("\n", " "),
                }
            )
        return (
            script.model_copy(update={"hooks": new_hooks, "narration_segments": updated_segments}),
            "local",
        )

    if target == "segments":
        updated_segments = []
        for seg in script.narration_segments:
            display = seg.display_text.strip()
            if seg.role == SegmentRole.PIVOT and "mais" in folded_inst:
                display = f"Mas escute bem: {display[0].lower() + display[1:]}" if display else display
            elif seg.role == SegmentRole.APPLICATION and any(k in folded_inst for k in ("pratic", "aplic", "diret")):
                display = "Leve essa verdade hoje: a Palavra corrige o olhar e firma o coração."
            elif seg.role == SegmentRole.CTA and any(k in folded_inst for k in ("coment", "cta", "engaj")):
                display = "Comenta agora qual versículo você quer destravar no próximo episódio."
            updated_segments.append(
                seg.model_copy(
                    update={
                        "display_text": display,
                        "tts_text": normalize_biblical_text(display).replace("\n", " "),
                    }
                )
            )
        return script.model_copy(update={"narration_segments": updated_segments}), "local"

    # target == "distribution"
    dist = script.distribution_pack
    new_title = dist.shorts_title
    if len(new_title) > 54 or "curt" in folded_inst:
        new_title = f"{ref}: a leitura que muda tudo"
    elif "pergunt" in folded_inst and not new_title.endswith("?"):
        new_title = f"Você já leu {ref} desse jeito?"
    else:
        new_title = f"{ref} — {dist.cover_spec.headline.title()}"[:58]

    updated_dist = dist.model_copy(
        update={
            "shorts_title": new_title,
            "caption_reels_tiktok": (
                f"{dist.caption_reels_tiktok.strip()} ({clean_instruction[:60]})"
                if len(dist.caption_reels_tiktok) < 180
                else dist.caption_reels_tiktok
            ),
        }
    )
    return script.model_copy(update={"distribution_pack": updated_dist}), "local"


def _pick_headline_from_tokens(tokens: list[str], fallback: str, max_words: int = 4) -> str:
    stop = {
        "de", "da", "do", "das", "dos", "e", "em", "na", "no", "o", "a", "os", "as",
        "que", "um", "uma", "para", "com", "por", "se", "ao", "aos", "ele", "ela",
        "mas", "pois", "como", "mais", "seu", "sua", "seus", "suas", "esse", "essa",
        "aquele", "aquela", "isso", "isto", "foi", "era", "tem", "ter", "nao",
    }
    salient = [t.upper() for t in tokens if _fold_text(t) not in stop and len(t) >= 3]
    chosen = salient[:max_words] if len(salient) >= 2 else [t.upper() for t in tokens[:max_words]]
    return " ".join(chosen) if chosen else fallback


def _group_segments_into_scene_blocks(
    segment_word_ranges: list[tuple[NarrationSegment, list[tuple[str, str]]]],
    *,
    target_duration_sec: int,
) -> list[list[tuple[NarrationSegment, list[tuple[str, str]]]]]:
    """Agrupa segmentos narrativos em blocos fluidos de ~4s a 8s (jamais 1 frase curta = 1 cena).

    - Vídeos curtos (~35–48s, <=125 palavras): ~8–10 cenas (~10–15 palavras cada).
    - Vídeos médios/longos (~55–90s, >125 palavras): ~10–14 cenas (~14–24 palavras cada).
    - Garante zero micro-cenas (< 6 palavras) preservando 100% contiguidade de word_id.
    """
    if len(segment_word_ranges) <= 1:
        return [segment_word_ranges] if segment_word_ranges else []

    total_words = sum(len(pairs) for _, pairs in segment_word_ranges)
    est_duration_sec = max(float(target_duration_sec), total_words / 2.85)

    if total_words <= 125:
        desired_scenes = max(1, min(10, int(round(est_duration_sec / 4.4))))
        min_scene_words = 6
        target_words = max(9, int(round(total_words / desired_scenes)))
        max_scene_words = max(target_words + 5, 16)
    else:
        desired_scenes = max(10, min(14, int(round(est_duration_sec / 6.2))))
        min_scene_words = 10
        target_words = max(14, int(round(total_words / desired_scenes)))
        max_scene_words = max(target_words + 7, int(round(target_words * 1.45)))

    # Se o número de segmentos já cabe no orçamento e nenhum é micro-segmento (<6 palavras), mantém blocos naturais
    all_substantial = all(len(pairs) >= 6 for _, pairs in segment_word_ranges)
    if total_words <= 125 and len(segment_word_ranges) <= desired_scenes + 1 and all_substantial:
        return [[item] for item in segment_word_ranges]

    blocks: list[list[tuple[NarrationSegment, list[tuple[str, str]]]]] = []
    current: list[tuple[NarrationSegment, list[tuple[str, str]]]] = []
    current_words = 0

    for idx, item in enumerate(segment_word_ranges):
        seg, pairs = item
        seg_words = len(pairs)

        if not current:
            current.append(item)
            current_words = seg_words
            continue

        is_hook_block = idx == 1 and current[0][0].role == SegmentRole.HOOK
        if is_hook_block and current_words >= 6 and (total_words <= 125 or current_words >= 9):
            blocks.append(current)
            current = [item]
            current_words = seg_words
            continue

        is_narrative_turn = seg.role in (
            SegmentRole.PIVOT,
            SegmentRole.APPLICATION,
            SegmentRole.CTA,
        )
        if is_narrative_turn and current_words >= min_scene_words:
            blocks.append(current)
            current = [item]
            current_words = seg_words
            continue

        if current_words < target_words and (current_words + seg_words) <= max_scene_words:
            current.append(item)
            current_words += seg_words
            continue

        if seg_words < 6 and (current_words + seg_words) <= max_scene_words + 4:
            current.append(item)
            current_words += seg_words
            continue

        blocks.append(current)
        current = [item]
        current_words = seg_words

    if current:
        blocks.append(current)

    # Pós-passagem inviolável: nenhum bloco pode ter < 6 palavras (evita micro-cenas)
    idx = len(blocks) - 1
    while idx > 0:
        w_cnt = sum(len(pairs) for _, pairs in blocks[idx])
        if w_cnt < 6:
            blocks[idx - 1].extend(blocks[idx])
            blocks.pop(idx)
        idx -= 1

    if len(blocks) > 1 and sum(len(pairs) for _, pairs in blocks[0]) < 6:
        blocks[1] = blocks[0] + blocks[1]
        blocks.pop(0)

    # Se ainda exceder 14 cenas em vídeos longos, consolida os dois blocos adjacentes mais curtos
    while total_words > 125 and len(blocks) > 14:
        best_i = min(
            range(len(blocks) - 1),
            key=lambda i: (
                sum(len(p) for _, p in blocks[i]) + sum(len(p) for _, p in blocks[i + 1])
            ),
        )
        blocks[best_i].extend(blocks[best_i + 1])
        blocks.pop(best_i + 1)

    return blocks


_COMPOSITION_VISUAL_ACTIONS: dict[str, tuple[str, str, str]] = {
    "debt_scale": ("weigh_debt", "tilt_scale", "balance_shift"),
    "forgiveness_seal": ("reveal_decree", "strike_debt", "wax_seal"),
    "dramatic_split": ("open_left", "reveal_right", "contrast_lock"),
    "rhetorical_question": ("pose_question", "underline_tension", "echo_pause"),
    "grace_illumination": ("warm_dawn", "expand_rays", "anchor_truth"),
    "narrative_arc": ("arc_step_1", "arc_step_2", "arc_climax"),
    "counter_impact": ("count_up", "peak_impact", "settle_weight"),
    "scripture_spotlight": ("open_reference", "highlight_clause", "hold_reflection"),
}


def _infer_composition(
    block_text: str,
    roles: list[SegmentRole],
    idx: int,
    total_blocks: int,
    *,
    has_clean_ref: bool,
    prev_composition: str | None,
) -> Literal[
    "debt_scale",
    "forgiveness_seal",
    "dramatic_split",
    "rhetorical_question",
    "grace_illumination",
    "narrative_arc",
    "counter_impact",
    "scripture_spotlight",
]:
    folded = _fold_text(block_text)
    candidates: list[
        Literal[
            "debt_scale",
            "forgiveness_seal",
            "dramatic_split",
            "rhetorical_question",
            "grace_illumination",
            "narrative_arc",
            "counter_impact",
            "scripture_spotlight",
        ]
    ] = []

    if "?" in block_text:
        candidates.append("rhetorical_question")
    if any(kw in folded for kw in ("perdo", "cancel", "livre", "liberd", "absolv")):
        candidates.append("forgiveness_seal")
    if any(kw in folded for kw in ("divid", "pagar", "cobranc", "balanc", "quantia", "peso", "talento", "denario")):
        candidates.append("debt_scale")
    if any(kw in folded for kw in ("graca", "misericord", "cristo", "jesus", "amor", "luz", "esperanc")):
        candidates.append("grace_illumination")
    if re.search(r"\b\d+\b", folded) or any(kw in folded for kw in ("tanto", "mil", "milhoes", "impagavel")):
        candidates.append("counter_impact")
    if SegmentRole.PIVOT in roles or any(kw in folded for kw in ("mas ", "porem", "enquanto", "ao inves", "contraste")):
        candidates.append("dramatic_split")
    if has_clean_ref and idx in (3, max(2, total_blocks // 2)):
        candidates.append("scripture_spotlight")
    if idx == total_blocks or SegmentRole.APPLICATION in roles or SegmentRole.CTA in roles:
        candidates.append("narrative_arc")

    rotation: tuple[
        Literal[
            "debt_scale",
            "forgiveness_seal",
            "dramatic_split",
            "rhetorical_question",
            "grace_illumination",
            "narrative_arc",
            "counter_impact",
            "scripture_spotlight",
        ],
        ...,
    ] = (
        "counter_impact",
        "narrative_arc",
        "dramatic_split",
        "rhetorical_question",
        "grace_illumination",
        "debt_scale",
        "forgiveness_seal",
        "scripture_spotlight",
    )
    for cand in candidates:
        if cand != prev_composition:
            return cand
    fallback = rotation[(idx - 1) % len(rotation)]
    if fallback == prev_composition:
        fallback = rotation[idx % len(rotation)]
    return fallback


def _build_scene_beats(
    block: list[tuple[NarrationSegment, list[tuple[str, str]]]],
    *,
    composition: str,
    scene_idx: int,
    subtext_fallback: str,
) -> list[SceneBeat]:
    """Cria 2–3 beats internos ancorados em word_id para garantir evolução visual contínua sem cortes secos."""
    all_pairs = [pair for _, pairs in block for pair in pairs]
    total_words = len(all_pairs)
    if total_words < 4:
        return []

    actions = _COMPOSITION_VISUAL_ACTIONS.get(composition, ("reveal", "develop", "resolve"))
    emphases: tuple[Literal["gold", "terracotta", "navy", "light"], ...] = (
        "gold",
        "terracotta",
        "light",
    )
    shifts: tuple[Literal["push_in", "pan_right", "tilt_drama", "settle"], ...] = (
        "push_in",
        "pan_right",
        "settle",
    )

    beats: list[SceneBeat] = []
    if len(block) >= 2:
        # Até 3 beats ancorados nos segmentos reais agrupados na cena
        chosen_segs = block[:3]
        if len(block) > 3:
            chosen_segs = [block[0], block[len(block) // 2], block[-1]]

        word_pos_map = {wid: pos for pos, (wid, _) in enumerate(all_pairs)}
        for b_idx, (seg, seg_pairs) in enumerate(chosen_segs, start=1):
            anchor_wid = seg_pairs[0][0]
            pos = word_pos_map.get(anchor_wid, 0)
            prog = round(pos / max(1, total_words), 3)
            tokens_seg = [tok for _, tok in seg_pairs]
            beat_headline = _pick_headline_from_tokens(tokens_seg, f"MOMENTO {b_idx}", max_words=4)
            emphasis: Literal["gold", "terracotta", "navy", "light"] = (
                "terracotta" if seg.role == SegmentRole.PIVOT else emphases[(b_idx - 1) % len(emphases)]
            )
            cam_shift: Literal["push_in", "pan_right", "tilt_drama", "settle"] = (
                "tilt_drama" if seg.role == SegmentRole.PIVOT else shifts[(b_idx - 1) % len(shifts)]
            )
            beats.append(
                SceneBeat(
                    beat_id=f"s{scene_idx:02d}_b{b_idx}",
                    anchor_word_id=anchor_wid,
                    progress=prog,
                    headline=beat_headline,
                    subtext=subtext_fallback if b_idx == 1 else None,
                    emphasis=emphasis,
                    visual_action=actions[(b_idx - 1) % len(actions)],
                    camera_shift=cam_shift,
                )
            )
        return beats

    # Bloco com 1 segmento longo (>= 8 palavras): gera 2 beats fluidos (início e virada no meio)
    if total_words >= 8:
        mid_idx = total_words // 2
        first_tokens = [tok for _, tok in all_pairs[:mid_idx]]
        second_tokens = [tok for _, tok in all_pairs[mid_idx:]]
        beats.append(
            SceneBeat(
                beat_id=f"s{scene_idx:02d}_b1",
                anchor_word_id=all_pairs[0][0],
                progress=0.0,
                headline=_pick_headline_from_tokens(first_tokens, f"CENA {scene_idx:02d}", max_words=4),
                subtext=subtext_fallback,
                emphasis="gold",
                visual_action=actions[0],
                camera_shift="push_in",
            )
        )
        beats.append(
            SceneBeat(
                beat_id=f"s{scene_idx:02d}_b2",
                anchor_word_id=all_pairs[mid_idx][0],
                progress=round(mid_idx / total_words, 3),
                headline=_pick_headline_from_tokens(second_tokens, f"CENA {scene_idx:02d}", max_words=4),
                subtext=None,
                emphasis="terracotta" if block[0][0].role == SegmentRole.PIVOT else "light",
                visual_action=actions[1],
                camera_shift="settle",
            )
        )
    return beats


def generate_storyboard_and_scenes(
    *,
    manifest: ProjectManifest,
    briefing: Briefing,
    script: Script,
    preset: StylePreset,
) -> tuple[Storyboard, list[Scene]]:
    """Gera storyboard.json + scenes/scene_01..XX.json agrupados em blocos fluidos (4–8s) com multi-beats."""
    format_spec = preset.get_format_spec(briefing.selected_format_type)
    series_label = f"{format_spec.label.upper()} · EP. {manifest.series.episode_number:02d}"
    first_ref = script.scripture_refs[0] if script.scripture_refs else None

    # Bloqueio Fail-Fast anti-placeholder antes de compor storyboard/cenas
    for ref in script.scripture_refs:
        if ref.verified_by_human:
            assert_no_placeholders(
                ref.exact_text,
                field_path=f"scripture_refs[{ref.ref_id}].exact_text",
            )
    has_clean_ref = (
        first_ref is not None and find_placeholder_match(first_ref.exact_text) is None
    )

    # Constrói mapeamento exato segmento -> fatia de word_id (100% compatível com align_audio_to_script)
    segment_word_ranges: list[tuple[NarrationSegment, list[tuple[str, str]]]] = []
    word_cursor = 0
    for seg in script.narration_segments:
        assert_no_placeholders(seg.display_text, field_path=f"narration_segments[{seg.segment_id}].display_text")
        tokens = tokenize_display_text(seg.display_text)
        if not tokens:
            continue
        pairs: list[tuple[str, str]] = []
        for tok in tokens:
            word_cursor += 1
            pairs.append((f"w_{word_cursor:04d}", tok))
        segment_word_ranges.append((seg, pairs))

    if not segment_word_ranges:
        raise ValueError("Roteiro sem palavras tokenizáveis para gerar cenas.")

    scene_blocks = _group_segments_into_scene_blocks(
        segment_word_ranges,
        target_duration_sec=briefing.target_duration_sec,
    )
    total_blocks = len(scene_blocks)

    camera_cycle = (
        "cinematic_push",
        "editorial_glide",
        "beat_reactive",
        "subtle_zoom_in",
        "subtle_pan_right",
    )
    transition_cycle = (
        TransitionIn.STAMP_DROP,
        TransitionIn.EDITORIAL_WIPE,
        TransitionIn.CROSS_MOTION,
        TransitionIn.PAPER_TEAR,
        TransitionIn.ZOOM_THROUGH,
        TransitionIn.INK_WASH,
        TransitionIn.WHIP_PAN,
    )
    atmosphere_by_theme: dict[str, Literal["warm_paper", "dramatic_spotlight", "grace_glow", "ink_vignette"]] = {
        "pergaminho": "warm_paper",
        "carvao": "dramatic_spotlight",
        "azul_marinho": "ink_vignette",
    }

    scenes: list[Scene] = []
    prev_template: SceneTemplate | None = None
    prev_composition: str | None = None

    for idx, block in enumerate(scene_blocks, start=1):
        scene_id = f"scene_{idx:02d}"
        word_pairs = [pair for _, pairs in block for pair in pairs]
        roles = [seg.role for seg, _ in block]
        block_text = " ".join(seg.display_text for seg, _ in block)
        start_wid = word_pairs[0][0]
        end_wid = word_pairs[-1][0]
        mid_wid = word_pairs[len(word_pairs) // 2][0]
        tokens_only = [tok for _, tok in word_pairs]

        composition = _infer_composition(
            block_text,
            roles,
            idx,
            total_blocks,
            has_clean_ref=has_clean_ref,
            prev_composition=prev_composition,
        )

        # Seleção editorial rica: privilegia editorial_motion variando composições + paper_collage / timeline_map / kinetic / quote limpo
        if idx == 1:
            template = SceneTemplate.EDITORIAL_MOTION
        elif composition == "scripture_spotlight" and has_clean_ref and prev_template != SceneTemplate.BIBLE_QUOTE_CARD:
            template = SceneTemplate.EDITORIAL_MOTION if idx % 2 == 0 else SceneTemplate.BIBLE_QUOTE_CARD
        elif (
            briefing.selected_format_type in (FormatType.MAPA_CONTEXTO, FormatType.CONEXAO_AT_NT)
            and idx % 4 == 2
            and prev_template != SceneTemplate.TIMELINE_MAP
        ):
            template = SceneTemplate.TIMELINE_MAP
        elif idx % 4 == 0 and prev_template != SceneTemplate.PAPER_COLLAGE:
            template = SceneTemplate.PAPER_COLLAGE
        elif SegmentRole.CTA in roles and idx == total_blocks and prev_template != SceneTemplate.KINETIC_CAPTIONS:
            template = SceneTemplate.EDITORIAL_MOTION
        else:
            template = SceneTemplate.EDITORIAL_MOTION

        prev_template = template
        prev_composition = composition

        if template == SceneTemplate.BIBLE_QUOTE_CARD:
            bg_theme = "pergaminho"
        elif template == SceneTemplate.TIMELINE_MAP:
            bg_theme = "azul_marinho" if idx % 2 == 0 else "pergaminho"
        elif composition in ("grace_illumination", "forgiveness_seal", "scripture_spotlight"):
            bg_theme = "pergaminho"
        elif composition in ("rhetorical_question", "counter_impact") or idx == 1:
            bg_theme = "carvao"
        else:
            bg_theme = "carvao" if idx % 2 == 1 else "pergaminho"

        atmosphere: Literal["warm_paper", "dramatic_spotlight", "grace_glow", "ink_vignette"] = (
            "grace_glow"
            if composition in ("grace_illumination", "forgiveness_seal")
            else "dramatic_spotlight"
            if bg_theme == "carvao"
            else atmosphere_by_theme.get(bg_theme, "warm_paper")
        )

        headline = _pick_headline_from_tokens(tokens_only, f"CENA {idx:02d}", max_words=4)
        subtext = (
            series_label
            if idx == 1
            else f"{first_ref.citation.upper()} · {first_ref.translation}"
            if (template == SceneTemplate.BIBLE_QUOTE_CARD or composition == "scripture_spotlight") and has_clean_ref and first_ref
            else format_spec.label.upper()
        )

        if idx == 1:
            transition = TransitionIn.STAMP_DROP
            sfx_id = "stamp_drop_01"
            offset_ms = 0
            gain_db = -5.0
        else:
            transition = transition_cycle[idx % len(transition_cycle)]
            if transition == TransitionIn.PAPER_TEAR:
                sfx_id = "paper_tear_01"
                offset_ms = -50
                gain_db = -6.0
            elif transition in (TransitionIn.EDITORIAL_WIPE, TransitionIn.INK_WASH):
                sfx_id = "page_flip_01"
                offset_ms = -40
                gain_db = -6.5
            elif transition == TransitionIn.STAMP_DROP:
                sfx_id = "stamp_drop_01"
                offset_ms = 0
                gain_db = -6.0
            else:
                sfx_id = "editorial_click_01"
                offset_ms = 0
                gain_db = -7.0

        assets: list[SceneAsset] = []
        if template == SceneTemplate.PAPER_COLLAGE:
            assets.append(
                SceneAsset(
                    asset_id=f"img_{scene_id}_collage",
                    provider=ImageProvider.GEMINI_HYBRID,
                    prompt=(
                        f"Editorial Vox style paper collage cutout illustrating '{headline.lower()}' "
                        f"in biblical historical context ({first_ref.citation if first_ref else 'Bible'}), "
                        "warm sepia engraving texture, torn paper edges, isolated on plain cream background, "
                        "no modern readable text"
                    ),
                    apply_rembg=True,
                    cache_relpath=None,
                    sha256=None,
                )
            )

        beats = _build_scene_beats(
            block,
            composition=composition,
            scene_idx=idx,
            subtext_fallback=subtext,
        )
        highlight_ids = [mid_wid]
        if beats and beats[-1].anchor_word_id and beats[-1].anchor_word_id not in highlight_ids:
            highlight_ids.append(beats[-1].anchor_word_id)

        motion_data: dict[str, Any] = {}
        if has_clean_ref and first_ref and (
            composition == "scripture_spotlight" or template == SceneTemplate.BIBLE_QUOTE_CARD
        ):
            motion_data["reference"] = first_ref.citation
            motion_data["translation"] = first_ref.translation
            motion_data["quote_ref"] = f"{first_ref.citation} ({first_ref.translation})"
        if composition == "dramatic_split" and len(block) >= 2:
            left_lbl = _pick_headline_from_tokens([t for _, t in block[0][1]], "ANTES", max_words=3)
            right_lbl = _pick_headline_from_tokens([t for _, t in block[-1][1]], "DEPOIS", max_words=3)
            motion_data["top_title"] = left_lbl
            motion_data["bottom_title"] = right_lbl
            motion_data["divider_symbol"] = "VS"
        elif composition == "narrative_arc" and idx == total_blocks:
            motion_data["show_handle_end"] = True

        linked_ref_id = (
            first_ref.ref_id
            if has_clean_ref
            and first_ref is not None
            and (template == SceneTemplate.BIBLE_QUOTE_CARD or composition == "scripture_spotlight")
            else None
        )

        visual = SceneVisual(
            background_theme=bg_theme,
            headline=headline,
            subtext=subtext,
            highlight_word_ids=highlight_ids,
            transition_in=transition,
            camera_motion=camera_cycle[(idx - 1) % len(camera_cycle)],
            scripture_ref_id=linked_ref_id,
            stamp_text="MITO" if briefing.selected_format_type == FormatType.MITO_VS_TEXTO and idx == 2 else None,
            series_label=series_label if idx in (1, total_blocks) else None,
            composition=composition if template == SceneTemplate.EDITORIAL_MOTION else "auto",
            atmosphere=atmosphere,
            beats=beats,
            motion_data=motion_data,
        )

        scenes.append(
            Scene(
                scene_id=scene_id,
                order=idx,
                status=SceneStatus.DRAFT,
                tier=1,
                template=template,
                template_version="2.0.0" if template == SceneTemplate.EDITORIAL_MOTION else "1.0.0",
                timing=SceneTiming(
                    start_word_id=start_wid,
                    end_word_id=end_wid,
                ),
                visual=visual,
                assets=assets,
                sfx_cues=[
                    SfxCue(
                        sfx_id=sfx_id,
                        anchor_word_id=start_wid,
                        offset_ms=offset_ms,
                        gain_db=gain_db,
                    )
                ],
                review_pins=[],
                cache_hash=None,
                cost_usd=0.0,
            )
        )

    storyboard = Storyboard(
        fps=preset.video.fps,
        width=preset.video.width,
        height=preset.video.height,
        music_track="music/tracks/editorial_contemplative_01.wav",
        music_enabled=True,
        captions_enabled=True,
        scene_ids=[s.scene_id for s in scenes],
    )
    return storyboard, scenes
