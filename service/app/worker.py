"""Точка входа RQ-воркера: `python -m app.worker`.

При старте регистрирует расписание pull-синков (idempotently) и затем работает
обычным RQ-воркером. Параллельно нужен ещё один процесс `rqscheduler` —
он перекладывает cron-задачи из планировщика в очередь по расписанию.
Запускается через `python -m app.scheduler_worker`.
"""

from __future__ import annotations

import logging

from redis import Redis
from rq import Connection, Queue, Worker

from app.core.config import settings
from app.services.queue import WEBHOOK_QUEUE_NAME
from app.services.scheduler import register_schedule

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger(__name__)


def main() -> None:
    try:
        registered = register_schedule()
        log.info("scheduler registered: %s", registered)
    except Exception:  # noqa: BLE001
        log.exception("failed to register scheduler (continuing as plain worker)")

    redis = Redis.from_url(settings.redis_url)
    with Connection(redis):
        Worker([Queue(WEBHOOK_QUEUE_NAME)]).work(with_scheduler=False)


if __name__ == "__main__":
    main()
