"""Fila de execução FIFO em memória com histórico persistido fora do OneDrive (STUDIO_CACHE_DIR/_queue_history.json)."""

from __future__ import annotations

import json
import logging
import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from backend.api import compute_pipeline_runtime, get_presets_dir, production as production_api
from backend.core.cache import get_project_cache
from backend.core.config import StudioSettings, load_preset
from backend.core.storage import ProjectStorage, atomic_write_text
from backend.services.sse_hub import SSEHub

logger = logging.getLogger(__name__)

QueueAction = Literal["run_pending", "render_preview", "render_final"]
QueueProfile = Literal["preview", "final"]
QueueStatus = Literal["queued", "running", "completed", "failed", "cancelled"]


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


@dataclass
class QueueJob:
    job_id: str
    slug: str
    title: str
    action: QueueAction
    profile: QueueProfile
    status: QueueStatus
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    message: str = "Aguardando na fila..."
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "slug": self.slug,
            "title": self.title,
            "action": self.action,
            "profile": self.profile,
            "status": self.status,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "message": self.message,
            "error": self.error,
        }

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> QueueJob:
        return cls(
            job_id=str(raw["job_id"]),
            slug=str(raw["slug"]),
            title=str(raw.get("title") or raw["slug"]),
            action=raw.get("action", "run_pending"),
            profile=raw.get("profile", "preview"),
            status=raw.get("status", "cancelled"),
            created_at=str(raw.get("created_at") or _now_iso()),
            started_at=raw.get("started_at"),
            finished_at=raw.get("finished_at"),
            message=str(raw.get("message") or ""),
            error=raw.get("error"),
        )


class _JobSSEProxy:
    """Intercepta eventos publicados no SSEHub para sincronizar progresso e status do QueueJob."""

    def __init__(
        self,
        hub: SSEHub,
        manager: ExecutionQueueManager,
        job_id: str,
    ) -> None:
        self._hub = hub
        self._manager = manager
        self._job_id = job_id
        self.saw_error: bool = False
        self.error_text: str | None = None
        self.last_message: str | None = None

    def publish(self, slug: str, event: str, data: dict[str, Any]) -> int:
        msg = data.get("message")
        if isinstance(msg, str) and msg.strip():
            self.last_message = msg.strip()
            self._manager._update_job_message(self._job_id, self.last_message)
        if event == "error":
            self.saw_error = True
            err = data.get("error") or msg or "Erro durante execução do job na fila."
            self.error_text = str(err)
        return self._hub.publish(slug, event, data)


