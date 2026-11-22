"""Contrato Pydantic para projects/<slug>/audio_alignment.json."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend.models.preset import AudioMode


class WordTiming(BaseModel):
    model_config = ConfigDict(extra="forbid")

    word_id: str = Field(min_length=1)
    segment_id: str = Field(min_length=1)
    text: str = Field(min_length=1)
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)

    @model_validator(mode="after")
    def _validate_interval(self) -> WordTiming:
        if self.start_ms > self.end_ms:
            raise ValueError(
                f"WordTiming '{self.word_id}' inválido: start_ms ({self.start_ms}) > end_ms ({self.end_ms})."
            )
        return self


class AudioAlignment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    audio_source: AudioMode
    audio_cache_relpath: str = Field(min_length=1)
    audio_sha256: str = Field(min_length=1)
    sample_rate_hz: int = Field(gt=0)
    duration_ms: int = Field(gt=0)
    alignment_engine: str = Field(min_length=1)
    words: list[WordTiming] = Field(min_length=1)

    @model_validator(mode="after")
    def _validate_words(self) -> AudioAlignment:
        seen: set[str] = set()
        prev_start = -1
        for word in self.words:
            if word.word_id in seen:
                raise ValueError(f"word_id duplicado em audio_alignment: '{word.word_id}'.")
            seen.add(word.word_id)
            if word.start_ms < prev_start:
                raise ValueError(
                    f"Palavras fora de ordem temporal em '{word.word_id}': "
                    f"start_ms ({word.start_ms}) < anterior ({prev_start})."
                )
            if word.end_ms > self.duration_ms:
                raise ValueError(
                    f"Palavra '{word.word_id}' excede duration_ms: "
                    f"end_ms ({word.end_ms}) > duration_ms ({self.duration_ms})."
                )
            prev_start = word.start_ms
        return self

    def get_word(self, word_id: str) -> WordTiming:
        for word in self.words:
            if word.word_id == word_id:
                return word
        raise KeyError(f"word_id não encontrado no alinhamento: '{word_id}'.")

    def get_word_range(self, start_word_id: str, end_word_id: str) -> list[WordTiming]:
        """Retorna a fatia contígua [start_word_id..end_word_id] (inclusiva)."""
        index_by_id = {w.word_id: idx for idx, w in enumerate(self.words)}
        if start_word_id not in index_by_id:
            raise KeyError(f"start_word_id não encontrado: '{start_word_id}'.")
        if end_word_id not in index_by_id:
            raise KeyError(f"end_word_id não encontrado: '{end_word_id}'.")
        start_idx = index_by_id[start_word_id]
        end_idx = index_by_id[end_word_id]
        if start_idx > end_idx:
            raise ValueError(
                f"Intervalo de palavras invertido: '{start_word_id}' (idx {start_idx}) > "
                f"'{end_word_id}' (idx {end_idx})."
            )
        return self.words[start_idx : end_idx + 1]
