from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional
from uuid import UUID

from sqlalchemy import BigInteger, DateTime, Enum, ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPKMixin
from app.models._enums import ProjectStatus


class Project(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "projects"

    amo_deal_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, unique=True, nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    analyst_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("analysts.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    payment_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    status: Mapped[ProjectStatus] = mapped_column(
        Enum(ProjectStatus, name="project_status"),
        nullable=False,
        default=ProjectStatus.in_progress,
        server_default=ProjectStatus.in_progress.value,
        index=True,
    )
    amo_status_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    analyst = relationship("Analyst", back_populates="projects")
    payments = relationship("Payment", back_populates="project", cascade="all,delete-orphan")
