from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_roles
from app.db.session import get_db
from app.models import Analyst, Payment, PaymentAudit, PaymentStatus, Project, ProjectStatus, User, UserRole
from app.schemas import PaymentMarkPaid, PaymentOut, PaymentUpdate
from app.services.exports import payments_to_xlsx

router = APIRouter(prefix="/payments", tags=["payments"])


def _filter_for_analyst(stmt, user: User, db: Session):
    if user.role != UserRole.analyst:
        return stmt
    analyst = db.execute(select(Analyst).where(Analyst.user_id == user.id)).scalar_one_or_none()
    if analyst is None:
        return stmt.where(Payment.id.is_(None))
    return stmt.where(Payment.analyst_id == analyst.id)


def _settle_project_status_if_all_paid(db: Session, project_id: UUID) -> None:
    """Если все выплаты по проекту в paid/cancelled, двигаем проект в paid.

    autoflush=False → перед SELECT'ом обязательно flush, иначе запрос видит
    устаревшие данные из БД.
    """
    db.flush()
    project = db.get(Project, project_id)
    if project is None or project.status == ProjectStatus.cancelled:
        return
    remaining = db.execute(
        select(Payment).where(
            Payment.project_id == project.id,
            Payment.status.not_in([PaymentStatus.paid, PaymentStatus.cancelled]),
        )
    ).scalars().first()
    if remaining is None:
        project.status = ProjectStatus.paid


@router.get("", response_model=list[PaymentOut])
def list_payments(
    status_: Optional[PaymentStatus] = Query(default=None, alias="status"),
    from_: Optional[datetime] = Query(default=None, alias="from"),
    to: Optional[datetime] = None,
    analyst_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> list[Payment]:
    stmt = select(Payment).order_by(Payment.accrued_at.desc().nullslast(), Payment.created_at.desc())
    if status_ is not None:
        stmt = stmt.where(Payment.status == status_)
    if analyst_id is not None:
        stmt = stmt.where(Payment.analyst_id == analyst_id)
    if from_ is not None:
        stmt = stmt.where(Payment.accrued_at >= from_)
    if to is not None:
        stmt = stmt.where(Payment.accrued_at <= to)
    stmt = _filter_for_analyst(stmt, current, db)
    return list(db.execute(stmt).scalars())


@router.patch("/{payment_id}", response_model=PaymentOut)
def update_payment(
    payment_id: UUID,
    payload: PaymentUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(require_roles(UserRole.admin)),
) -> Payment:
    payment = db.get(Payment, payment_id)
    if payment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment not found")

    data = payload.model_dump(exclude_unset=True)
    reason = data.pop("reason", None)

    status_changed_to_paid = False
    for field, value in data.items():
        old = getattr(payment, field)
        if old != value:
            db.add(
                PaymentAudit(
                    payment_id=payment.id,
                    changed_by_user_id=current.id,
                    field=field,
                    old_value=str(old) if old is not None else None,
                    new_value=str(value) if value is not None else None,
                    reason=reason,
                )
            )
            setattr(payment, field, value)
            if field == "status" and value == PaymentStatus.paid:
                status_changed_to_paid = True
                if payment.paid_at is None:
                    payment.paid_at = datetime.now(timezone.utc)

    if status_changed_to_paid:
        _settle_project_status_if_all_paid(db, payment.project_id)
    db.commit()
    db.refresh(payment)
    return payment


@router.post("/{payment_id}/mark-paid", response_model=PaymentOut)
def mark_paid(
    payment_id: UUID,
    payload: PaymentMarkPaid,
    db: Session = Depends(get_db),
    current: User = Depends(require_roles(UserRole.admin, UserRole.accountant)),
) -> Payment:
    payment = db.get(Payment, payment_id)
    if payment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment not found")
    if payment.status not in (PaymentStatus.ready, PaymentStatus.accrued):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot mark as paid from status '{payment.status.value}'",
        )

    old_status = payment.status
    payment.status = PaymentStatus.paid
    payment.paid_at = payload.paid_at or datetime.now(timezone.utc)
    if payload.comment:
        payment.comment = payload.comment

    db.add(
        PaymentAudit(
            payment_id=payment.id,
            changed_by_user_id=current.id,
            field="status",
            old_value=old_status.value,
            new_value=PaymentStatus.paid.value,
            reason="mark-paid",
        )
    )

    _settle_project_status_if_all_paid(db, payment.project_id)
    db.commit()
    db.refresh(payment)
    return payment


@router.get("/export.xlsx", response_class=Response)
def export_xlsx(
    status_: Optional[PaymentStatus] = Query(default=None, alias="status"),
    from_: Optional[datetime] = Query(default=None, alias="from"),
    to: Optional[datetime] = None,
    analyst_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.admin, UserRole.accountant)),
) -> Response:
    """Реестр выплат в XLSX для банка/1С. Доступно admin и accountant."""
    stmt = select(Payment).order_by(Payment.accrued_at.desc().nullslast(), Payment.created_at.desc())
    if status_ is not None:
        stmt = stmt.where(Payment.status == status_)
    if analyst_id is not None:
        stmt = stmt.where(Payment.analyst_id == analyst_id)
    if from_ is not None:
        stmt = stmt.where(Payment.accrued_at >= from_)
    if to is not None:
        stmt = stmt.where(Payment.accrued_at <= to)
    payments = list(db.execute(stmt).scalars())

    blob = payments_to_xlsx(db, payments)
    filename = f"payments-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.xlsx"
    return Response(
        content=blob,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
