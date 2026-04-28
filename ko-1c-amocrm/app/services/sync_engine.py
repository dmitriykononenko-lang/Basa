import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DeadLetter, LeadMapping, SyncDirection, SyncLog, SyncStatus
from app.schemas import OnecOrder
from app.services.amocrm_client import AmoCRMError, amo_client
from app.services.mapper import onec_order_to_amo_lead

log = structlog.get_logger()

MAX_ATTEMPTS = 5


async def sync_onec_to_amo(order: OnecOrder, db: AsyncSession) -> tuple[bool, int | None]:
    """
    Основной метод: принимает заказ 1С, создаёт или обновляет лид в amoCRM.
    Возвращает (success, lead_id).
    """
    mapping = await _get_mapping_by_order(order.order_number, db)
    lead_data = onec_order_to_amo_lead(order)

    try:
        if mapping:
            lead = await amo_client.update_lead(mapping.amocrm_lead_id, lead_data)
            lead_id = mapping.amocrm_lead_id
        else:
            # Создать контакт и привязать к лиду
            contact_id = await amo_client.find_or_create_contact(
                order.client_name, order.client_phone, order.client_email
            )
            lead = await amo_client.create_lead(lead_data)
            lead_id = lead["id"]
            await amo_client.link_contact_to_lead(lead_id, contact_id)

            # Сохранить маппинг
            db.add(LeadMapping(order_number_1c=order.order_number, amocrm_lead_id=lead_id))

        await _log_sync(db, SyncDirection.ONEC_TO_AMO, SyncStatus.SUCCESS, order.order_number, lead_id)
        await db.commit()
        return True, lead_id

    except AmoCRMError as exc:
        await _log_sync(
            db, SyncDirection.ONEC_TO_AMO, SyncStatus.FAILED,
            order.order_number, None, order.model_dump(), str(exc)
        )
        await db.commit()
        log.error("sync_onec_to_amo_failed", order=order.order_number, error=str(exc))
        return False, None


async def handle_amo_status_change(lead_id: int, new_status_id: int, db: AsyncSession) -> None:
    """
    Обратная синхронизация: статус изменился в amoCRM → отправить в 1С.
    Реализация 1С-стороны добавляется после уточнения endpoint.
    """
    from app.services.mapper import amo_lead_to_onec_status

    onec_status = amo_lead_to_onec_status(new_status_id)
    if not onec_status:
        log.info("amo_status_no_mapping", status_id=new_status_id)
        return

    mapping = await _get_mapping_by_lead(lead_id, db)
    if not mapping:
        log.warning("amo_lead_not_in_mapping", lead_id=lead_id)
        return

    # TODO: вызов 1С API / запись в файл / push — в зависимости от выбранного сценария
    log.info(
        "amo_to_onec_stub",
        lead_id=lead_id,
        order=mapping.order_number_1c,
        new_status=onec_status,
    )


# ─── Helpers ──────────────────────────────────────────────────────────────────

async def _get_mapping_by_order(order_number: str, db: AsyncSession) -> LeadMapping | None:
    result = await db.execute(select(LeadMapping).where(LeadMapping.order_number_1c == order_number))
    return result.scalar_one_or_none()


async def _get_mapping_by_lead(lead_id: int, db: AsyncSession) -> LeadMapping | None:
    result = await db.execute(select(LeadMapping).where(LeadMapping.amocrm_lead_id == lead_id))
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
