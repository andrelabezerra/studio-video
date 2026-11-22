"""Configuração local, isolamento de segredos e carregamento de Style Presets."""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from dotenv import dotenv_values
from pydantic import BaseModel, ConfigDict, Field, SecretStr

from backend.models.preset import AudioMode, ImageProvider, StylePreset

WORKSPACE_ROOT: Path = Path(__file__).resolve().parents[2]
_UNEXPANDED_WIN_VAR_RE = re.compile(r"%[^%\s]+%")
_SAFE_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


def mask_secret(value: SecretStr | str | None) -> str:
    """Retorna versão mascarada de uma credencial para uso seguro em logs."""
    raw = value.get_secret_value() if isinstance(value, SecretStr) else value
    if not raw:
        return "<unset>"
    if len(raw) <= 6:
        return "***"
    return f"{raw[:3]}***"


def _parse_bool(raw: str | None, default: bool) -> bool:
    if raw is None or raw.strip() == "":
        return default
    normalized = raw.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"Valor booleano inválido em configuração: '{raw}'.")


def _parse_float(raw: str | None, default: float, name: str) -> float:
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw.strip())
    except ValueError as exc:
        raise ValueError(f"Valor float inválido para {name}: '{raw}'.") from exc


def _parse_int(raw: str | None, default: int, name: str) -> int:
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw.strip())
    except ValueError as exc:
        raise ValueError(f"Valor inteiro inválido para {name}: '{raw}'.") from exc


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def _contains_onedrive(path: Path) -> bool:
    return any("onedrive" in part.lower() for part in path.resolve().parts)


def resolve_cache_dir(
    raw_cache_dir: str | None,
    *,
    workspace_root: Path = WORKSPACE_ROOT,
    allow_custom_cache: bool = False,
    create: bool = True,
) -> Path:
    """Expande variáveis de ambiente e valida que o cache fique fora do workspace/OneDrive."""
    candidate_raw = (raw_cache_dir or "").strip()
    if not candidate_raw:
        candidate_raw = r"%LOCALAPPDATA%\StudioVideo\cache"

    expanded = os.path.expanduser(os.path.expandvars(candidate_raw))
    if _UNEXPANDED_WIN_VAR_RE.search(expanded):
        raise ValueError(
            f"Variável de ambiente não expandida em STUDIO_CACHE_DIR: '{expanded}'."
        )

    cache_path = Path(expanded).resolve()

    if not allow_custom_cache:
        if _is_relative_to(cache_path, workspace_root):
            raise ValueError(
                f"STUDIO_CACHE_DIR ('{cache_path}') não pode ficar dentro do workspace ('{workspace_root}')."
            )
        if _contains_onedrive(cache_path):
            raise ValueError(
                f"STUDIO_CACHE_DIR ('{cache_path}') não pode residir dentro do OneDrive."
            )

    if create:
        cache_path.mkdir(parents=True, exist_ok=True)
    return cache_path


def get_voice_samples_dir(
    cache_dir: Path | StudioSettings | None = None,
    *,
    create: bool = True,
) -> Path:
    """Retorna o diretório STUDIO_CACHE_DIR/_voice_samples (isolado fora do OneDrive)."""
    if isinstance(cache_dir, StudioSettings):
        base = cache_dir.studio_cache_dir
    elif cache_dir is not None:
        base = Path(cache_dir)
    else:
        base = get_settings().studio_cache_dir
    samples_dir = base.resolve() / "_voice_samples"
    if create:
        samples_dir.mkdir(parents=True, exist_ok=True)
    return samples_dir


class StudioSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workspace_root: Path = Field(default=WORKSPACE_ROOT)
    studio_host: str = Field(default="127.0.0.1", min_length=1)
    studio_port: int = Field(default=8740, ge=1, le=65535)
    studio_cache_dir: Path
    default_preset: str = Field(default="pastor-andre-biblico", min_length=1)
    default_bible_translation: str = Field(default="NVI", min_length=1)

    tts_provider: AudioMode = AudioMode.RECORDED
    tts_voice_sample: str = "assets/voice_samples/pastor_andre.wav"
    tts_venv_python: str | None = None
    voicestudio_url: str = Field(default="http://127.0.0.1:7860", min_length=1)
    alignment_engine: str = "whisperx"
    whisper_model: str = "medium"
    whisper_device: str = "auto"

    image_provider: ImageProvider = ImageProvider.GEMINI_HYBRID
    gemini_api_key: SecretStr | None = None
    openrouter_api_key: SecretStr | None = None
    fal_key: SecretStr | None = None

    max_cost_per_scene_usd: float = Field(default=0.50, ge=0.0)
    max_cost_per_video_usd: float = Field(default=2.50, ge=0.0)
    enable_tier2_video: bool = False
    enable_fal_3d: bool = False

    def safe_summary(self) -> dict[str, Any]:
        """Resumo serializável seguro para logs (segredos mascarados)."""
        return {
            "workspace_root": str(self.workspace_root),
            "studio_host": self.studio_host,
            "studio_port": self.studio_port,
            "studio_cache_dir": str(self.studio_cache_dir),
            "default_preset": self.default_preset,
            "default_bible_translation": self.default_bible_translation,
            "tts_provider": self.tts_provider.value,
            "voicestudio_url": self.voicestudio_url,
            "alignment_engine": self.alignment_engine,
            "image_provider": self.image_provider.value,
            "gemini_api_key": mask_secret(self.gemini_api_key),
            "openrouter_api_key": mask_secret(self.openrouter_api_key),
            "fal_key": mask_secret(self.fal_key),
            "max_cost_per_scene_usd": self.max_cost_per_scene_usd,
            "max_cost_per_video_usd": self.max_cost_per_video_usd,
            "enable_tier2_video": self.enable_tier2_video,
            "enable_fal_3d": self.enable_fal_3d,
        }

    def voice_samples_dir(self, *, create: bool = True) -> Path:
        """Retorna diretório de amostras de voz fora do OneDrive (STUDIO_CACHE_DIR/_voice_samples)."""
        return get_voice_samples_dir(self.studio_cache_dir, create=create)

    def __repr__(self) -> str:
        fields = ", ".join(f"{k}={v!r}" for k, v in self.safe_summary().items())
        return f"StudioSettings({fields})"

    def __str__(self) -> str:
        return self.__repr__()


