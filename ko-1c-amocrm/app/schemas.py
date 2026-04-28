from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


# ─── Входящие данные от 1С ────────────────────────────────────────────────────

class OnecOrderItem(BaseModel):
    nomenclature: str
    quantity: float
    price: float
    unit: str = ""


class OnecOrder(BaseModel):
    """Тело webhook / pull-ответа от 1С. Поля уточняются под реальную 1С."""

    order_number: str = Field(..., description="Номер заказа в 1С")
    status: str = Field(..., description="Статус заказа в 1С")
    client_name: str = ""
    client_phone: str = ""
    client_email: str = ""
    total_amount: float = 0.0
    items: list[OnecOrderItem] = []
    comment: str = ""
    created_at: datetime | None = None
    extra: dict[str, Any] = Field(default_factory=dict, description="Произвольные поля")


# ─── Входящие данные от amoCRM ────────────────────────────────────────────────

class AmoWebhookLead(BaseModel):
    id: int
    status_id: int
    pipeline_id: int
    responsible_user_id: int | None = None
    name: str = ""


class AmoWebhookPayload(BaseModel):
    """amoCRM шлёт form-encoded, мы принимаем уже распарсенный dict."""

    leads: dict[str, list[AmoWebhookLead]] = Field(default_factory=dict)


# ─── Ответы API ───────────────────────────────────────────────────────────────

class SyncResult(BaseModel):
    ok: bool
    lead_id: int | None = None
    order_number: str | None = None
    message: str = ""


class HealthResponse(BaseModel):
    status: str = "ok"
    db: str = "ok"
