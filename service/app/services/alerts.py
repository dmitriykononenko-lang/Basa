"""Простой алертинг через Redis sorted-set (sliding window).

По ТЗ §9.2 — алерт при >10 ошибок обработки вебхуков за час. Здесь храним
timestamp каждой ошибки в sorted-set, считаем за последний час, отрезаем хвост.
Снаружи — функция `record_error`, которую зовёт процессор, и эндпоинт
`GET /api/v1/alerts/status`, который показывает админу текущее состояние.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from time import time
from typing import Optional

from redis import Redis
from redis.exceptions import RedisError

from app.core.config import settings

logger = logging.getLogger(__name__)

ERROR_BUCKET_KEY = "basa:alerts:webhook_errors"
WINDOW_SECONDS = 3600
DEFAULT_THRESHOLD = 10


@dataclass
class AlertStatus:
    errors_last_hour: int
    threshold: int
    triggered: bool
    window_seconds: int = WINDOW_SECONDS


def _redis() -> Optional[Redis]:
    try:
        return Redis.from_url(settings.redis_url)
    except Exception:  # noqa: BLE001
        return None


def record_error(detail: str = "", *, now_ts: Optional[float] = None) -> None:
    """Записать событие ошибки. Не падает, если Redis недоступен — только лог."""
    r = _redis()
    if r is None:
        logger.warning("Redis unavailable, alert event dropped: %s", detail[:200])
        return
    ts = now_ts if now_ts is not None else time()
    member = f"{ts}:{detail[:200]}"
    try:
        r.zadd(ERROR_BUCKET_KEY, {member: ts})
        # обрезаем хвост, чтобы set не рос
        r.zremrangebyscore(ERROR_BUCKET_KEY, 0, ts - WINDOW_SECONDS)
    except RedisError as exc:
        logger.warning("Failed to record alert event: %s", exc)


def get_status(threshold: int = DEFAULT_THRESHOLD, *, now_ts: Optional[float] = None) -> AlertStatus:
    r = _redis()
    if r is None:
        return AlertStatus(errors_last_hour=0, threshold=threshold, triggered=False)
    ts = now_ts if now_ts is not None else time()
    try:
        r.zremrangebyscore(ERROR_BUCKET_KEY, 0, ts - WINDOW_SECONDS)
        count = int(r.zcount(ERROR_BUCKET_KEY, ts - WINDOW_SECONDS, ts))
    except RedisError as exc:
        logger.warning("Failed to read alert status: %s", exc)
        return AlertStatus(errors_last_hour=0, threshold=threshold, triggered=False)
    return AlertStatus(errors_last_hour=count, threshold=threshold, triggered=count > threshold)


def list_recent_errors(limit: int = 50, *, now_ts: Optional[float] = None) -> list[dict]:
    r = _redis()
    if r is None:
        return []
    ts = now_ts if now_ts is not None else time()
    try:
        members = r.zrevrangebyscore(ERROR_BUCKET_KEY, ts, ts - WINDOW_SECONDS, start=0, num=limit, withscores=True)
    except RedisError:
        return []
    out: list[dict] = []
    for m, score in members:
        text = m.decode("utf-8", errors="replace") if isinstance(m, bytes) else str(m)
        # формат "ts:detail"
        _, _, detail = text.partition(":")
        out.append({"at": float(score), "detail": detail})
    return out