def _to_secret(raw: str | None) -> SecretStr | None:
    if raw is None:
        return None
    cleaned = raw.strip()
    return SecretStr(cleaned) if cleaned else None


def load_settings(
    *,
    env_file: Path | str | None = None,
    workspace_root: Path = WORKSPACE_ROOT,
    env_overrides: Mapping[str, str] | None = None,
    allow_custom_cache: bool = False,
    create_cache_dir: bool = True,
) -> StudioSettings:
    """Carrega configuração a partir do .env local + variáveis de ambiente."""
    resolved_workspace = Path(workspace_root).resolve()
    dotenv_path = Path(env_file) if env_file is not None else resolved_workspace / ".env"

    merged: dict[str, str] = {}
    if dotenv_path.is_file():
        for k, v in dotenv_values(dotenv_path).items():
            if v is not None:
                merged[k] = v

    for k, v in os.environ.items():
        merged[k] = v

    if env_overrides:
        for k, v in env_overrides.items():
            merged[k] = v

    cache_dir = resolve_cache_dir(
        merged.get("STUDIO_CACHE_DIR"),
        workspace_root=resolved_workspace,
        allow_custom_cache=allow_custom_cache,
        create=create_cache_dir,
    )

    tts_venv_raw = (merged.get("TTS_VENV_PYTHON") or "").strip() or None

    return StudioSettings(
        workspace_root=resolved_workspace,
        studio_host=(merged.get("STUDIO_HOST") or "127.0.0.1").strip(),
        studio_port=_parse_int(merged.get("STUDIO_PORT"), 8740, "STUDIO_PORT"),
        studio_cache_dir=cache_dir,
        default_preset=(merged.get("STUDIO_DEFAULT_PRESET") or "pastor-andre-biblico").strip(),
        default_bible_translation=(merged.get("DEFAULT_BIBLE_TRANSLATION") or "NVI").strip(),
        tts_provider=AudioMode((merged.get("TTS_PROVIDER") or "recorded").strip()),
        tts_voice_sample=(
            merged.get("TTS_VOICE_SAMPLE") or "assets/voice_samples/pastor_andre.wav"
        ).strip(),
        tts_venv_python=tts_venv_raw,
        voicestudio_url=(
            merged.get("VOICESTUDIO_URL") or "http://127.0.0.1:7860"
        ).strip().rstrip("/"),
        alignment_engine=(merged.get("ALIGNMENT_ENGINE") or "whisperx").strip(),
        whisper_model=(merged.get("WHISPER_MODEL") or "medium").strip(),
        whisper_device=(merged.get("WHISPER_DEVICE") or "auto").strip(),
        image_provider=ImageProvider((merged.get("IMAGE_PROVIDER") or "gemini_hybrid").strip()),
        gemini_api_key=_to_secret(merged.get("GEMINI_API_KEY")),
        openrouter_api_key=_to_secret(merged.get("OPENROUTER_API_KEY")),
        fal_key=_to_secret(merged.get("FAL_KEY")),
        max_cost_per_scene_usd=_parse_float(
            merged.get("MAX_COST_PER_SCENE_USD"), 0.50, "MAX_COST_PER_SCENE_USD"
        ),
        max_cost_per_video_usd=_parse_float(
            merged.get("MAX_COST_PER_VIDEO_USD"), 2.50, "MAX_COST_PER_VIDEO_USD"
        ),
        enable_tier2_video=_parse_bool(merged.get("ENABLE_TIER2_VIDEO"), False),
        enable_fal_3d=_parse_bool(merged.get("ENABLE_FAL_3D"), False),
    )


_CACHED_SETTINGS: StudioSettings | None = None


def get_settings(*, reload: bool = False) -> StudioSettings:
    """Retorna instância singleton de StudioSettings (recarregável com reload=True)."""
    global _CACHED_SETTINGS
    if _CACHED_SETTINGS is None or reload:
        _CACHED_SETTINGS = load_settings()
    return _CACHED_SETTINGS


def load_preset(
    preset_id: str = "pastor-andre-biblico",
    *,
    presets_dir: Path | None = None,
) -> StylePreset:
    """Carrega e valida config/style_presets/<preset_id>.json via Pydantic."""
    if not _SAFE_ID_RE.match(preset_id):
        raise ValueError(f"preset_id inválido: '{preset_id}'.")

    base_dir = presets_dir or (WORKSPACE_ROOT / "config" / "style_presets")
    preset_path = (base_dir / f"{preset_id}.json").resolve()
    if not _is_relative_to(preset_path, base_dir):
        raise ValueError(f"Tentativa de path traversal em preset_id: '{preset_id}'.")
    if not preset_path.is_file():
        raise FileNotFoundError(f"Preset não encontrado: '{preset_path}'.")

    raw_json = preset_path.read_text(encoding="utf-8")
    return StylePreset.model_validate_json(raw_json)
