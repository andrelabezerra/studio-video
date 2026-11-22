"""Validações Fail-Fast anti-placeholder e anti-selo burocrático para contratos do Studio Video."""

from __future__ import annotations

import re
import unicodedata
from typing import Any

# Padrões inequívocos de rascunho/placeholder que JAMAIS podem vazar para Gate 1, cenas ou vídeo final.
# Atenção PT-BR: NÃO casa a palavra comum "todo"/"TODO" fora de delimitadores de marcador de tarefa
# (ex.: "PERDOOU TODO O DÉBITO" é 100% válido).
_PLACEHOLDER_PATTERNS: tuple[re.Pattern[str], ...] = (
    # Colchetes com instruções editoriais (ex.: [Conferir texto exato...], [TODO...], [Inserir...])
    re.compile(
        r"\[\s*(?:conferir|verificar|revisar|inserir|preencher|adicionar|completar|"
        r"placeholder|rascunho|texto\s+exato|vers[ií]culo|cita[cç][aã]o|"
        r"todo|tbd|fixme|pendente|editar)\b[^\]]*\]",
        re.IGNORECASE,
    ),
    # Marcadores TODO/FIXME/TBD com pontuação ou delimitadores explícitos
    re.compile(r"(?:^|[\s(\[])(?:TODO|FIXME)\s*(?::|\s[-–]\s|\)|\])"),
    re.compile(r"(?:^|[\s(\[])TBD(?:\b|[\s:)\]])", re.IGNORECASE),
    # Tokens de template não substituídos ({{var}} ou <<<var>>>)
    re.compile(r"\{\{[^}]+\}\}"),
    re.compile(r"<<<[^>]+>>>"),
    # Texto fictício
    re.compile(r"\blorem\s+ipsum\b", re.IGNORECASE),
)

_FORBIDDEN_STAMPS: frozenset[str] = frozenset(
    {
        "texto verificado",
        "versiculo verificado",
        "citacao verificada",
    }
)


def _fold_norm(text: str) -> str:
    nfkd = unicodedata.normalize("NFKD", text.strip().lower())
    no_accents = "".join(ch for ch in nfkd if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", no_accents)


def find_placeholder_match(text: str | None) -> str | None:
    """Retorna o trecho de placeholder encontrado ou None se o texto estiver limpo."""
    if not text or not isinstance(text, str):
        return None
    for pattern in _PLACEHOLDER_PATTERNS:
        match = pattern.search(text)
        if match:
            return match.group(0).strip()
    return None


def is_forbidden_bureaucratic_stamp(text: str | None) -> bool:
    """Identifica selos burocráticos rejeitados pelo padrão editorial Vox Bíblico."""
    if not text or not isinstance(text, str):
        return False
    folded = _fold_norm(text)
    return folded in _FORBIDDEN_STAMPS


def collect_placeholder_errors(value: Any, *, field_path: str) -> list[str]:
    """Percorre recursivamente strings, listas e dicts coletando violações de placeholder."""
    errors: list[str] = []
    if isinstance(value, str):
        found = find_placeholder_match(value)
        if found is not None:
            errors.append(
                f"Placeholder proibido detectado em '{field_path}': '{found}'. "
                "Substitua por conteúdo editorial/bíblico real antes de aprovar ou renderizar."
            )
    elif isinstance(value, dict):
        for key, item in value.items():
            errors.extend(collect_placeholder_errors(item, field_path=f"{field_path}.{key}"))
    elif isinstance(value, (list, tuple)):
        for idx, item in enumerate(value):
            errors.extend(collect_placeholder_errors(item, field_path=f"{field_path}[{idx}]"))
    return errors


def assert_no_placeholders(value: Any, *, field_path: str) -> None:
    """Falha imediatamente (Fail-Fast) com ValueError se houver qualquer placeholder em `value`."""
    errors = collect_placeholder_errors(value, field_path=field_path)
    if errors:
        raise ValueError(errors[0])
