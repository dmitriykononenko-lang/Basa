import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DeadLetter, LeadMapping, SyncDirection, SyncLog, SyncStatus
from app.schemas import OnecOrder
from app.services.amocrm_client import AmoCRMError, amo_client
from app.services.mapper import amo_lead_to_onec_status, build_contact, build_task, onec_order_to_amo_lead

log = structlog.get_logger()

MAX_ATTEMPTS = 5


# ─── 1С → amoCRM ──────────────────────────────────────────────────────────────

async def sync_onec_to_amo(order: OnecOrder, db: AsyncSession) -> tuple[bool, int | None]:
    """
    Идемпотентная синхронизация заказа 1С → amoCRM.
    - Если маппинг order_number ↔ lead_id уже есть — обновляет сделку.
    - Иначе — создаёт сделку, контакт, задачу; сохраняет маппинг.
    Возвращает (success, lead_id).
    """
    mapping = await _get_mapping_by_order(order.order_number, db)
    lead_data = onec_order_to_amo_lead(order)

    try:
        if mapping:
            await amo_client.update_lead(mapping.amocrm_lead_id, lead_data)
            lead_id = mapping.amocrm_lead_id
        else:
            # Поиск или создание контакта
            contact_id = await _find_or_create_contact(order)

            # Создание сделки
            lead = await amo_client.create_lead(lead_data)
            lead_id = lead["id"]

            # Привязка контакта
            await amo_client.link_contact_to_lead(lead_id, contact_id)

            # Создание задачи (если есть дата и период вывоза)
            task_data = build_task(order, lead_id)
            if task_data:
                await amo_client.create_task(task_data)

            # Сохранить маппинг
            db.add(LeadMapping(order_number_1c=order.order_number, amocrm_lead_id=lead_id))

        await _log_sync(db, SyncDirection.ONEC_TO_AMO, SyncStatus.SUCCESS, order.order_number, lead_id)
        await db.commit()
        log.info("sync_onec_to_amo_ok", order=order.order_number, lead_id=lead_id)
        return True, lead_id

    except AmoCRMError as exc:
        await _log_sync(
            db, SyncDirection.ONEC_TO_AMO, SyncStatus.FAILED,
            order.order_number, None, order.model_dump(mode="json"), str(exc),
        )
        await db.commit()
        log.error("sync_onec_to_amo_failed", order=order.order_number, error=str(exc))
        return False, None


async def _find_or_create_contact(order: OnecOrder) -> int:
    """Поиск контакта по телефону; создание нового, если не найден."""
    if order.phone:
        existing = await amo_client.find_contact_by_phone(order.phone)
        if existing:
            log.info("amo_contact_found", contact_id=existing["id"], phone=order.phone)
            return existing["id"]

    contact_data = build_contact(order)
    created = await amo_client.create_contact(contact_data)
    return created["id"]


# ─── amoCRM → 1С ──────────────────────────────────────────────────────────────

async def handle_amo_status_change(lead_id: int, new_status_id: int, db: AsyncSession) -> None:
    """
    При изменении этапа сделки в amoCRM — обновляет статус заказа в 1С
    через HTTP-сервис, реализованный 1С-программистом.
    """
    onec_status = amo_lead_to_onec_status(new_status_id)
    if not onec_status:
        log.info("amo_status_no_mapping", status_id=new_status_id)
        return

    mapping = await _get_mapping_by_lead(lead_id, db)
    if not mapping:
        log.warning("amo_lead_not_in_mapping", lead_id=lead_id)
        return

    from app.services.onec_client import onec_client, OnecClientError
    try:
        await onec_client.update_order_status(
            order_number=mapping.order_number_1c,
            amocrm_lead_id=lead_id,
            new_status=onec_status,
        )
        await _log_sync(db, SyncDirection.AMO_TO_ONEC, SyncStatus.SUCCESS, mapping.order_number_1c, lead_id)
        await db.commit()
        log.info("sync_amo_to_onec_ok", lead_id=lead_id, order=mapping.order_number_1c, status=onec_status)
    except OnecClientError as exc:
        await _log_sync(
            db, SyncDirection.AMO_TO_ONEC, SyncStatus.FAILED,
            mapping.order_number_1c, lead_id,
            {"lead_id": lead_id, "new_status_id": new_status_id, "onec_status": onec_status},
            str(exc),
        )
        await db.commit()
        log.error("sync_amo_to_onec_failed", lead_id=lead_id, error=str(exc))


# ─── Helpers ──────────────────────────────────────────────────────────────────

async def _get_mapping_by_order(order_number: str, db: AsyncSession) -> LeadMapping | None:
    result = await db.execute(
        select(LeadMapping).where(LeadMapping.order_number_1c == order_number)
    )
    return result.scalar_one_or_none()


async def _get_mapping_by_lead(lead_id: int, db: AsyncSession) -> LeadMapping | None:
    result = await db.execute(
        select(LeadMapping).where(LeadMapping.amocrm_lead_id == lead_id)
    )
    return result.scalar_one_or_none()


async def _log_sync(
    db: AsyncSession,
    direction: SyncDirection,
    status: SyncStatus,
    order_number: str | None,
    lead_id: int | None,
    payload: dict | None = None,
    error: str | None = None,
    attempts: int = 1,
) -> None:
    db.add(SyncLog(
        direction=direction.value,
        status=status.value,
        order_number_1c=order_number,
        amocrm_lead_id=lead_id,
        payload=payload,
        error=error,
        attempts=attempts,
    ))


async def move_to_dead_letter(log_entry: SyncLog, db: AsyncSession) -> None:
    db.add(DeadLetter(
        direction=log_entry.direction,
        order_number_1c=log_entry.order_number_1c,
        amocrm_lead_id=log_entry.amocrm_lead_id,
        payload=log_entry.payload or {},
        last_error=log_entry.error or "",
        total_attempts=log_entry.attempts,
    ))
    log_entry.status = SyncStatus.DEAD.value
    await db.commit()
