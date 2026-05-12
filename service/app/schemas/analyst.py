from __future__ import annotations

from decimal import Decimal
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models import AnalystStatus


class AnalystBase(BaseModel):
    full_name: str = Field(min_length=1, max_length=255)
    email: EmailStr
    amo_user_id: Optional[int] = None
    default_rate: Decimal = Decimal("0")
    payment_details: dict[str, Any] = Field(default_factory=dict)
    status: AnalystStatus = AnalystStatus.active


class AnalystCreate(AnalystBase):
    pass


class AnalystUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    email: Optional[EmailStr] = None
    amo_user_id: Optional[int] = None
    default_rate: Optional[Decimal] = None
    payment_details: Optional[dict[str, Any]] = None
    status: Optional[AnalystStatus] = None


class AnalystOut(AnalystBase):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    user_id: Optional[UUID] = None
