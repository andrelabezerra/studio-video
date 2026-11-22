"""Exports públicos do núcleo operacional (config, storage, cache)."""

from backend.core.cache import (
    ProjectCachePaths,
    canonical_json_bytes,
    compute_scene_cache_hash,
    get_project_cache,
    sha256_bytes,
    sha256_file,
    sha256_json,
)
from backend.core.config import (
    WORKSPACE_ROOT,
    StudioSettings,
    get_settings,
    load_preset,
    load_settings,
    mask_secret,
    resolve_cache_dir,
)
from backend.core.storage import (
    ProjectStorage,
    atomic_write_model,
    atomic_write_text,
    read_model,
)

__all__ = [
    "ProjectCachePaths",
    "ProjectStorage",
    "StudioSettings",
    "WORKSPACE_ROOT",
    "atomic_write_model",
    "atomic_write_text",
    "canonical_json_bytes",
    "compute_scene_cache_hash",
    "get_project_cache",
    "get_settings",
    "load_preset",
    "load_settings",
    "mask_secret",
    "read_model",
    "resolve_cache_dir",
    "sha256_bytes",
    "sha256_file",
    "sha256_json",
]
