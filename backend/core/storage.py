"""Leitura e escrita atômica dos contratos JSON em projects/<slug>/."""

from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path
from typing import TypeVar

from pydantic import BaseModel

from backend.core.config import WORKSPACE_ROOT
from backend.models.audio import AudioAlignment
from backend.models.briefing import Briefing
from backend.models.project import ProjectManifest
from backend.models.scene import Scene
from backend.models.script import Script
from backend.models.storyboard import Storyboard

ModelT = TypeVar("ModelT", bound=BaseModel)
_SAFE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


def _validate_id(value: str, label: str) -> str:
    if not _SAFE_ID_RE.match(value):
        raise ValueError(f"{label} inválido: '{value}'.")
    return value


def atomic_write_text(path: Path, content: str, *, encoding: str = "utf-8") -> Path:
    """Grava texto atomicamente usando tempfile na mesma pasta + os.replace."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding=encoding,
            dir=target.parent,
            prefix=f".{target.name}.",
            suffix=".tmp",
            delete=False,
        ) as tmp_file:
            tmp_path = Path(tmp_file.name)
            tmp_file.write(content)
            tmp_file.flush()
            os.fsync(tmp_file.fileno())
        os.replace(tmp_path, target)
        tmp_path = None
        return target
    finally:
        if tmp_path is not None and tmp_path.exists():
            tmp_path.unlink()


def atomic_write_model(path: Path, model: ModelT, model_cls: type[ModelT]) -> Path:
    """Valida via Pydantic e grava o modelo em JSON formatado atomicamente."""
    validated = model_cls.model_validate(model)
    payload = validated.model_dump_json(indent=2) + "\n"
    return atomic_write_text(path, payload)


def read_model(path: Path, model_cls: type[ModelT]) -> ModelT:
    """Lê e valida um arquivo JSON via Pydantic (fail-fast se ausente ou inválido)."""
    target = Path(path)
    if not target.is_file():
        raise FileNotFoundError(f"Arquivo JSON não encontrado: '{target}'.")
    raw_text = target.read_text(encoding="utf-8")
    return model_cls.model_validate_json(raw_text)


class ProjectStorage:
    """Repositório tipado para leitura/escrita atômica dos JSONs de projects/<slug>/."""

    def __init__(self, projects_root: Path | None = None) -> None:
        self.projects_root: Path = (projects_root or (WORKSPACE_ROOT / "projects")).resolve()

    def project_dir(self, slug: str) -> Path:
        _validate_id(slug, "slug")
        return self.projects_root / slug

    def scenes_dir(self, slug: str) -> Path:
        return self.project_dir(slug) / "scenes"

    def list_projects(self) -> list[str]:
        if not self.projects_root.is_dir():
            return []
        return sorted(
            entry.name
            for entry in self.projects_root.iterdir()
            if entry.is_dir() and (entry / "manifest.json").is_file()
        )

    def exists(self, slug: str, filename: str) -> bool:
        return (self.project_dir(slug) / filename).is_file()

    # --- manifest.json ---
    def load_manifest(self, slug: str) -> ProjectManifest:
        return read_model(self.project_dir(slug) / "manifest.json", ProjectManifest)

    def save_manifest(self, slug: str, manifest: ProjectManifest) -> Path:
        if manifest.slug != slug:
            raise ValueError(
                f"Slug divergente: pasta '{slug}' vs manifest.slug '{manifest.slug}'."
            )
        return atomic_write_model(
            self.project_dir(slug) / "manifest.json", manifest, ProjectManifest
        )

    # --- briefing.json ---
    def load_briefing(self, slug: str) -> Briefing:
        return read_model(self.project_dir(slug) / "briefing.json", Briefing)

    def save_briefing(self, slug: str, briefing: Briefing) -> Path:
        return atomic_write_model(
            self.project_dir(slug) / "briefing.json", briefing, Briefing
        )

    # --- script.json ---
    def load_script(self, slug: str) -> Script:
        return read_model(self.project_dir(slug) / "script.json", Script)

    def save_script(self, slug: str, script: Script) -> Path:
        return atomic_write_model(
            self.project_dir(slug) / "script.json", script, Script
        )

    # --- audio_alignment.json ---
    def load_audio_alignment(self, slug: str) -> AudioAlignment:
        return read_model(
            self.project_dir(slug) / "audio_alignment.json", AudioAlignment
        )

    def save_audio_alignment(self, slug: str, alignment: AudioAlignment) -> Path:
        return atomic_write_model(
            self.project_dir(slug) / "audio_alignment.json", alignment, AudioAlignment
        )

    # --- storyboard.json ---
    def load_storyboard(self, slug: str) -> Storyboard:
        return read_model(self.project_dir(slug) / "storyboard.json", Storyboard)

    def save_storyboard(self, slug: str, storyboard: Storyboard) -> Path:
        return atomic_write_model(
            self.project_dir(slug) / "storyboard.json", storyboard, Storyboard
        )

    # --- scenes/<scene_id>.json ---
    def load_scene(self, slug: str, scene_id: str) -> Scene:
        _validate_id(scene_id, "scene_id")
        return read_model(self.scenes_dir(slug) / f"{scene_id}.json", Scene)

    def save_scene(self, slug: str, scene: Scene) -> Path:
        _validate_id(scene.scene_id, "scene_id")
        return atomic_write_model(
            self.scenes_dir(slug) / f"{scene.scene_id}.json", scene, Scene
        )

    def load_all_scenes(
        self, slug: str, *, storyboard: Storyboard | None = None
    ) -> list[Scene]:
        """Carrega todas as cenas na ordem do storyboard (ou ordenadas por scene.order)."""
        if storyboard is not None:
            return [self.load_scene(slug, sid) for sid in storyboard.scene_ids]

        sdir = self.scenes_dir(slug)
        if not sdir.is_dir():
            raise FileNotFoundError(f"Diretório de cenas não encontrado: '{sdir}'.")
        scenes = [
            read_model(path, Scene)
            for path in sorted(sdir.glob("*.json"))
            if path.is_file()
        ]
        scenes.sort(key=lambda s: (s.order, s.scene_id))
        return scenes
