from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4


def _make_analyst(db, amo_user_id=42):
    from app.models import Analyst, AnalystStatus

    a = Analyst(
        id=uuid4(),
        full_name="Test",
        email=f"t-{amo_user_id}@example.com",
        amo_user_id=amo_user_id,
        default_rate=Decimal("0"),
        payment_details={},
        status=AnalystStatus.active,
    )
    db.add(a)
    db.commit()
    return a


def test_extract_task_facts_from_webhook_payload():
    from app.services.task_processor import extract_task_facts

    payload = {
        "tasks": {
            "add": [
                {
                    "id": "100",
                    "entity_id": "999",
                    "responsible_user_id": "42",
                    "task_type_id": "1",
                    "text": "Позвонить клиенту",
                    "complete_till": "1700000000",
                }
            ],
            "complete": [
                {"id": 101, "is_completed": True, "updated_at": "1700001000"},
            ],
        }
    }
    facts = extract_task_facts(payload)
    assert len(facts) == 2
    f1 = facts[0]
    assert f1.action == "add"
    assert f1.amo_task_id == 100
    assert f1.amo_entity_id == 999
    assert f1.task_type == 1
    assert f1.deadline == datetime(2023, 11, 14, 22, 13, 20, tzinfo=timezone.utc)
    f2 = facts[1]
    assert f2.action == "complete"
    assert f2.is_completed is True
    assert f2.completed_at == datetime(2023, 11, 14, 22, 30, 0, tzinfo=timezone.utc)


def test_first_deadline_fixed_on_create(db_session):
    from app.models import AmoTask
    from app.services.task_processor import TaskFact, _ensure_aware, apply_task_fact

    a = _make_analyst(db_session)
    initial = datetime(2026, 5, 1, 10, 0, tzinfo=timezone.utc)

    apply_task_fact(
        db_session,
        TaskFact(action="add", amo_task_id=500, responsible_amo_user_id=a.amo_user_id, deadline=initial),
    )
    db_session.commit()

    task = db_session.query(AmoTask).filter_by(amo_task_id=500).one()
    assert _ensure_aware(task.deadline_initial) == initial
    assert _ensure_aware(task.deadline_current) == initial


def test_subsequent_deadline_updates_current_not_initial(db_session):
    from app.models import AmoTask
    from app.services.task_processor import TaskFact, _ensure_aware, apply_task_fact

    a = _make_analyst(db_session)
    initial = datetime(2026, 5, 1, 10, 0, tzinfo=timezone.utc)
    moved = datetime(2026, 5, 5, 10, 0, tzinfo=timezone.utc)

    apply_task_fact(
        db_session,
        TaskFact(action="add", amo_task_id=501, responsible_amo_user_id=a.amo_user_id, deadline=initial),
    )
    apply_task_fact(
        db_session,
        TaskFact(action="update", amo_task_id=501, responsible_amo_user_id=a.amo_user_id, deadline=moved),
    )
    db_session.commit()

    task = db_session.query(AmoTask).filter_by(amo_task_id=501).one()
    assert _ensure_aware(task.deadline_initial) == initial  # не изменилось
    assert _ensure_aware(task.deadline_current) == moved


def test_complete_before_deadline_not_overdue(db_session):
    from app.models import AmoTask
    from app.services.task_processor import TaskFact, apply_task_fact

    a = _make_analyst(db_session)
    deadline = datetime(2026, 5, 10, 12, 0, tzinfo=timezone.utc)
    early = datetime(2026, 5, 9, 12, 0, tzinfo=timezone.utc)

    apply_task_fact(
        db_session,
        TaskFact(action="add", amo_task_id=510, responsible_amo_user_id=a.amo_user_id, deadline=deadline),
    )
    apply_task_fact(
        db_session,
        TaskFact(action="complete", amo_task_id=510, is_completed=True, completed_at=early),
    )
    db_session.commit()

    t = db_session.query(AmoTask).filter_by(amo_task_id=510).one()
    assert t.is_completed is True
    assert t.is_overdue is False


def test_complete_after_initial_deadline_is_overdue_even_if_moved(db_session):
    """Сценарий из ТЗ §5.2: аналитик подвинул дедлайн и закрыл раньше нового,
    но позже первоначального → всё равно просрочка."""
    from app.models import AmoTask
    from app.services.task_processor import TaskFact, _ensure_aware, apply_task_fact

    a = _make_analyst(db_session)
    initial = datetime(2026, 5, 1, 12, 0, tzinfo=timezone.utc)
    moved = datetime(2026, 5, 20, 12, 0, tzinfo=timezone.utc)
    closed = datetime(2026, 5, 10, 12, 0, tzinfo=timezone.utc)  # после initial, до moved

    apply_task_fact(
        db_session,
        TaskFact(action="add", amo_task_id=520, responsible_amo_user_id=a.amo_user_id, deadline=initial),
    )
    apply_task_fact(
        db_session,
        TaskFact(action="update", amo_task_id=520, responsible_amo_user_id=a.amo_user_id, deadline=moved),
    )
    apply_task_fact(
        db_session,
        TaskFact(action="complete", amo_task_id=520, is_completed=True, completed_at=closed),
    )
    db_session.commit()

    t = db_session.query(AmoTask).filter_by(amo_task_id=520).one()
    assert t.is_overdue is True
    assert _ensure_aware(t.deadline_initial) == initial  # неизменный
    assert _ensure_aware(t.deadline_current) == moved


def test_task_without_deadline_not_marked_overdue(db_session):
    from app.models import AmoTask
    from app.services.task_processor import TaskFact, apply_task_fact

    a = _make_analyst(db_session)
    apply_task_fact(
        db_session,
        TaskFact(action="add", amo_task_id=530, responsible_amo_user_id=a.amo_user_id, deadline=None),
    )
    apply_task_fact(
        db_session,
        TaskFact(
            action="complete",
            amo_task_id=530,
            is_completed=True,
            completed_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
        ),
    )
    db_session.commit()

    t = db_session.query(AmoTask).filter_by(amo_task_id=530).one()
    assert t.is_completed is True
    assert t.deadline_initial is None
    assert t.is_overdue is False


def test_unmapped_responsible_user_results_in_null_analyst(db_session):
    from app.models import AmoTask
    from app.services.task_processor import TaskFact, apply_task_fact

    apply_task_fact(
        db_session,
        TaskFact(action="add", amo_task_id=540, responsible_amo_user_id=999999),
    )
    db_session.commit()
    t = db_session.query(AmoTask).filter_by(amo_task_id=540).one()
    assert t.analyst_id is None
