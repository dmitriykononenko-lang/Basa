"""End-to-end Фазы 3: задачи и метрики через HTTP API."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.types import JSON


@pytest.fixture()
def env(monkeypatch):
    from app.db.base import Base
    import app.models  # noqa: F401
    from app.core.security import hash_password
    from app.models import User, UserRole

    for table in Base.metadata.tables.values():
        for col in table.columns:
            if isinstance(col.type, postgresql.JSONB):
                col.type = JSON()
            if col.server_default is not None and "gen_random_uuid" in str(col.server_default.arg):
                col.server_default = None
                if col.default is None and col.primary_key:
                    col.default = lambda: uuid4()

    engine = create_engine(
        "sqlite:///:memory:",
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

    from app.db import session as session_mod

    session_mod.engine = engine
    session_mod.SessionLocal = TestingSession

    db = TestingSession()

    admin = User(
        email="admin@example.com",
        password_hash=hash_password("admin12345"),
        role=UserRole.admin,
        is_active=True,
    )
    db.add(admin)
    db.commit()

    from app.main import app

    def _get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[session_mod.get_db] = _get_db

    # Шунтим очередь на синхрон
    from app.services import queue as queue_mod
    from app.services.webhook_processor import process_webhook_log

    def fake_enqueue(log_id):
        process_webhook_log(db, UUID(str(log_id)))
        return f"sync-{log_id}"

    monkeypatch.setattr(queue_mod, "enqueue_webhook_log", fake_enqueue)
    monkeypatch.setattr("app.api.v1.endpoints.amo.enqueue_webhook_log", fake_enqueue)
    monkeypatch.setattr("app.api.v1.endpoints.webhook_log.enqueue_webhook_log", fake_enqueue)

    yield {"client": TestClient(app), "db": db}
    db.close()
    app.dependency_overrides.clear()


def _login(client, email, password):
    r = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


def test_task_webhook_flow_to_metrics(env):
    client = env["client"]
    db = env["db"]
    admin_token = _login(client, "admin@example.com", "admin12345")

    # Аналитик
    r = client.post(
        "/api/v1/analysts",
        headers=_hdr(admin_token),
        json={"full_name": "T1", "email": "t1@example.com", "amo_user_id": 42, "default_rate": 0},
    )
    analyst_id = r.json()["id"]

    # Старт задачи через вебхук
    deadline_ts = int(datetime(2026, 5, 10, 12, 0, tzinfo=timezone.utc).timestamp())
    r = client.post(
        "/api/v1/amo/webhooks",
        json={"tasks": {"add": [{"id": "9001", "responsible_user_id": "42", "task_type_id": "1", "complete_till": str(deadline_ts), "updated_at": "1"}]}},
    )
    assert r.status_code == 200, r.text

    # Переносим дедлайн (новый webhook), потом закрываем после первоначального
    new_deadline_ts = int(datetime(2026, 5, 20, 12, 0, tzinfo=timezone.utc).timestamp())
    client.post(
        "/api/v1/amo/webhooks",
        json={"tasks": {"update": [{"id": "9001", "responsible_user_id": "42", "complete_till": str(new_deadline_ts), "updated_at": "2"}]}},
    )

    completed_ts = int(datetime(2026, 5, 12, 12, 0, tzinfo=timezone.utc).timestamp())
    client.post(
        "/api/v1/amo/webhooks",
        json={"tasks": {"complete": [{"id": "9001", "is_completed": True, "updated_at": str(completed_ts)}]}},
    )

    # Метрики — задача учтена как просроченная, потому что closed > initial
    r = client.get(
        f"/api/v1/metrics/analyst/{analyst_id}"
        f"?from=2026-05-01T00:00:00Z&to=2026-05-31T00:00:00Z",
        headers=_hdr(admin_token),
    )
    assert r.status_code == 200, r.text
    m = r.json()
    assert m["closed_total"] == 1
    assert m["closed_overdue"] == 1
    assert m["overdue_pct"] == 100.0
    assert m["avg_overdue_seconds"] == 2 * 24 * 3600  # 2 дня


def test_dashboard_returns_all_analysts_for_admin(env):
    client = env["client"]
    admin_token = _login(client, "admin@example.com", "admin12345")
    client.post(
        "/api/v1/analysts", headers=_hdr(admin_token),
        json={"full_name": "X", "email": "x@example.com", "amo_user_id": 1, "default_rate": 0},
    )
    client.post(
        "/api/v1/analysts", headers=_hdr(admin_token),
        json={"full_name": "Y", "email": "y@example.com", "amo_user_id": 2, "default_rate": 0},
    )
    r = client.get("/api/v1/metrics/dashboard", headers=_hdr(admin_token))
    assert r.status_code == 200, r.text
    assert len(r.json()["rows"]) == 2


def test_dashboard_filters_to_own_for_analyst_role(env):
    client = env["client"]
    db = env["db"]
    admin_token = _login(client, "admin@example.com", "admin12345")

    r = client.post(
        "/api/v1/analysts", headers=_hdr(admin_token),
        json={"full_name": "Mine", "email": "mine@example.com", "amo_user_id": 1, "default_rate": 0},
    )
    a1_id = r.json()["id"]
    client.post(
        "/api/v1/analysts", headers=_hdr(admin_token),
        json={"full_name": "Other", "email": "other@example.com", "amo_user_id": 2, "default_rate": 0},
    )

    # пользователь-аналитик, привязанный к a1
    from app.core.security import hash_password
    from app.models import Analyst, User, UserRole

    u = User(email="mineuser@example.com", password_hash=hash_password("u12345"), role=UserRole.analyst, is_active=True)
    db.add(u)
    db.flush()
    db.get(Analyst, UUID(a1_id)).user_id = u.id
    db.commit()

    tok = _login(client, "mineuser@example.com", "u12345")
    r = client.get("/api/v1/metrics/dashboard", headers=_hdr(tok))
    rows = r.json()["rows"]
    assert len(rows) == 1
    assert rows[0]["analyst_id"] == a1_id


def test_analyst_cannot_see_others_metrics(env):
    client = env["client"]
    db = env["db"]
    admin_token = _login(client, "admin@example.com", "admin12345")

    r = client.post(
        "/api/v1/analysts", headers=_hdr(admin_token),
        json={"full_name": "Mine", "email": "mine@example.com", "amo_user_id": 1, "default_rate": 0},
    )
    a1_id = r.json()["id"]
    r = client.post(
        "/api/v1/analysts", headers=_hdr(admin_token),
        json={"full_name": "Other", "email": "other@example.com", "amo_user_id": 2, "default_rate": 0},
    )
    other_id = r.json()["id"]

    from app.core.security import hash_password
    from app.models import Analyst, User, UserRole

    u = User(email="mineuser@example.com", password_hash=hash_password("u12345"), role=UserRole.analyst, is_active=True)
    db.add(u)
    db.flush()
    db.get(Analyst, UUID(a1_id)).user_id = u.id
    db.commit()

    tok = _login(client, "mineuser@example.com", "u12345")
    # своя — OK
    assert client.get(f"/api/v1/metrics/analyst/{a1_id}", headers=_hdr(tok)).status_code == 200
    # чужая — 403
    assert client.get(f"/api/v1/metrics/analyst/{other_id}", headers=_hdr(tok)).status_code == 403


def test_tracked_task_types_setting_applies_to_metrics(env):
    client = env["client"]
    db = env["db"]
    admin_token = _login(client, "admin@example.com", "admin12345")

    r = client.post(
        "/api/v1/analysts", headers=_hdr(admin_token),
        json={"full_name": "A", "email": "a@example.com", "amo_user_id": 1, "default_rate": 0},
    )
    analyst_id = r.json()["id"]

    # две задачи разных типов, обе закрыты в срок
    deadline_ts = int(datetime(2026, 5, 10, 12, 0, tzinfo=timezone.utc).timestamp())
    for task_id, type_id in (("8001", "1"), ("8002", "2")):
        client.post(
            "/api/v1/amo/webhooks",
            json={"tasks": {"add": [{"id": task_id, "responsible_user_id": "1", "task_type_id": type_id, "complete_till": str(deadline_ts), "updated_at": "1"}]}},
        )
        client.post(
            "/api/v1/amo/webhooks",
            json={"tasks": {"complete": [{"id": task_id, "is_completed": True, "updated_at": str(deadline_ts)}]}},
        )

    # без фильтра — обе считаются
    r = client.get(
        f"/api/v1/metrics/analyst/{analyst_id}?from=2026-05-01T00:00:00Z&to=2026-05-31T00:00:00Z",
        headers=_hdr(admin_token),
    )
    assert r.json()["closed_total"] == 2

    # ставим фильтр на тип 1
    r = client.put(
        "/api/v1/settings/tracked_task_types",
        headers=_hdr(admin_token),
        json={"types": [1]},
    )
    assert r.status_code == 200

    r = client.get(
        f"/api/v1/metrics/analyst/{analyst_id}?from=2026-05-01T00:00:00Z&to=2026-05-31T00:00:00Z",
        headers=_hdr(admin_token),
    )
    assert r.json()["closed_total"] == 1
