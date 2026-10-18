"""Интеграционные тесты процессора вебхуков на SQLite (с подменой JSONB → JSON).

PostgreSQL-специфика (gen_random_uuid, JSONB, enums) подменяется тут на
переносимые типы — мы тестируем бизнес-логику, не DDL-нюансы.
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import sessionmaker
from sqlalchemy.types import JSON


@pytest.fixture()
def db():
    from app.db.base import Base
    from app.models import Analyst, Setting  # noqa: F401  — регистрация в metadata
    import app.models  # noqa: F401

    # Переписываем PG-специфику на портируемые типы прямо в колонках.
    # JSONB → JSON; gen_random_uuid() → uuid4() на стороне Python (default).
    from uuid import uuid4

    for table in Base.metadata.tables.values():
        for col in table.columns:
            if isinstance(col.type, postgresql.JSONB):
                col.type = JSON()
            if col.server_default is not None and "gen_random_uuid" in str(col.server_default.arg):
                col.server_default = None
                if col.default is None and col.primary_key:
                    col.default = lambda: uuid4()

    eng = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(eng)
    Session = sessionmaker(bind=eng, future=True, autoflush=False)
    s = Session()
    try:
        yield s
    finally:
        s.close()


def _make_analyst(db, amo_user_id=42):
    from app.models import Analyst, AnalystStatus

    a = Analyst(
        id=uuid4(),
        full_name="Test Analyst",
        email=f"a-{amo_user_id}@test.local",
        amo_user_id=amo_user_id,
        default_rate=Decimal("15000"),
        payment_details={},
        status=AnalystStatus.active,
    )
    db.add(a)
    db.commit()
    return a


def test_start_project_creates_project(db):
    from app.models import ProjectStatus, StatusAction
    from app.services.webhook_processor import apply_action

    a = _make_analyst(db)
    outcome = apply_action(
        db,
        StatusAction.start_project,
        amo_deal_id=1001,
        deal_name="New Deal",
        responsible_amo_user_id=a.amo_user_id,
        amo_status_id=111,
    )
    db.commit()
    assert "project_created" in outcome.notes

    from app.models import Project

    project = db.query(Project).filter_by(amo_deal_id=1001).one()
    assert project.status == ProjectStatus.in_progress
    assert project.analyst_id == a.id
    assert project.payment_amount == Decimal("15000")


def test_start_project_is_idempotent(db):
    from app.models import StatusAction
    from app.services.webhook_processor import apply_action

    a = _make_analyst(db)
    apply_action(db, StatusAction.start_project, amo_deal_id=1002, responsible_amo_user_id=a.amo_user_id)
    apply_action(db, StatusAction.start_project, amo_deal_id=1002, responsible_amo_user_id=a.amo_user_id)
    db.commit()

    from app.models import Project

    assert db.query(Project).filter_by(amo_deal_id=1002).count() == 1


def test_start_project_skips_when_analyst_not_mapped(db):
    from app.models import StatusAction
    from app.services.webhook_processor import apply_action

    outcome = apply_action(
        db,
        StatusAction.start_project,
        amo_deal_id=1003,
        responsible_amo_user_id=999999,
    )
    db.commit()
    assert "analyst_not_mapped" in outcome.notes

    from app.models import Project

    assert db.query(Project).filter_by(amo_deal_id=1003).count() == 0


def test_mark_done_creates_accrued_payment(db):
    from app.models import Payment, PaymentStatus, ProjectStatus, StatusAction
    from app.services.webhook_processor import apply_action

    a = _make_analyst(db, amo_user_id=43)
    apply_action(db, StatusAction.start_project, amo_deal_id=1004, responsible_amo_user_id=a.amo_user_id)
    db.commit()
    apply_action(db, StatusAction.mark_done, amo_deal_id=1004)
    db.commit()

    from app.models import Project

    project = db.query(Project).filter_by(amo_deal_id=1004).one()
    assert project.status == ProjectStatus.done
    assert project.completed_at is not None

    payments = db.query(Payment).filter_by(project_id=project.id).all()
    assert len(payments) == 1
    assert payments[0].status == PaymentStatus.accrued
    assert payments[0].amount == Decimal("15000")


def test_mark_done_does_not_double_create_payment(db):
    from app.models import Payment, StatusAction
    from app.services.webhook_processor import apply_action

    a = _make_analyst(db, amo_user_id=44)
    apply_action(db, StatusAction.start_project, amo_deal_id=1005, responsible_amo_user_id=a.amo_user_id)
    apply_action(db, StatusAction.mark_done, amo_deal_id=1005)
    apply_action(db, StatusAction.mark_done, amo_deal_id=1005)
    db.commit()

    from app.models import Project

    project = db.query(Project).filter_by(amo_deal_id=1005).one()
    assert db.query(Payment).filter_by(project_id=project.id).count() == 1


def test_mark_ready_promotes_accrued_to_ready(db):
    from app.models import Payment, PaymentStatus, StatusAction
    from app.services.webhook_processor import apply_action

    a = _make_analyst(db, amo_user_id=45)
    apply_action(db, StatusAction.start_project, amo_deal_id=1006, responsible_amo_user_id=a.amo_user_id)
    apply_action(db, StatusAction.mark_done, amo_deal_id=1006)
    apply_action(db, StatusAction.mark_ready_for_payout, amo_deal_id=1006)
    db.commit()

    from app.models import Project

    project = db.query(Project).filter_by(amo_deal_id=1006).one()
    payment = db.query(Payment).filter_by(project_id=project.id).one()
    assert payment.status == PaymentStatus.ready


def test_cancel_cancels_project_and_pending_payments(db):
    from app.models import Payment, PaymentStatus, ProjectStatus, StatusAction
    from app.services.webhook_processor import apply_action

    a = _make_analyst(db, amo_user_id=46)
    apply_action(db, StatusAction.start_project, amo_deal_id=1007, responsible_amo_user_id=a.amo_user_id)
    apply_action(db, StatusAction.mark_done, amo_deal_id=1007)
    apply_action(db, StatusAction.cancel, amo_deal_id=1007)
    db.commit()

    from app.models import Project

    project = db.query(Project).filter_by(amo_deal_id=1007).one()
    assert project.status == ProjectStatus.cancelled
    payment = db.query(Payment).filter_by(project_id=project.id).one()
    assert payment.status == PaymentStatus.cancelled


def test_cancel_does_not_touch_already_paid_payments(db):
    from app.models import Payment, PaymentStatus, StatusAction
    from app.services.webhook_processor import apply_action

    a = _make_analyst(db, amo_user_id=47)
    apply_action(db, StatusAction.start_project, amo_deal_id=1008, responsible_amo_user_id=a.amo_user_id)
    apply_action(db, StatusAction.mark_done, amo_deal_id=1008)
    db.commit()
    from app.models import Project

    project = db.query(Project).filter_by(amo_deal_id=1008).one()
    payment = db.query(Payment).filter_by(project_id=project.id).one()
    payment.status = PaymentStatus.paid
    payment.paid_at = datetime.now(timezone.utc)
    db.commit()

    apply_action(db, StatusAction.cancel, amo_deal_id=1008)
    db.commit()
    db.refresh(payment)
    assert payment.status == PaymentStatus.paid  # уже выплачено — не трогаем


def test_status_rollback_is_blocked(db):
    from app.models import ProjectStatus, StatusAction
    from app.services.webhook_processor import apply_action

    a = _make_analyst(db, amo_user_id=48)
    apply_action(db, StatusAction.start_project, amo_deal_id=1009, responsible_amo_user_id=a.amo_user_id)
    apply_action(db, StatusAction.mark_done, amo_deal_id=1009)
    apply_action(db, StatusAction.mark_ready_for_payout, amo_deal_id=1009)
    db.commit()

    # эмулируем «откатили в работу»: маппинг даёт mark_done после ready_for_payout
    from app.models import Project, Payment, PaymentStatus

    project = db.query(Project).filter_by(amo_deal_id=1009).one()
    payment = db.query(Payment).filter_by(project_id=project.id).one()
    payment.status = PaymentStatus.paid  # дошли до paid
    project.status = ProjectStatus.paid
    db.commit()

    # теперь mark_done должно быть заблокировано как откат
    outcome = apply_action(db, StatusAction.mark_done, amo_deal_id=1009)
    db.commit()
    assert outcome.rollback_blocked is True
    db.refresh(project)
    assert project.status == ProjectStatus.paid  # не изменился


def test_extract_lead_facts():
    from app.services.webhook_processor import extract_lead_facts

    payload = {
        "leads": {
            "update": [
                {"id": "42", "status_id": "111", "responsible_user_id": "5", "name": "X", "price": "1000.50"},
                {"id": "noise"},  # пропускается
            ],
            "add": [{"id": 43, "status_id": 222}],
        }
    }
    facts = extract_lead_facts(payload)
    assert len(facts) == 2
    assert facts[0]["amo_deal_id"] == 42
    assert facts[0]["amo_status_id"] == 111
    assert facts[0]["responsible_amo_user_id"] == 5
    assert facts[0]["price"] == Decimal("1000.50")
    assert facts[1]["amo_deal_id"] == 43
    assert facts[1]["amo_status_id"] == 222
