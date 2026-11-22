"""Workers isolados de TTS neural (executados em subprocesso via TTS_VENV_PYTHON)."""

from __future__ import annotations

from pathlib import Path

WORKERS_DIR: Path = Path(__file__).resolve().parent
XTTS_WORKER_SCRIPT: Path = WORKERS_DIR / "tts_xtts_worker.py"
F5_WORKER_SCRIPT: Path = WORKERS_DIR / "tts_f5_worker.py"

__all__ = [
    "WORKERS_DIR",
    "XTTS_WORKER_SCRIPT",
    "F5_WORKER_SCRIPT",
]
