"""Точка входа rqscheduler: `python -m app.scheduler_worker`.

Тикает по расписанию и перекладывает зарегистрированные cron-задачи в очередь
`default`, откуда их разбирает обычный `app.worker`. Один процесс этого
типа на всю систему.
"""

from __future__ import annotations

import logging

from redis import Redis
from rq_scheduler.scheduler import Scheduler

from app.core.config import settings
from app.services.scheduler import QUEUE_NAME, register_schedule

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger(__name__)


def main() -> None:
    try:
        registered = register_schedule()
        log.info("scheduler registered: %s", registered)
    except Exception:  # noqa: BLE001
        log.exception("failed to register scheduler entries")

    redis = Redis.from_url(settings.redis_url)
    Scheduler(queue_name=QUEUE_NAME, connection=redis, interval=15).run()


if __name__ == "__main__":
    main()
