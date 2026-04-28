"""
Pull-режим: опрос 1С по расписанию (если 1С не умеет делать push-webhook).
Подключается к планировщику при старте приложения.
"""

import httpx
import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import AsyncSessionLocal
from app.schemas import OnecOrder
from app.services.sync_engine import sync_onec_to_amo

log = structlog.get_logger()


async def poll_1c_orders() -> None:
    """Запрашивает новые/изменённые заказы из 1С и синхронизирует их в amoCRM."""
    if not settings.onec_base_url:
        log.debug("poller_skipped_no_url")
        return

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                settings.onec_base_url,
                auth=(settings.onec_user, settings.onec_password),
                # TODO: добавить параметр from_date чтобы брать только изменения
            )
            resp.raise_for_status()
            raw_orders: list[dict] = resp.json()
    except Exception as exc:
        log.error("poller_1c_fetch_failed", error=str(exc))
        return

    log.info("poller_1c_fetched", count=len(raw_orders))

    async with AsyncSessionLocal() as db:
        for raw in raw_orders:
            try:
                order = OnecOrder.model_validate(raw)
                await sync_onec_to_amo(order, db)
            except Exception as exc:
                log.error("poller_1c_order_failed", error=str(exc), raw=raw)
