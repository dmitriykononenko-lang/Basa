from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.services.sync_engine import handle_amo_status_change

router = APIRouter(prefix="/webhook", tags=["amocrm"])


@router.post("/amo", summary="Принять webhook от amoCRM (изменение лида)")
async def receive_from_amo(request: Request, db: AsyncSession = Depends(get_db)):
    """
    amoCRM шлёт form-encoded данные. Парсим вручную.
    Документация: https://www.amocrm.ru/developers/content/crm_platform/webhooks
    """
    form = await request.form()
    data = dict(form)

    # amoCRM передаёт leads[status][0][id], leads[status][0][status_id] и т.д.
    lead_id = _extract_int(data, "leads[status][0][id]") or _extract_int(data, "leads[update][0][id]")
    status_id = _extract_int(data, "leads[status][0][status_id]") or _extract_int(data, "leads[update][0][status_id]")

    if lead_id and status_id:
        await handle_amo_status_change(lead_id, status_id, db)

    # amoCRM ожидает 200 OK, иначе будет слать повторно
    return {"ok": True}


def _extract_int(data: dict, key: str) -> int | None:
    val = data.get(key)
    try:
        return int(val) if val is not None else None
    except (ValueError, TypeError):
        return None
