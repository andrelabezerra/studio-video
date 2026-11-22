"""Contrato Pydantic para projects/<slug>/storyboard.json."""

from __future__ import annotations

import re

from pydantic import BaseModel, ConfigDict, Field, model_validator

_SCENE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


class Storyboard(BaseModel):
    model_config = ConfigDict(extra="forbid")

    fps: int = Field(default=30, gt=0, le=120)
    width: int = Field(default=1080, gt=0)
    height: int = Field(default=1920, gt=0)
    music_track: str | None = None
    music_enabled: bool = True
    captions_enabled: bool = True
    scene_ids: list[str] = Field(min_length=1)

    @model_validator(mode="after")
    def _validate_scene_ids(self) -> Storyboard:
        if len(self.scene_ids) != len(set(self.scene_ids)):
            raise ValueError("scene_ids duplicados encontrados em storyboard.json.")
        for sid in self.scene_ids:
            if not _SCENE_ID_RE.match(sid):
                raise ValueError(f"scene_id inválido no storyboard: '{sid}'.")
        return self
