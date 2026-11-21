from __future__ import annotations

from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDPKMixin


class AmoTask(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "amo_tasks"

    amo_task_id: Mapped[int] = mapped_column(BigInteger, unique=True, nullable=False, index=True)
    amo_entity_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True, index=True)
    analyst_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("analysts.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    task_type: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    deadline_initial: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    deadline_current: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    is_completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    is_overdue: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
