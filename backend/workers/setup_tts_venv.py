"""CLI utilitário para preparar um venv isolado de TTS neural fora do OneDrive.

Uso:
    uv run --no-sync python -m backend.workers.setup_tts_venv --engine xtts_v2 --dry-run
    uv run --no-sync python -m backend.workers.setup_tts_venv --engine f5_tts
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any

WORKSPACE_ROOT = Path(__file__).resolve().parents[2]


def _contains_onedrive(path: Path) -> bool:
    return any("onedrive" in part.lower() for part in path.resolve().parts)


def resolve_default_venv_dir() -> Path:
    raw = os.path.expandvars(r"%LOCALAPPDATA%\StudioVideo\tts-venv")
    if "%" in raw:
        return (Path.home() / ".local" / "share" / "StudioVideo" / "tts-venv").resolve()
    return Path(raw).resolve()


def _detect_cuda_available() -> bool:
    try:
        proc = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            check=False,
            timeout=3,
        )
        return proc.returncode == 0 and bool(proc.stdout.strip())
    except (OSError, subprocess.SubprocessError):
        return False


def _venv_python_path(venv_dir: Path) -> Path:
    if os.name == "nt":
        return venv_dir / "Scripts" / "python.exe"
    return venv_dir / "bin" / "python"


def build_setup_plan(
    *,
    engine: str,
    venv_dir: Path | None = None,
    with_aligner: str = "none",
    device: str = "auto",
) -> dict[str, Any]:
    if engine not in {"xtts_v2", "f5_tts"}:
        raise ValueError(f"Engine TTS não suportada para setup isolado: '{engine}'.")
    if with_aligner not in {"none", "whisperx", "stable_ts"}:
        raise ValueError(f"Alinhador não suportado: '{with_aligner}'.")

    target_dir = (venv_dir or resolve_default_venv_dir()).resolve()
    if _contains_onedrive(target_dir):
        raise ValueError(
            f"O venv isolado de TTS ('{target_dir}') não pode ficar dentro do OneDrive."
        )

    use_cuda = device == "cu121" or (device == "auto" and _detect_cuda_available())
    hardware = "cuda" if use_cuda else "cpu"
    torch_index = (
        "https://download.pytorch.org/whl/cu121"
        if use_cuda
        else "https://download.pytorch.org/whl/cpu"
    )

    venv_python = _venv_python_path(target_dir)
    uv_bin = shutil.which("uv")

    commands: list[list[str]] = []
    if uv_bin:
        commands.append(
            [uv_bin, "venv", "--allow-existing", str(target_dir), "--python", "3.11"]
        )
        pip_prefix = [uv_bin, "pip", "install", "--python", str(venv_python)]
    else:
        commands.append([sys.executable, "-m", "venv", str(target_dir)])
        pip_prefix = [str(venv_python), "-m", "pip", "install"]

    commands.append(
        [
            *pip_prefix,
            "torch>=2.5,<2.9",
            "torchaudio>=2.5,<2.9",
            "--index-url",
            torch_index,
        ]
    )

    if engine == "xtts_v2":
        commands.append(
            [
                *pip_prefix,
                "coqui-tts",
                "transformers>=4.46,<5.0",
                "huggingface-hub>=0.34.0,<1.0",
                "soundfile",
                "six",
            ]
        )
    else:
        commands.append(
            [
                *pip_prefix,
                "f5-tts",
                "datasets>=3.0.0,<4.0.0",
                "transformers>=4.46,<5.0",
                "huggingface-hub>=0.34.0,<1.0",
                "soundfile",
            ]
        )

    if with_aligner == "whisperx":
        commands.append([*pip_prefix, "whisperx"])
    elif with_aligner == "stable_ts":
        commands.append([*pip_prefix, "stable-ts"])

    return {
        "engine": engine,
        "hardware": hardware,
        "venv_dir": str(target_dir),
        "venv_python": str(venv_python),
        "with_aligner": with_aligner,
        "env_line": f"TTS_VENV_PYTHON={venv_python}",
        "commands": commands,
    }


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Prepara venv isolado (fora do OneDrive) para XTTS-v2 ou F5-TTS."
    )
    parser.add_argument(
        "--engine",
        required=True,
        choices=["xtts_v2", "f5_tts"],
        help="Motor neural a instalar no venv isolado.",
    )
    parser.add_argument(
        "--venv-dir",
        default=None,
        help=r"Diretório alvo do venv (padrão: %LOCALAPPDATA%\StudioVideo\tts-venv).",
    )
    parser.add_argument(
        "--with-aligner",
        default="none",
        choices=["none", "whisperx", "stable_ts"],
        help="Opcional: instalar também whisperx ou stable-ts no mesmo venv isolado.",
    )
    parser.add_argument(
        "--device",
        default="auto",
        choices=["auto", "cpu", "cu121"],
        help="Alvo de build do PyTorch (padrão: auto).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Exibe o plano de instalação em JSON sem criar arquivos nem baixar pacotes.",
    )
    return parser.parse_args(argv)


def persist_tts_venv_in_dotenv(
    venv_python: Path | str,
    dotenv_path: Path | None = None,
) -> Path:
    """Atualiza ou adiciona TTS_VENV_PYTHON no arquivo .env local sem tocar em outras chaves."""
    target_env = (dotenv_path or (WORKSPACE_ROOT / ".env")).resolve()
    env_line = f"TTS_VENV_PYTHON={Path(venv_python).resolve()}"
    if target_env.is_file():
        raw = target_env.read_text(encoding="utf-8")
        if re.search(r"(?m)^TTS_VENV_PYTHON=.*$", raw):
            updated = re.sub(r"(?m)^TTS_VENV_PYTHON=.*$", lambda _: env_line, raw)
        else:
            sep = "" if raw.endswith("\n") else "\n"
            updated = f"{raw}{sep}{env_line}\n"
        target_env.write_text(updated, encoding="utf-8")
    else:
        target_env.write_text(f"{env_line}\n", encoding="utf-8")
    return target_env


def _venv_has_torch(venv_python: Path) -> bool:
    if not venv_python.is_file():
        return False
    try:
        proc = subprocess.run(
            [
                str(venv_python),
                "-c",
                "import importlib.util; raise SystemExit(0 if importlib.util.find_spec('torch') and importlib.util.find_spec('torchaudio') else 1)",
            ],
            capture_output=True,
            text=True,
            check=False,
            timeout=8,
        )
        return proc.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def run_tts_venv_setup(
    *,
    engine: str,
    venv_dir: Path | None = None,
    with_aligner: str = "none",
    device: str = "auto",
    update_dotenv: bool = True,
    on_step: Callable[[int, int, str], None] | None = None,
) -> Path:
    """Executa os comandos de criação do venv isolado e instalação do motor TTS neural."""
    plan = build_setup_plan(
        engine=engine,
        venv_dir=venv_dir,
        with_aligner=with_aligner,
        device=device,
    )
    venv_py = Path(plan["venv_python"]).resolve()
    all_commands: list[list[str]] = plan["commands"]

    # Se o venv e o PyTorch já existem, pula recriação do venv e reinstalação de torch/torchaudio
    if venv_py.is_file() and _venv_has_torch(venv_py) and len(all_commands) >= 3:
        commands = all_commands[2:]
    elif venv_py.is_file() and len(all_commands) >= 2:
        commands = all_commands[1:]
    else:
        commands = all_commands

    total = len(commands)
    for idx, cmd in enumerate(commands, start=1):
        if on_step is not None:
            on_step(idx, total, f"Instalando pacote {engine} no venv isolado (etapa {idx}/{total})...")
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if proc.returncode != 0:
            err = (proc.stderr or proc.stdout or "").strip()[-400:]
            raise RuntimeError(
                f"Falha ao preparar venv isolado para '{engine}' (etapa {idx}/{total}, exit={proc.returncode}): {err}"
            )

    if update_dotenv:
        persist_tts_venv_in_dotenv(venv_py)
    return venv_py


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    venv_dir = Path(args.venv_dir) if args.venv_dir else None
    plan = build_setup_plan(
        engine=args.engine,
        venv_dir=venv_dir,
        with_aligner=args.with_aligner,
        device=args.device,
    )

    if args.dry_run:
        print(json.dumps({"dry_run": True, **plan}, indent=2, ensure_ascii=False))
        return 0

    for cmd in plan["commands"]:
        print(f"[setup_tts_venv] Executando: {' '.join(cmd)}", flush=True)
        proc = subprocess.run(cmd, check=False)
        if proc.returncode != 0:
            print(
                f"[setup_tts_venv] ERRO: comando falhou com exit code {proc.returncode}.",
                file=sys.stderr,
                flush=True,
            )
            return proc.returncode

    persist_tts_venv_in_dotenv(plan["venv_python"])
    print("\n[setup_tts_venv] Venv isolado pronto e registrado no .env:")
    print(plan["env_line"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
