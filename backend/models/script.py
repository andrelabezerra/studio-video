"""Contrato Pydantic para projects/<slug>/script.json."""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.models.preset import HookType


class SegmentRole(StrEnum):
    HOOK = "hook"
    BODY = "body"
    PIVOT = "pivot"
    APPLICATION = "application"
    CTA = "cta"


class HookOption(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    hook_type: HookType
    spoken_text: str = Field(min_length=1)
    visual_interrupt: str = Field(min_length=1)


class NarrationSegment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    segment_id: str = Field(min_length=1)
    role: SegmentRole
    display_text: str = Field(min_length=1)
    tts_text: str = Field(min_length=1)


class ScriptureRef(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ref_id: str = Field(min_length=1)
    citation: str = Field(min_length=1)
    translation: str = Field(default="NVI", min_length=1)
    exact_text: str = Field(min_length=1)
    verified_by_human: bool = False


class CoverSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    headline: str = Field(min_length=1)
    subheadline: str = ""
    highlight_word: str | None = None


class DistributionPack(BaseModel):
    model_config = ConfigDict(extra="forbid")

    shorts_title: str = Field(min_length=1)
    caption_reels_tiktok: str = Field(min_length=1)
    hashtags: list[str] = Field(default_factory=list)
    pinned_comment: str = ""
    cover_spec: CoverSpec


class Script(BaseModel):
    model_config = ConfigDict(extra="forbid")

    selected_hook_id: str = Field(min_length=1)
    hooks: list[HookOption] = Field(min_length=1)
    narration_segments: list[NarrationSegment] = Field(min_length=1)
    scripture_refs: list[ScriptureRef] = Field(default_factory=list)
    distribution_pack: DistributionPack

    @model_validator(mode="after")
    def _validate_integrity(self) -> Script:
        hook_ids = [h.id for h in self.hooks]
        if len(hook_ids) != len(set(hook_ids)):
            raise ValueError("IDs duplicados encontrados em hooks[].")
        if self.selected_hook_id not in hook_ids:
            raise ValueError(
                f"selected_hook_id '{self.selected_hook_id}' não existe em hooks[]: {hook_ids}."
            )

        segment_ids = [s.segment_id for s in self.narration_segments]
        if len(segment_ids) != len(set(segment_ids)):
            raise ValueError("segment_id duplicados encontrados em narration_segments[].")

        ref_ids = [r.ref_id for r in self.scripture_refs]
        if len(ref_ids) != len(set(ref_ids)):
            raise ValueError("ref_id duplicados encontrados em scripture_refs[].")
        return self

    def all_scripture_verified(self) -> bool:
        """Retorna True se todas as referências bíblicas tiverem validação humana."""
        return all(ref.verified_by_human for ref in self.scripture_refs)

    def get_scripture_ref(self, ref_id: str) -> ScriptureRef:
        for ref in self.scripture_refs:
            if ref.ref_id == ref_id:
                return ref
        raise KeyError(f"Referência bíblica não encontrada: {ref_id}")
