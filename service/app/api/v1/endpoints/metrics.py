from __future__ import annotations

from dataclasses import asdict
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import Analyst, User, UserRole
from app.services.metrics import (
    compute_analyst_metrics,
    compute_dashboard,
    default_period,
    load_tracked_task_types,
)

router = APIRouter(prefix="/metrics", tags=["metrics"])


@router.get("/analyst/{analyst_id}")
def analyst_metrics(
    analyst_id: UUID,
    from_: Optional[datetime] = Query(default=None, alias="from"),
    to: Optional[datetime] = None,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> dict:
    analyst = db.get(Analyst, analyst_id)
    if analyst is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analyst not found")

    if current.role == UserRole.analyst:
        own = db.execute(select(Analyst).where(Analyst.user_id == current.id)).scalar_one_or_none()
        if own is None or own.id != analyst.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Analyst can view only own metrics")

    period_from, period_to = default_period(from_, to)
    tracked = load_tracked_task_types(db)
    metrics = compute_analyst_metrics(
        db, analyst.id, period_from=period_from, period_to=period_to, tracked_types=tracked
    )
    return asdict(metrics)


@router.get("/dashboard")
def dashboard(
    from_: Optional[datetime] = Query(default=None, alias="from"),
    to: Optional[datetime] = None,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
) -> dict:
    """Сводный дашборд по всем активным аналитикам.

    Для роли `analyst` возвращаем только собственную строку — клиент дёргает один и
    тот же эндпоинт, фильтрация на стороне сервиса.
    """
    period_from, period_to = default_period(from_, to)
    tracked = load_tracked_task_types(db)
    rows = compute_dashboard(db, period_from=period_from, period_to=period_to, tracked_types=tracked)

    if current.role == UserRole.analyst:
        own = db.execute(select(Analyst).where(Analyst.user_id == current.id)).scalar_one_or_none()
        own_id = str(own.id) if own is not None else None
        rows = [r for r in rows if r["analyst_id"] == own_id] if own_id else []

    return {
        "period_from": period_from.isoformat(),
        "period_to": period_to.isoformat(),
        "rows": rows,
        "tracked_task_types": tracked,
    }
