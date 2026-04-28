"""
Retry worker: перебирает записи sync_log со статусом FAILED и повторяет попытку.
При достижении MAX_ATTEMPTS перемещает в dead_letter.
"""

from datetime import datetime, timezone

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import AsyncSessionLocal
from app.models import SyncDirection, SyncLog, SyncStatus
from app.schemas import OnecOrder
from app.services.sync_engine import MAX_ATTEMPTS, move_to_dead_letter, sync_onec_to_amo

log = structlog.get_logger()


async def run_retry_worker() -> None:
    async with AsyncSessionLocal() as db:
        now = datetime.now(timezone.utc)
        result = await db.execute(
            select(SyncLog).where(
                SyncLog.status == SyncStatus.FAILED.value,
                SyncLog.next_retry_at <= now,
                SyncLog.attempts < MAX_ATTEMPTS,
            )
        )
        pending = result.scalars().all()

        if not pending:
            return

        log.info("retry_worker_start", count=len(pending))

        for entry in pending:
            if entry.direction == SyncDirection.ONEC_TO_AMO.value and entry.payload:
                await _retry_onec_to_amo(entry, db)


async def _retry_onec_to_amo(entry: SyncLog, db: AsyncSession) -> None:
    from datetime import timedelta

    try:
        order = OnecOrder.model_validate(entry.payload)
        ok, lead_id = await sync_onec_to_amo(order, db)
        if ok:
            entry.status = SyncStatus.SUCCESS.value
            log.info("retry_success", sync_log_id=entry.id)
        else:
            entry.attempts += 1
            entry.next_retry_at = datetime.now(timezone.utc) + timedelta(minutes=2 ** entry.attempts)
            if entry.attempts >= MAX_ATTEMPTS:
                await move_to_dead_letter(entry, db)
                log.warning("retry_dead_letter", sync_log_id=entry.id)
    except Exception as exc:
        entry.attempts += 1
        entry.error = str(exc)
        log.error("retry_exception", sync_log_id=entry.id, error=str(exc))

    await db.commit()
