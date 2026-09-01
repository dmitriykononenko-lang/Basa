from __future__ import annotations

from decimal import Decimal
from typing import Optional
from uuid import UUID

from sqlalchemy import BigInteger, Enum, Numeric, String
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDPKMixin
from app.models._enums import AnalystStatus


class Analyst(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "analysts"

    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    amo_user_id: Mapped[Optional[int]] = mapped_column(BigInteger, unique=True, index=True, nullable=True)
    default_rate: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=Decimal("0"))
    payment_details: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    status: Mapped[AnalystStatus] = mapped_column(
        Enum(AnalystStatus, name="analyst_status"),
        nullable=False,
        default=AnalystStatus.active,
        server_default=AnalystStatus.active.value,
    )
    user_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True), nullable=True, index=True
    )

    projects = relationship("Project", back_populates="analyst", cascade="all,delete-orphan")
    payments = relationship("Payment", back_populates="analyst")
