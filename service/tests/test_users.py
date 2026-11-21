"""CRUD пользователей: только админ может; смена своего пароля — любая роль."""

from __future__ import annotations

from uuid import uuid4

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
    for email, role in (
        ("admin@example.com", UserRole.admin),
        ("acc@example.com", UserRole.accountant),
        ("ann@example.com", UserRole.analyst),
    ):
        db.add(User(email=email, password_hash=hash_password("password1"), role=role, is_active=True))
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


def _login(client, email, password):
    r = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


def test_admin_lists_users(env):
    client = env["client"]
    tok = _login(client, "admin@example.com", "password1")
    r = client.get("/api/v1/users", headers=_hdr(tok))
    assert r.status_code == 200
    emails = [u["email"] for u in r.json()]
    assert "admin@example.com" in emails
    assert "acc@example.com" in emails
    assert "ann@example.com" in emails


def test_non_admin_cannot_list_users(env):
    client = env["client"]
    for who in ("acc@example.com", "ann@example.com"):
        tok = _login(client, who, "password1")
        r = client.get("/api/v1/users", headers=_hdr(tok))
        assert r.status_code == 403, f"{who} got {r.status_code}"


def test_admin_creates_user_and_login_works(env):
    client = env["client"]
    tok = _login(client, "admin@example.com", "password1")
    r = client.post(
        "/api/v1/users",
        headers=_hdr(tok),
        json={"email": "new@example.com", "password": "newpass12", "full_name": "Новый", "role": "accountant"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["role"] == "accountant"

    # новый юзер может войти
    new_tok = _login(client, "new@example.com", "newpass12")
    me = client.get("/api/v1/auth/me", headers=_hdr(new_tok)).json()
    assert me["email"] == "new@example.com"


def test_duplicate_email_rejected(env):
    client = env["client"]
    tok = _login(client, "admin@example.com", "password1")
    r = client.post(
        "/api/v1/users",
        headers=_hdr(tok),
        json={"email": "acc@example.com", "password": "password2", "role": "analyst"},
    )
    assert r.status_code == 409


def test_admin_deactivates_user(env):
    client = env["client"]
    db = env["db"]
    from app.models import User
    from sqlalchemy import select
    acc = db.execute(select(User).where(User.email == "acc@example.com")).scalar_one()

    tok = _login(client, "admin@example.com", "password1")
    r = client.patch(f"/api/v1/users/{acc.id}", headers=_hdr(tok), json={"is_active": False})
    assert r.status_code == 200
    assert r.json()["is_active"] is False

    # деактивированный логиниться не должен
    r = client.post("/api/v1/auth/login", json={"email": "acc@example.com", "password": "password1"})
    assert r.status_code == 401


def test_admin_resets_password(env):
    client = env["client"]
    db = env["db"]
    from app.models import User
    from sqlalchemy import select
    ann = db.execute(select(User).where(User.email == "ann@example.com")).scalar_one()

    tok = _login(client, "admin@example.com", "password1")
    r = client.post(
        f"/api/v1/users/{ann.id}/password",
        headers=_hdr(tok),
        json={"new_password": "freshpass1"},
    )
    assert r.status_code == 200
    # старый пароль не работает
    r = client.post("/api/v1/auth/login", json={"email": "ann@example.com", "password": "password1"})
    assert r.status_code == 401
    # новый — работает
    r = client.post("/api/v1/auth/login", json={"email": "ann@example.com", "password": "freshpass1"})
    assert r.status_code == 200


def test_user_changes_own_password(env):
    client = env["client"]
    tok = _login(client, "ann@example.com", "password1")
    # без current_password — отказ
    r = client.post("/api/v1/users/me/password", headers=_hdr(tok), json={"new_password": "newpass12"})
    assert r.status_code == 400
    # с неверным — тоже отказ
    r = client.post("/api/v1/users/me/password", headers=_hdr(tok),
                    json={"current_password": "wrong", "new_password": "newpass12"})
    assert r.status_code == 400
    # с правильным — ок
    r = client.post("/api/v1/users/me/password", headers=_hdr(tok),
                    json={"current_password": "password1", "new_password": "newpass12"})
    assert r.status_code == 200
    # старый больше не работает, новый — да
    assert client.post("/api/v1/auth/login",
                       json={"email": "ann@example.com", "password": "password1"}).status_code == 401
    assert client.post("/api/v1/auth/login",
                       json={"email": "ann@example.com", "password": "newpass12"}).status_code == 200


def test_analyst_user_link(env):
    """Связка User ↔ Analyst через PATCH /analysts/{id} с user_id."""
    client = env["client"]
    db = env["db"]
    admin_tok = _login(client, "admin@example.com", "password1")

    # создаём аналитика
    r = client.post(
        "/api/v1/analysts",
        headers=_hdr(admin_tok),
        json={"full_name": "Ann", "email": "ann2@example.com", "amo_user_id": 99, "default_rate": 100},
    )
    analyst_id = r.json()["id"]

    # находим существующего ann@example.com
    from app.models import User
    from sqlalchemy import select
    ann = db.execute(select(User).where(User.email == "ann@example.com")).scalar_one()

    # привязываем
    r = client.patch(f"/api/v1/analysts/{analyst_id}", headers=_hdr(admin_tok),
                     json={"user_id": str(ann.id)})
    assert r.status_code == 200, r.text
    assert r.json()["user_id"] == str(ann.id)
