from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.models import PaymentStatus


class PaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    project_id: UUID
    analyst_id: UUID
    amount: Decimal
    status: PaymentStatus
    accrued_at: Optional[datetime] = None
    paid_at: Optional[datetime] = None
    comment: Optional[str] = None


class PaymentUpdate(BaseModel):
    amount: Optional[Decimal] = None
    status: Optional[PaymentStatus] = None
    comment: Optional[str] = None
    reason: Optional[str] = None  # для audit log


class PaymentMarkPaid(BaseModel):
    paid_at: Optional[datetime] = None  # default — now()
    comment: Optional[str] = None
