from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4


def _make_analyst(db, amo_user_id=42, name="A"):
    from app.models import Analyst, AnalystStatus

    a = Analyst(
        id=uuid4(),
        full_name=name,
        email=f"a-{amo_user_id}@example.com",
        amo_user_id=amo_user_id,
        default_rate=Decimal("0"),
        payment_details={},
        status=AnalystStatus.active,
    )
    db.add(a)
    db.commit()
    return a


def _make_task(
    db,
    *,
    analyst_id,
    amo_task_id,
    is_completed=False,
    deadline_initial=None,
    deadline_current=None,
    completed_at=None,
    is_overdue=False,
    task_type=1,
):
    from app.models import AmoTask

    t = AmoTask(
        id=uuid4(),
        amo_task_id=amo_task_id,
        analyst_id=analyst_id,
        task_type=task_type,
        deadline_initial=deadline_initial,
        deadline_current=deadline_current or deadline_initial,
        is_completed=is_completed,
        completed_at=completed_at,
        is_overdue=is_overdue,
    )
    db.add(t)
    return t


def test_empty_metrics_returns_zeros(db_session):
    from app.services.metrics import compute_analyst_metrics

    a = _make_analyst(db_session)
    period_to = datetime(2026, 5, 31, tzinfo=timezone.utc)
    period_from = period_to - timedelta(days=30)

    m = compute_analyst_metrics(db_session, a.id, period_from=period_from, period_to=period_to)
    assert m.closed_total == 0
    assert m.closed_overdue == 0
    assert m.overdue_pct == 0.0
    assert m.avg_overdue_seconds is None
    assert m.open_overdue == 0
    assert m.open_no_deadline == 0


def test_basic_overdue_percent_and_avg(db_session):
    from app.services.metrics import compute_analyst_metrics

    a = _make_analyst(db_session)
    period_from = datetime(2026, 5, 1, tzinfo=timezone.utc)
    period_to = datetime(2026, 5, 31, tzinfo=timezone.utc)

    # 4 закрытых задачи в периоде, 1 — без срока (исключается), 1 — открытая и просроченная
    # 2 из 3 учитываемых — с просрочкой
    deadline = datetime(2026, 5, 10, 12, 0, tzinfo=timezone.utc)
    _make_task(
        db_session, analyst_id=a.id, amo_task_id=1, is_completed=True,
        deadline_initial=deadline, completed_at=deadline + timedelta(hours=2), is_overdue=True,
    )
    _make_task(
        db_session, analyst_id=a.id, amo_task_id=2, is_completed=True,
        deadline_initial=deadline, completed_at=deadline + timedelta(hours=4), is_overdue=True,
    )
    _make_task(
        db_session, analyst_id=a.id, amo_task_id=3, is_completed=True,
        deadline_initial=deadline, completed_at=deadline - timedelta(hours=1), is_overdue=False,
    )
    _make_task(
        db_session, analyst_id=a.id, amo_task_id=4, is_completed=True,
        deadline_initial=None, completed_at=deadline, is_overdue=False,  # без срока — исключается
    )
    _make_task(
        db_session, analyst_id=a.id, amo_task_id=5, is_completed=False,
        deadline_initial=deadline, deadline_current=deadline, is_overdue=False,  # открытая
    )
    _make_task(
        db_session, analyst_id=a.id, amo_task_id=6, is_completed=False,
        deadline_initial=None, deadline_current=None, is_overdue=False,  # открытая без срока
    )
    db_session.commit()

    # now после deadline — открытая 5 должна попасть в open_overdue
    now = datetime(2026, 5, 15, tzinfo=timezone.utc)
    m = compute_analyst_metrics(db_session, a.id, period_from=period_from, period_to=period_to, now=now)
    assert m.closed_total == 3
    assert m.closed_overdue == 2
    assert m.overdue_pct == round(2 / 3 * 100, 2)
    # средняя по 2 просрочкам: 2ч и 4ч → 3ч
    assert m.avg_overdue_seconds == 3 * 3600
    assert m.open_overdue == 1
    assert m.open_no_deadline == 1


def test_period_filtering_excludes_outside_range(db_session):
    from app.services.metrics import compute_analyst_metrics

    a = _make_analyst(db_session)
    deadline = datetime(2026, 5, 10, 12, 0, tzinfo=timezone.utc)
    # одна закрыта внутри периода, одна — вне
    _make_task(
        db_session, analyst_id=a.id, amo_task_id=10, is_completed=True,
        deadline_initial=deadline, completed_at=deadline, is_overdue=False,
    )
    _make_task(
        db_session, analyst_id=a.id, amo_task_id=11, is_completed=True,
        deadline_initial=deadline, completed_at=datetime(2026, 4, 1, tzinfo=timezone.utc), is_overdue=False,
    )
    db_session.commit()

    m = compute_analyst_metrics(
        db_session, a.id,
        period_from=datetime(2026, 5, 1, tzinfo=timezone.utc),
        period_to=datetime(2026, 5, 31, tzinfo=timezone.utc),
    )
    assert m.closed_total == 1


def test_tracked_task_types_filter(db_session):
    from app.services.metrics import compute_analyst_metrics

    a = _make_analyst(db_session)
    deadline = datetime(2026, 5, 10, 12, 0, tzinfo=timezone.utc)
    _make_task(
        db_session, analyst_id=a.id, amo_task_id=20, is_completed=True,
        deadline_initial=deadline, completed_at=deadline, is_overdue=False, task_type=1,
    )
    _make_task(
        db_session, analyst_id=a.id, amo_task_id=21, is_completed=True,
        deadline_initial=deadline, completed_at=deadline, is_overdue=False, task_type=2,
    )
    db_session.commit()

    period_from = datetime(2026, 5, 1, tzinfo=timezone.utc)
    period_to = datetime(2026, 5, 31, tzinfo=timezone.utc)

    m_all = compute_analyst_metrics(db_session, a.id, period_from=period_from, period_to=period_to)
    assert m_all.closed_total == 2

    m_only_1 = compute_analyst_metrics(
        db_session, a.id, period_from=period_from, period_to=period_to, tracked_types=[1]
    )
    assert m_only_1.closed_total == 1


def test_dashboard_sorts_by_overdue_pct(db_session):
    from app.services.metrics import compute_dashboard

    a1 = _make_analyst(db_session, amo_user_id=1, name="Better")
    a2 = _make_analyst(db_session, amo_user_id=2, name="Worse")
    deadline = datetime(2026, 5, 10, 12, 0, tzinfo=timezone.utc)

    # a1: 0/1 просрочек
    _make_task(
        db_session, analyst_id=a1.id, amo_task_id=30, is_completed=True,
        deadline_initial=deadline, completed_at=deadline, is_overdue=False,
    )
    # a2: 1/1 просрочка
    _make_task(
        db_session, analyst_id=a2.id, amo_task_id=31, is_completed=True,
        deadline_initial=deadline, completed_at=deadline + timedelta(hours=1), is_overdue=True,
    )
    db_session.commit()

    rows = compute_dashboard(
        db_session,
        period_from=datetime(2026, 5, 1, tzinfo=timezone.utc),
        period_to=datetime(2026, 5, 31, tzinfo=timezone.utc),
    )
    # Better — первой (меньше % просрочек)
    assert rows[0]["analyst_name"] == "Better"
    assert rows[1]["analyst_name"] == "Worse"
    assert rows[0]["overdue_pct"] == 0.0
    assert rows[1]["overdue_pct"] == 100.0
