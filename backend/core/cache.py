"""Hashing determinístico SHA-256 e helpers de diretórios em STUDIO_CACHE_DIR."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from backend.core.config import get_settings
from backend.models.scene import Scene

_SAFE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
_VOLATILE_SCENE_FIELDS = frozenset({"cache_hash", "status", "review_pins"})


def sha256_bytes(data: bytes) -> str:
    """Calcula digest SHA-256 hexadecimal de bytes."""
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path | str, *, chunk_size: int = 65536) -> str:
    """Calcula SHA-256 streaming de um arquivo em disco (fail-fast se não existir)."""
    file_path = Path(path)
    if not file_path.is_file():
        raise FileNotFoundError(f"Arquivo não encontrado para SHA-256: '{file_path}'.")
    digest = hashlib.sha256()
    with file_path.open("rb") as fh:
        while chunk := fh.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_json_bytes(data: Any) -> bytes:
    """Serializa modelos Pydantic ou estruturas JSON de forma canônica e determinística."""
    normalized: Any
    if isinstance(data, BaseModel):
        normalized = data.model_dump(mode="json")
    else:
        normalized = data
    serialized = json.dumps(
        normalized,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    return serialized.encode("utf-8")


def sha256_json(data: Any) -> str:
    """Calcula SHA-256 sobre a representação JSON canônica de um objeto."""
    return sha256_bytes(canonical_json_bytes(data))


def _normalize_scene_spec(scene_spec: Scene | Mapping[str, Any]) -> dict[str, Any]:
    raw_dict = (
        scene_spec.model_dump(mode="json")
        if isinstance(scene_spec, BaseModel)
        else dict(scene_spec)
    )
    return {k: v for k, v in raw_dict.items() if k not in _VOLATILE_SCENE_FIELDS}


def _normalize_asset_hashes(
    asset_hashes: Sequence[str] | Mapping[str, str],
) -> dict[str, str] | list[str]:
    if isinstance(asset_hashes, Mapping):
        return {str(k): str(v) for k, v in sorted(asset_hashes.items())}
    return [str(item) for item in asset_hashes]


def compute_scene_cache_hash(
    template_version: str,
    scene_spec: Scene | Mapping[str, Any],
    asset_hashes: Sequence[str] | Mapping[str, str],
    audio_slice_hash: str,
) -> str:
    """Calcula chave SHA-256 granular por cena conforme docs/ARQUITETURA.md."""
    if not template_version.strip():
        raise ValueError("template_version não pode ser vazio.")
    if not audio_slice_hash.strip():
        raise ValueError("audio_slice_hash não pode ser vazio.")

    payload = {
        "template_version": template_version,
        "scene": _normalize_scene_spec(scene_spec),
        "asset_hashes": _normalize_asset_hashes(asset_hashes),
        "audio_slice_hash": audio_slice_hash,
    }
    return sha256_json(payload)


def _validate_identifier(value: str, label: str) -> str:
    if not _SAFE_ID_RE.match(value):
        raise ValueError(f"{label} inválido: '{value}'.")
    return value


@dataclass(frozen=True, slots=True)
class ProjectCachePaths:
    """Caminhos de cache isolados fora do OneDrive em STUDIO_CACHE_DIR/<slug>/."""

    slug: str
    root: Path
    scenes: Path
    audio: Path
    assets: Path
    renders: Path
    qa: Path
    thumbs: Path

    def ensure_dirs(self) -> ProjectCachePaths:
        for directory in (
            self.root,
            self.scenes,
            self.audio,
            self.assets,
            self.renders,
            self.qa,
            self.thumbs,
        ):
            directory.mkdir(parents=True, exist_ok=True)
        return self

    def scene_video_path(
        self,
        scene_id: str,
        *,
        profile: str = "final",
        cache_hash: str | None = None,
    ) -> Path:
        _validate_identifier(scene_id, "scene_id")
        _validate_identifier(profile, "profile")
        suffix = f"_{cache_hash[:12]}" if cache_hash else ""
        return self.scenes / f"{scene_id}_{profile}{suffix}.mp4"

    def scene_thumb_path(
        self,
        scene_id: str,
        cache_hash: str | None = None,
    ) -> Path:
        _validate_identifier(scene_id, "scene_id")
        suffix = f"_{cache_hash[:12]}" if cache_hash else ""
        return self.thumbs / f"{scene_id}{suffix}.jpg"

    def final_video_path(self, *, profile: str = "final") -> Path:
        _validate_identifier(profile, "profile")
        filename = "final_9x16.mp4" if profile == "final" else f"{profile}_9x16.mp4"
        return self.renders / filename

    def contact_sheet_path(self, *, profile: str = "final") -> Path:
        _validate_identifier(profile, "profile")
        filename = "contact_sheet.jpg" if profile == "final" else f"contact_sheet_{profile}.jpg"
        return self.qa / filename

    def resolve_relpath(self, relpath: str) -> Path:
        """Resolve caminho relativo dentro do cache do projeto bloqueando path traversal."""
        if not relpath or relpath.strip() == "":
            raise ValueError("relpath não pode ser vazio.")
        candidate = (self.root / relpath).resolve()
        try:
            candidate.relative_to(self.root.resolve())
        except ValueError as exc:
            raise ValueError(
                f"Caminho fora do diretório de cache do projeto: '{relpath}'."
            ) from exc
        return candidate


def get_project_cache(
    slug: str,
    *,
    cache_root: Path | None = None,
    ensure: bool = True,
) -> ProjectCachePaths:
    """Retorna estrutura de caminhos de cache em STUDIO_CACHE_DIR/<slug>/."""
    _validate_identifier(slug, "slug")
    base = (cache_root or get_settings().studio_cache_dir).resolve()
    root = base / slug
    paths = ProjectCachePaths(
        slug=slug,
        root=root,
        scenes=root / "scenes",
        audio=root / "audio",
        assets=root / "assets",
        renders=root / "renders",
        qa=root / "qa",
        thumbs=root / "thumbs",
    )
    if ensure:
        paths.ensure_dirs()
    return paths
