"""RQ-очередь и точка входа для воркера."""

from __future__ import annotations

import logging
from typing import Optional
from uuid import UUID

from redis import Redis
from rq import Queue

from app.core.config import settings
from app.db.session import SessionLocal
from app.services.webhook_processor import process_webhook_log

logger = logging.getLogger(__name__)

WEBHOOK_QUEUE_NAME = "default"
WEBHOOK_JOB_TIMEOUT = 60  # секунд


def _redis() -> Redis:
    return Redis.from_url(settings.redis_url)


def get_queue() -> Queue:
    return Queue(WEBHOOK_QUEUE_NAME, connection=_redis(), default_timeout=WEBHOOK_JOB_TIMEOUT)


def enqueue_webhook_log(log_id: UUID) -> Optional[str]:
    """Поставить в очередь обработку записи `amo_webhook_log`.

    Возвращает RQ job id или None, если Redis недоступен (в этом случае запись
    останется со статусом processed=false и будет подхвачена retry-механизмом
    через ручную переобработку).
    """
    try:
        job = get_queue().enqueue(
            "app.services.queue.run_webhook_job",
            str(log_id),
            retry=None,
            job_id=f"webhook-{log_id}",
            failure_ttl=60 * 60 * 24,
        )
        return job.id
    except Exception:  # noqa: BLE001
        logger.exception("Failed to enqueue webhook log %s", log_id)
        return None


def run_webhook_job(log_id_str: str) -> dict:
    """Точка входа RQ-джобы: открыть отдельную сессию и обработать запись."""
    db = SessionLocal()
    try:
        return process_webhook_log(db, UUID(log_id_str))
    finally:
        db.close()
