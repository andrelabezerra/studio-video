"""Servidor FastAPI + Static Mounts do Cockpit Localhost Studio Video (porta padrão 8740)."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.api.audio_tts import router as audio_tts_router
from backend.api.cocreation import router as cocreation_router
from backend.api.production import router as production_router
from backend.api.projects import router as projects_router
from backend.api.scale_phase4 import router as scale_phase4_router
from backend.core.config import StudioSettings, get_settings
from backend.core.storage import ProjectStorage
from backend.services.sse_hub import SSEHub

logger = logging.getLogger(__name__)


def create_app(
    *,
    settings: StudioSettings | None = None,
    storage: ProjectStorage | None = None,
    sse_hub: SSEHub | None = None,
) -> FastAPI:
    """Cria instância FastAPI configurada com rotas REST, SSE, templates_video e SPA dist."""
    cfg = settings or get_settings()
    store = storage or ProjectStorage(cfg.workspace_root / "projects")
    hub = sse_hub or SSEHub()

    application = FastAPI(
        title="Studio Video — AI Video Studio Pipeline",
        version="0.2.0",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )

    application.state.settings = cfg
    application.state.storage = store
    application.state.sse_hub = hub

    application.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            f"http://localhost:{cfg.studio_port}",
            f"http://127.0.0.1:{cfg.studio_port}",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    application.include_router(projects_router)
    application.include_router(cocreation_router)
    application.include_router(production_router)
    application.include_router(audio_tts_router)
    application.include_router(scale_phase4_router)

    templates_dir = (cfg.workspace_root / "templates_video").resolve()
    if templates_dir.is_dir():
        application.mount(
            "/templates_video",
            StaticFiles(directory=str(templates_dir)),
            name="templates_video",
        )

    dist_dir = (cfg.workspace_root / "app" / "dist").resolve()

    @application.get("/", include_in_schema=False)
    def serve_root() -> Any:
        index_html = dist_dir / "index.html"
        if index_html.is_file():
            return FileResponse(index_html)
        return {
            "app": "Studio Video API",
            "ui_built": False,
            "health": "/api/health",
        }

    @application.get("/{full_path:path}", include_in_schema=False)
    def serve_spa_or_dist_asset(full_path: str) -> FileResponse:
        # Nunca interceptar /api/* nem /templates_video/* com fallback SPA
        if full_path.startswith("api/") or full_path == "api" or full_path.startswith("templates_video/"):
            raise HTTPException(status_code=404, detail="Endpoint não encontrado.")

        if not dist_dir.is_dir():
            raise HTTPException(status_code=404, detail="Frontend ainda não compilado em app/dist/.")

        normalized = full_path.replace("\\", "/").lstrip("/")
        if normalized and ".." not in Path(normalized).parts:
            candidate = (dist_dir / normalized).resolve()
            if candidate.is_relative_to(dist_dir) and candidate.is_file():
                return FileResponse(candidate)

        index_html = dist_dir / "index.html"
        if index_html.is_file():
            return FileResponse(index_html)
        raise HTTPException(status_code=404, detail="index.html não encontrado em app/dist/.")

    return application


_DEFAULT_APP: FastAPI | None = None


def __getattr__(name: str) -> Any:
    """Expõe `backend.server:app` sob demanda para uvicorn sem criar diretórios no import."""
    global _DEFAULT_APP
    if name == "app":
        if _DEFAULT_APP is None:
            _DEFAULT_APP = create_app()
        return _DEFAULT_APP
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    cfg = get_settings()
    logger.info("Iniciando Studio Video Server em http://%s:%d", cfg.studio_host, cfg.studio_port)
    uvicorn.run(
        "backend.server:app",
        host=cfg.studio_host,
        port=cfg.studio_port,
        reload=False,
    )


if __name__ == "__main__":
    main()