class ExecutionQueueManager:
    """Gerencia fila FIFO de 1 vídeo por padrão (com lote opcional sob demanda) e histórico em STUDIO_CACHE_DIR."""

    def __init__(
        self,
        *,
        settings: StudioSettings,
        storage: ProjectStorage,
        sse_hub: SSEHub,
        pickup_delay_sec: float = 0.15,
    ) -> None:
        self.settings = settings
        self.storage = storage
        self.sse_hub = sse_hub
        self._pickup_delay_sec = pickup_delay_sec
        self._lock = threading.Lock()
        self._wake_event = threading.Event()
        self._jobs: list[QueueJob] = []
        self._active_job_id: str | None = None
        self._load_history_from_disk()
        self._worker = threading.Thread(
            target=self._worker_loop,
            name="studio-queue-worker",
            daemon=True,
        )
        self._worker.start()

    @property
    def history_file(self) -> Path:
        return self.settings.studio_cache_dir.resolve() / "_queue_history.json"

    def _load_history_from_disk(self) -> None:
        path = self.history_file
        if not path.is_file():
            return
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            raw_jobs = payload.get("jobs", []) if isinstance(payload, dict) else []
            loaded: list[QueueJob] = []
            for item in raw_jobs:
                if not isinstance(item, dict) or "job_id" not in item or "slug" not in item:
                    continue
                job = QueueJob.from_dict(item)
                if job.status in ("queued", "running"):
                    job.status = "cancelled"
                    job.finished_at = job.finished_at or _now_iso()
                    job.message = "Interrompido por reinicialização do servidor."
                loaded.append(job)
            self._jobs = loaded[-100:]
        except (OSError, ValueError, KeyError) as exc:
            logger.warning("Não foi possível carregar _queue_history.json: %s", exc)

    def _persist_locked(self) -> None:
        payload = {
            "updated_at": _now_iso(),
            "active_job_id": self._active_job_id,
            "jobs": [j.to_dict() for j in self._jobs[-100:]],
        }
        try:
            atomic_write_text(self.history_file, json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
        except OSError as exc:
            logger.warning("Falha ao persistir histórico da fila em '%s': %s", self.history_file, exc)

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "active_job_id": self._active_job_id,
                "jobs": [j.to_dict() for j in self._jobs],
            }

    def enqueue(
        self,
        *,
        slug: str,
        title: str,
        action: QueueAction = "run_pending",
        profile: QueueProfile | None = None,
    ) -> tuple[dict[str, Any], int]:
        resolved_profile: QueueProfile
        if action == "render_final":
            resolved_profile = "final"
        elif action == "render_preview":
            resolved_profile = "preview"
        else:
            resolved_profile = profile or "preview"

        action_label = {
            "run_pending": f"Executar pendências ({resolved_profile})",
            "render_preview": "Renderizar preview 540×960",
            "render_final": "Renderizar final 1080×1920",
        }[action]

        job = QueueJob(
            job_id=f"q_{uuid.uuid4().hex[:10]}",
            slug=slug,
            title=title,
            action=action,
            profile=resolved_profile,
            status="queued",
            created_at=_now_iso(),
            message=f"Na fila: {action_label}",
        )
        with self._lock:
            self._jobs.append(job)
            queue_len = sum(1 for j in self._jobs if j.status in ("queued", "running"))
            self._persist_locked()
            job_dict = job.to_dict()

        self._wake_event.set()
        return job_dict, queue_len

    def cancel(self, job_id: str) -> dict[str, Any] | None:
        with self._lock:
            target = next((j for j in self._jobs if j.job_id == job_id), None)
            if target is None:
                return None
            if target.status == "queued":
                target.status = "cancelled"
                target.finished_at = _now_iso()
                target.message = "Cancelado pelo usuário antes da execução."
                self._persist_locked()
            elif target.status == "running":
                target.status = "cancelled"
                target.finished_at = _now_iso()
                target.message = "Cancelado pelo usuário durante a execução."
                if self._active_job_id == job_id:
                    self._active_job_id = None
                self._persist_locked()
            return target.to_dict()

    def clear_history(self) -> list[dict[str, Any]]:
        with self._lock:
            self._jobs = [j for j in self._jobs if j.status in ("queued", "running")]
            self._persist_locked()
            return [j.to_dict() for j in self._jobs]

    def _update_job_message(self, job_id: str, message: str) -> None:
        with self._lock:
            target = next((j for j in self._jobs if j.job_id == job_id), None)
            if target is not None and target.status == "running":
                target.message = message

    def _worker_loop(self) -> None:
        while True:
            self._wake_event.wait()
            if self._pickup_delay_sec > 0:
                time.sleep(self._pickup_delay_sec)

            job_to_run: QueueJob | None = None
            with self._lock:
                for candidate in self._jobs:
                    if candidate.status == "queued":
                        candidate.status = "running"
                        candidate.started_at = _now_iso()
                        candidate.message = f"Executando {candidate.action} ({candidate.profile})..."
                        self._active_job_id = candidate.job_id
                        self._persist_locked()
                        job_to_run = candidate
                        break
                if job_to_run is None:
                    self._wake_event.clear()
                    continue

            self._execute_job(job_to_run)

    def _execute_job(self, job: QueueJob) -> None:
        proxy_hub = _JobSSEProxy(self.sse_hub, self, job.job_id)
        try:
            if job.action == "run_pending":
                self._run_pending_action(job, proxy_hub)
            elif job.action in ("render_preview", "render_final"):
                target_profile: Literal["preview", "final"] = (
                    "final" if job.action == "render_final" else "preview"
                )
                production_api._run_background_render(
                    job_id=job.job_id,
                    slug=job.slug,
                    profile=target_profile,
                    force=False,
                    settings=self.settings,
                    storage=self.storage,
                    hub=proxy_hub,  # type: ignore[arg-type]
                )
            else:
                raise ValueError(f"Ação de fila desconhecida: '{job.action}'.")
        except Exception as exc:  # noqa: BLE001
            logger.exception("Erro ao processar job '%s' na fila", job.job_id)
            proxy_hub.saw_error = True
            proxy_hub.error_text = str(exc)

        with self._lock:
            if self._active_job_id == job.job_id:
                self._active_job_id = None
            if job.status == "cancelled":
                self._persist_locked()
                return
            job.finished_at = _now_iso()
            if proxy_hub.saw_error:
                job.status = "failed"
                job.error = proxy_hub.error_text or "Falha na execução."
                job.message = f"Falha: {job.error}"
            else:
                job.status = "completed"
                job.message = proxy_hub.last_message or "Concluído com sucesso."
            self._persist_locked()

    def _run_pending_action(self, job: QueueJob, proxy_hub: _JobSSEProxy) -> None:
        slug = job.slug
        manifest = self.storage.load_manifest(slug)
        script = self.storage.load_script(slug) if self.storage.exists(slug, "script.json") else None
        alignment = (
            self.storage.load_audio_alignment(slug)
            if self.storage.exists(slug, "audio_alignment.json")
            else None
        )
        _, scenes = production_api._load_project_scenes(self.storage, slug)
        preset = load_preset(manifest.preset_id, presets_dir=get_presets_dir(self.settings))
        cache = get_project_cache(slug, cache_root=self.settings.studio_cache_dir, ensure=False)

        pipeline_status, _ = compute_pipeline_runtime(
            slug=slug,
            manifest=manifest,
            script=script,
            audio_alignment=alignment,
            scenes=scenes,
            preset=preset,
            cache=cache,
            templates_dir=self.settings.workspace_root / "templates_video",
            ensure_thumbs=False,
        )

        if pipeline_status["pending_count"] == 0:
            msg = "Projeto já está atualizado (0 etapas pendentes)."
            proxy_hub.publish(
                slug,
                "done",
                {
                    "job_id": job.job_id,
                    "stage": "done",
                    "scene_id": None,
                    "progress_pct": 100,
                    "done": True,
                    "profile": job.profile,
                    "regenerated_scenes": [],
                    "audio_realigned": False,
                    "message": msg,
                },
            )
            return

        production_api._run_pending_background(
            job_id=job.job_id,
            slug=slug,
            profile=job.profile,
            settings=self.settings,
            storage=self.storage,
            hub=proxy_hub,  # type: ignore[arg-type]
        )
