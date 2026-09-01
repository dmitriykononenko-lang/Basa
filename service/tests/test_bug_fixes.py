"""Регрессы по найденным при ручном тестировании багам.

1. PATCH /payments/{id} со status='paid' должен двигать project в paid
   (так же, как mark-paid эндпоинт).
2. /settings/{key} не должен принимать произвольные ключи — только публичные.
   В частности, не должен отдавать `amo_oauth_tokens` (зашифрованные токены).
3. PATCH /analysts/{id} с несуществующим user_id → 400, с уже занятым → 409,
   не 500.
"""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.types import JSON


@pytest.fixture()
def env():
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
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    from app.db import session as session_mod
    session_mod.engine = engine
    session_mod.SessionLocal = Session

    db = Session()
    db.add(User(email="admin@example.com", password_hash=hash_password("password1"),
                role=UserRole.admin, is_active=True))
    db.commit()

    from app.main import app
    def _get_db():
        try:
            yield db
        finally:
            pass
    app.dependency_overrides[session_mod.get_db] = _get_db

    yield {"client": TestClient(app), "db": db}
    db.close()
    app.dependency_overrides.clear()


def _login(client, email="admin@example.com", password="password1"):
    return client.post("/api/v1/auth/login",
                       json={"email": email, "password": password}).json()["access_token"]


def _hdr(t): return {"Authorization": f"Bearer {t}"}


def test_patch_payment_to_paid_moves_project_to_paid(env):
    """PATCH /payments/{id} status='paid' должен и payment, и проект двигать."""
    from app.models import Analyst, AnalystStatus, Payment, PaymentStatus, Project, ProjectStatus

    client = env["client"]
    db = env["db"]
    tok = _login(client)

    a = Analyst(id=uuid4(), full_name="A", email="a@example.com", amo_user_id=1,
                default_rate=Decimal("100"), payment_details={}, status=AnalystStatus.active)
    db.add(a)
    db.flush()
    p = Project(id=uuid4(), name="P", analyst_id=a.id,
                payment_amount=Decimal("100"), status=ProjectStatus.done)
    db.add(p)
    db.flush()
    pay = Payment(id=uuid4(), project_id=p.id, analyst_id=a.id,
                  amount=Decimal("100"), status=PaymentStatus.ready)
    db.add(pay)
    db.commit()

    r = client.patch(f"/api/v1/payments/{pay.id}",
                     headers=_hdr(tok),
                     json={"status": "paid", "reason": "manual"})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "paid"

    # обновляем сессию и проверяем — проект тоже paid
    db.refresh(p)
    assert p.status == ProjectStatus.paid


def test_settings_unknown_key_returns_404(env):
    client = env["client"]
    tok = _login(client)
    r = client.get("/api/v1/settings/amo_oauth_tokens", headers=_hdr(tok))
    assert r.status_code == 404
    assert "Allowed" in r.json()["detail"]

    r = client.put("/api/v1/settings/anything_else", headers=_hdr(tok), json={"x": 1})
    assert r.status_code == 404


def test_settings_oauth_state_not_exposed_via_put(env):
    """OAuth state — внутреннее, не должно перезаписываться извне."""
    client = env["client"]
    tok = _login(client)
    r = client.put("/api/v1/settings/amo_oauth_state",
                   headers=_hdr(tok), json={"state": "spoofed"})
    assert r.status_code == 404


def test_settings_known_keys_work(env):
    client = env["client"]
    tok = _login(client)
    # все три публичных ключа должны принимать корректные значения
    for key, body in (
        ("amo_status_map", {"111": "start_project"}),
        ("amo_webhook_allowed_ips", {"ips": ["10.0.0.0/8"]}),
        ("tracked_task_types", {"types": [1, 2]}),
    ):
        r = client.put(f"/api/v1/settings/{key}", headers=_hdr(tok), json=body)
        assert r.status_code == 200, f"{key}: {r.text}"


def test_tracked_task_types_rejects_non_int(env):
    client = env["client"]
    tok = _login(client)
    r = client.put("/api/v1/settings/tracked_task_types",
                   headers=_hdr(tok), json={"types": [1, "not-int"]})
    assert r.status_code == 400


def test_analyst_user_id_must_exist(env):
    client = env["client"]
    tok = _login(client)
    r = client.post("/api/v1/analysts", headers=_hdr(tok),
                    json={"full_name": "X", "email": "x@example.com",
                          "amo_user_id": 1, "default_rate": 0})
    analyst_id = r.json()["id"]

    r = client.patch(f"/api/v1/analysts/{analyst_id}", headers=_hdr(tok),
                     json={"user_id": str(uuid4())})
    assert r.status_code == 400
    assert "not found" in r.json()["detail"]


def test_analyst_user_id_must_not_be_taken(env):
    from app.core.security import hash_password
    from app.models import User, UserRole

    client = env["client"]
    db = env["db"]
    tok = _login(client)

    u = User(id=uuid4(), email="u@example.com",
             password_hash=hash_password("password1"),
             role=UserRole.analyst, is_active=True)
    db.add(u)
    db.commit()

    a1 = client.post("/api/v1/analysts", headers=_hdr(tok),
                     json={"full_name": "A1", "email": "a1@example.com",
                           "amo_user_id": 1, "default_rate": 0}).json()
    a2 = client.post("/api/v1/analysts", headers=_hdr(tok),
                     json={"full_name": "A2", "email": "a2@example.com",
                           "amo_user_id": 2, "default_rate": 0}).json()

    # первая привязка — OK
    r = client.patch(f"/api/v1/analysts/{a1['id']}", headers=_hdr(tok),
                     json={"user_id": str(u.id)})
    assert r.status_code == 200

    # вторая — 409 conflict (без 500 и без молчаливой перетяжки)
    r = client.patch(f"/api/v1/analysts/{a2['id']}", headers=_hdr(tok),
                     json={"user_id": str(u.id)})
    assert r.status_code == 409
    assert "уже привязан" in r.json()["detail"]
