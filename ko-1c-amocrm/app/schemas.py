from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, Field


# ─── Входящие данные от 1С ────────────────────────────────────────────────────

class OnecOrder(BaseModel):
    # Идентификация
    order_number: str = Field(..., examples=["M00008597"], description="Номер заказа в 1С")

    # Даты
    created_at: datetime | None = None
    export_date: date | None = Field(None, description="Дата вывоза")
    export_period: str = Field("", examples=["9-15"], description="Период вывоза, напр. «9-15»")

    # Статус
    status: str = ""
    cancel_reason: str = Field("", description="Причина отмены")

    # Клиент
    last_name: str = ""
    first_name: str = ""
    middle_name: str = ""
    phone: str = ""

    # Груз
    cargo_type: str = Field("", description="Тип груза (Товар)")
    volume: float | None = Field(None, description="Объём, м³")
    weight: float | None = Field(None, description="Вес, кг")

    # Адрес и примечания
    delivery_address: str = Field("", description="Адрес доставки / Данные заявки")
    notes: str = ""

    # Служебное — если 1С уже знает lead_id (при обновлении)
    amocrm_lead_id: int | None = Field(None, description="ID сделки amoCRM, если известен")

    @property
    def full_name(self) -> str:
        return " ".join(p for p in [self.last_name, self.first_name, self.middle_name] if p)


# ─── Входящие данные от amoCRM ────────────────────────────────────────────────

class AmoStatusChange(BaseModel):
    """Распарсенные данные из webhook amoCRM об изменении этапа сделки."""

    lead_id: int
    status_id: int
    pipeline_id: int


# ─── Обратная синхронизация: запрос к 1С ─────────────────────────────────────

class OnecStatusUpdate(BaseModel):
    """Тело запроса к HTTP-сервису 1С для обновления статуса заказа."""

    amocrm_lead_id: int
    order_number: str
    new_status: str


# ─── Ответы API ───────────────────────────────────────────────────────────────

class SyncResult(BaseModel):
    ok: bool
    lead_id: int | None = None
    order_number: str | None = None
    message: str = ""


class HealthResponse(BaseModel):
    status: str = "ok"
    db: str = "ok"
