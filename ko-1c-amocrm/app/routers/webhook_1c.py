from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_db
from app.schemas import OnecOrder, SyncResult
from app.services.sync_engine import sync_onec_to_amo

router = APIRouter(prefix="/webhook", tags=["1c"])


def _verify_secret(x_auth_token: str = Header(...)):
    if x_auth_token != settings.webhook_secret:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


@router.post(
    "/1c",
    response_model=SyncResult,
    dependencies=[Depends(_verify_secret)],
    summary="Принять заказ/изменение из 1С",
)
async def receive_from_1c(order: OnecOrder, db: AsyncSession = Depends(get_db)):
    ok, lead_id = await sync_onec_to_amo(order, db)
    return SyncResult(
        ok=ok,
        lead_id=lead_id,
        order_number=order.order_number,
        message="synced" if ok else "failed, queued for retry",
    )
