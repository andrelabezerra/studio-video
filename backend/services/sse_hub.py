"""Hub thread-safe de Server-Sent Events (SSE) por projeto (slug)."""

from __future__ import annotations

import asyncio
import json
import threading
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


def format_sse(event: str, data: dict[str, Any]) -> str:
    """Formata um frame SSE padrão (`event:` + `data:` JSON)."""
    payload = json.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n"


@dataclass(frozen=True)
class _Subscriber:
    loop: asyncio.AbstractEventLoop
    queue: asyncio.Queue[tuple[str, dict[str, Any]]]


class SSEHub:
    """Gerencia assinaturas SSE por slug e entrega eventos vindos de threads de render."""

    def __init__(self, *, heartbeat_interval_sec: float = 15.0) -> None:
        self._lock = threading.Lock()
        self._subscribers: dict[str, list[_Subscriber]] = {}
        self._heartbeat_interval_sec = heartbeat_interval_sec

    def publish(self, slug: str, event: str, data: dict[str, Any]) -> int:
        """Publica evento para todos os clientes conectados ao projeto `slug`.

        Seguro para chamada a partir de threads síncronas (ex.: background render).
        Retorna a quantidade de assinantes notificados.
        """
        enriched = {
            **data,
            "slug": slug,
            "ts": datetime.now(timezone.utc).isoformat(),
        }
        with self._lock:
            subs = list(self._subscribers.get(slug, []))

        delivered = 0
        for sub in subs:
            if sub.loop.is_closed():
                continue
            try:
                sub.loop.call_soon_threadsafe(sub.queue.put_nowait, (event, enriched))
                delivered += 1
            except RuntimeError:
                # Event loop encerrado entre a leitura e o agendamento
                continue
        return delivered

    def subscriber_count(self, slug: str) -> int:
        with self._lock:
            return len(self._subscribers.get(slug, []))

    async def subscribe(
        self,
        slug: str,
        *,
        max_events: int | None = None,
    ) -> AsyncGenerator[str, None]:
        """Gera stream SSE (`text/event-stream`) com heartbeat periódico."""
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[tuple[str, dict[str, Any]]] = asyncio.Queue()
        subscriber = _Subscriber(loop=loop, queue=queue)

        with self._lock:
            self._subscribers.setdefault(slug, []).append(subscriber)

        emitted = 0
        try:
            yield format_sse(
                "heartbeat",
                {
                    "slug": slug,
                    "status": "connected",
                    "ts": datetime.now(timezone.utc).isoformat(),
                },
            )
            emitted += 1
            if max_events is not None and emitted >= max_events:
                return

            while True:
                try:
                    event_name, payload = await asyncio.wait_for(
                        queue.get(),
                        timeout=self._heartbeat_interval_sec,
                    )
                    yield format_sse(event_name, payload)
                except asyncio.TimeoutError:
                    yield format_sse(
                        "heartbeat",
                        {
                            "slug": slug,
                            "status": "alive",
                            "ts": datetime.now(timezone.utc).isoformat(),
                        },
                    )
                emitted += 1
                if max_events is not None and emitted >= max_events:
                    return
        finally:
            with self._lock:
                current = self._subscribers.get(slug)
                if current and subscriber in current:
                    current.remove(subscriber)
                    if not current:
                        self._subscribers.pop(slug, None)
