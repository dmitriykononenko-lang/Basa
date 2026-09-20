"""Расчёт метрик эффективности по таблице amo_tasks (ТЗ §5).

Все вычисления динамические — задачи накапливаются в БД через вебхуки и pull-sync,
а метрики считаются по запросу за выбранный период.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.models import AmoTask, Analyst, AnalystStatus, Setting
from app.services.task_processor import _ensure_aware

TRACKED_TASK_TYPES_KEY = "tracked_task_types"


@dataclass
class AnalystMetrics:
    analyst_id: str
    analyst_name: str
    period_from: str
    period_to: str
    closed_total: int
    closed_overdue: int
    overdue_pct: float
    avg_overdue_seconds: Optional[float]
    open_overdue: int
    open_no_deadline: int


def load_tracked_task_types(db: Session) -> Optional[list[int]]:
    row = db.get(Setting, TRACKED_TASK_TYPES_KEY)
    if row is None or not isinstance(row.value, dict):
        return None
    types = row.value.get("types")
    if not isinstance(types, list) or not types:
        return None
    out: list[int] = []
    for t in types:
        try:
            out.append(int(t))
        except (TypeError, ValueError):
            continue
    return out or None


def _base_filter(analyst_id: UUID, tracked_types: Optional[list[int]]):
    conds = [AmoTask.analyst_id == analyst_id]
    if tracked_types:
        conds.append(AmoTask.task_type.in_(tracked_types))
    return and_(*conds)


def compute_analyst_metrics(
    db: Session,
    analyst_id: UUID,
    *,
    period_from: datetime,
    period_to: datetime,
    tracked_types: Optional[list[int]] = None,
    now: Optional[datetime] = None,
) -> AnalystMetrics:
    analyst = db.get(Analyst, analyst_id)
    if analyst is None:
        raise ValueError(f"Analyst {analyst_id} not found")

    if now is None:
        now = datetime.now(timezone.utc)

    base = _base_filter(analyst_id, tracked_types)

    # Закрыто за период (с дедлайном — без срока не учитываем для % просрочки)
    closed_total = db.execute(
        select(func.count()).select_from(AmoTask).where(
            base,
            AmoTask.is_completed.is_(True),
            AmoTask.completed_at >= period_from,
            AmoTask.completed_at < period_to,
            AmoTask.deadline_initial.is_not(None),
        )
    ).scalar_one()

    # Закрыто с просрочкой
    closed_overdue = db.execute(
        select(func.count()).select_from(AmoTask).where(
            base,
            AmoTask.is_completed.is_(True),
            AmoTask.completed_at >= period_from,
            AmoTask.completed_at < period_to,
            AmoTask.deadline_initial.is_not(None),
            AmoTask.is_overdue.is_(True),
        )
    ).scalar_one()

    overdue_pct = (closed_overdue / closed_total * 100.0) if closed_total else 0.0

    # Средняя длительность просрочки — считаем в Python, агностично к диалекту
    rows = db.execute(
        select(AmoTask.completed_at, AmoTask.deadline_initial).where(
            base,
            AmoTask.is_completed.is_(True),
            AmoTask.completed_at >= period_from,
            AmoTask.completed_at < period_to,
            AmoTask.deadline_initial.is_not(None),
            AmoTask.is_overdue.is_(True),
        )
    ).all()
    if rows:
        total_seconds = sum((_ensure_aware(c) - _ensure_aware(d)).total_seconds() for c, d in rows)
        avg_overdue_seconds: Optional[float] = total_seconds / len(rows)
    else:
        avg_overdue_seconds = None

    # Открытые просрочки (на момент now)
    open_overdue = db.execute(
        select(func.count()).select_from(AmoTask).where(
            base,
            AmoTask.is_completed.is_(False),
            AmoTask.deadline_current.is_not(None),
            AmoTask.deadline_current < now,
        )
    ).scalar_one()

    # Открытые без срока (отдельная строка по ТЗ §5.2)
    open_no_deadline = db.execute(
        select(func.count()).select_from(AmoTask).where(
            base,
            AmoTask.is_completed.is_(False),
            AmoTask.deadline_initial.is_(None),
        )
    ).scalar_one()

    return AnalystMetrics(
        analyst_id=str(analyst.id),
        analyst_name=analyst.full_name,
        period_from=period_from.isoformat(),
        period_to=period_to.isoformat(),
        closed_total=int(closed_total),
        closed_overdue=int(closed_overdue),
        overdue_pct=round(overdue_pct, 2),
        avg_overdue_seconds=round(avg_overdue_seconds, 2) if avg_overdue_seconds is not None else None,
        open_overdue=int(open_overdue),
        open_no_deadline=int(open_no_deadline),
    )


def compute_dashboard(
    db: Session,
    *,
    period_from: datetime,
    period_to: datetime,
    tracked_types: Optional[list[int]] = None,
    now: Optional[datetime] = None,
) -> list[dict]:
    analysts = db.execute(
        select(Analyst).where(Analyst.status == AnalystStatus.active).order_by(Analyst.full_name)
    ).scalars().all()
    rows: list[dict] = []
    for a in analysts:
        m = compute_analyst_metrics(
            db,
            a.id,
            period_from=period_from,
            period_to=period_to,
            tracked_types=tracked_types,
            now=now,
        )
        rows.append(asdict(m))
    # рейтинг по % просрочек ASC при равенстве — closed_total DESC
    rows.sort(key=lambda r: (r["overdue_pct"], -r["closed_total"]))
    return rows


def default_period(from_: Optional[datetime], to: Optional[datetime]) -> tuple[datetime, datetime]:
    """Дефолт по ТЗ — последние 30 дней."""
    if to is None:
        to = datetime.now(timezone.utc)
    if from_ is None:
        from_ = to - timedelta(days=30)
    if from_.tzinfo is None:
        from_ = from_.replace(tzinfo=timezone.utc)
    if to.tzinfo is None:
        to = to.replace(tzinfo=timezone.utc)
    return from_, to
