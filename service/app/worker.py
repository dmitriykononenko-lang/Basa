"""Точка входа RQ-воркера: `python -m app.worker`.

Работает обычным RQ-воркером по очереди `default`. Регистрацию cron-задач
здесь НЕ делаем, чтобы не было race при одновременном старте с
`app.scheduler_worker`: расписание поднимает только sched-процесс.
"""

from __future__ import annotations

import logging

from redis import Redis
from rq import Connection, Queue, Worker

from app.core.config import settings
from app.services.queue import WEBHOOK_QUEUE_NAME

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger(__name__)


def main() -> None:
    redis = Redis.from_url(settings.redis_url)
    with Connection(redis):
        Worker([Queue(WEBHOOK_QUEUE_NAME)]).work(with_scheduler=False)


if __name__ == "__main__":
    main()
