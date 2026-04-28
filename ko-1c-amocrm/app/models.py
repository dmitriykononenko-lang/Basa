from datetime import datetime, timezone
from enum import Enum

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class SyncDirection(str, Enum):
    ONEC_TO_AMO = "1c→amo"
    AMO_TO_ONEC = "amo→1c"


class SyncStatus(str, Enum):
    PENDING = "pending"
    SUCCESS = "success"
    FAILED = "failed"
    DEAD = "dead"  # в dead-letter после N попыток


class LeadMapping(Base):
    """Связь между номером заказа 1С и лидом amoCRM."""

    __tablename__ = "lead_mappings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_number_1c: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    amocrm_lead_id: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class SyncLog(Base):
    """Лог каждой операции синхронизации."""

    __tablename__ = "sync_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    direction: Mapped[str] = mapped_column(String(20))  # SyncDirection
    status: Mapped[str] = mapped_column(String(20), index=True)  # SyncStatus
    order_number_1c: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    amocrm_lead_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payload: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    next_retry_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class DeadLetter(Base):
    """Записи, которые не удалось синхронизировать после MAX_ATTEMPTS попыток."""

    __tablename__ = "dead_letter"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    direction: Mapped[str] = mapped_column(String(20))
    order_number_1c: Mapped[str | None] = mapped_column(String(100), nullable=True)
    amocrm_lead_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payload: Mapped[dict] = mapped_column(JSONB)
    last_error: Mapped[str] = mapped_column(Text)
    total_attempts: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    resolved: Mapped[bool] = mapped_column(default=False)
