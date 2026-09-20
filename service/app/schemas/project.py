from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models import ProjectStatus


class ProjectBase(BaseModel):
    name: str = Field(min_length=1, max_length=500)
    analyst_id: UUID
    payment_amount: Decimal = Decimal("0")
    status: ProjectStatus = ProjectStatus.in_progress
    amo_deal_id: Optional[int] = None
    amo_status_id: Optional[int] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class ProjectCreate(ProjectBase):
    pass


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=500)
    analyst_id: Optional[UUID] = None
    payment_amount: Optional[Decimal] = None
    status: Optional[ProjectStatus] = None
    amo_deal_id: Optional[int] = None
    amo_status_id: Optional[int] = None
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class ProjectOut(ProjectBase):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
