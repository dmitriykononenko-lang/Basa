"""Тесты для bulk-link-by-email и /amo/users/unmapped."""

from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.types import JSON


@pytest.fixture()
def env(monkeypatch):
    monkeypatch.setenv("AMO_CLIENT_ID", "test-id")
    monkeypatch.setenv("AMO_CLIENT_SECRET", "test-secret")
    monkeypatch.setenv("AMO_REDIRECT_URI", "https://x/api/v1/amo/oauth/callback")
    monkeypatch.setenv("AMO_BASE_URL", "https://acc.amocrm.ru")
    from app.core import config as cfg
    cfg.get_settings.cache_clear()
    cfg.settings = cfg.get_settings()
    import app.api.v1.endpoints.amo as amo_endpoint
    import app.services.amo_client as amo_client_mod
    monkeypatch.setattr(amo_endpoint, "settings", cfg.settings)
    monkeypatch.setattr(amo_client_mod, "settings", cfg.settings)

    from app.db.base import Base
    import app.models  # noqa: F401
    from app.core.security import hash_password
    from app.models import Analyst, AnalystStatus, User, UserRole

    for table in Base.metadata.tables.values():
        for col in table.columns:
            if isinstance(col.type, postgresql.JSONB):
                col.type = JSON()
            if col.server_default is not None and "gen_random_uuid" in str(col.server_default.arg):
                col.server_default = None
                if col.default is None and col.primary_key:
                    col.default = lambda: uuid4()

    engine = create_engine("sqlite:///:memory:", future=True,
                           connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    from app.db import session as session_mod
    session_mod.engine = engine
    session_mod.SessionLocal = Session

    db = Session()
    db.add(User(email="admin@example.com",
                password_hash=hash_password("password1"),
                role=UserRole.admin, is_active=True))
    # три аналитика
    db.add(Analyst(id=uuid4(), full_name="Иван", email="i@example.com",
                   amo_user_id=None, default_rate=Decimal("0"),
                   payment_details={}, status=AnalystStatus.active))
    db.add(Analyst(id=uuid4(), full_name="Мария", email="m@example.com",
                   amo_user_id=None, default_rate=Decimal("0"),
                   payment_details={}, status=AnalystStatus.active))
    db.add(Analyst(id=uuid4(), full_name="Олег", email="o@example.com",
                   amo_user_id=99, default_rate=Decimal("0"),
                   payment_details={}, status=AnalystStatus.active))
    db.commit()

    from app.main import app
    def _get_db():
        try:
            yield db
        finally:
            pass
    app.dependency_overrides[session_mod.get_db] = _get_db

    # фейк токенов
    from app.services.amo_token_store import save_tokens
    save_tokens(db, "access", "refresh", 3600)

    # фейк get_users
    from app.services import amo_client as ac
    monkeypatch.setattr(ac.AmoClient, "_get_access_token", lambda self: "fake-access")

    yield {"client": TestClient(app), "db": db, "monkeypatch": monkeypatch}
    db.close()
    app.dependency_overrides.clear()


def _login(client):
    return client.post("/api/v1/auth/login",
                       json={"email": "admin@example.com", "password": "password1"}
                       ).json()["access_token"]


def _hdr(t): return {"Authorization": f"Bearer {t}"}


def _patch_amo_users(monkeypatch, users):
    from app.services import amo_client as ac
    monkeypatch.setattr(ac.AmoClient, "get_users",
                        lambda self: {"_embedded": {"users": users}})


def test_bulk_link_matches_by_email(env, monkeypatch):
    """Аналитик с email совпадает с Amo-юзером — должен получить amo_user_id."""
    client = env["client"]
    db = env["db"]
    tok = _login(client)

    _patch_amo_users(monkeypatch, [
        {"id": 1, "name": "Ivan A", "email": "i@example.com"},  # → к Ивану
        {"id": 2, "name": "Maria B", "email": "m@example.com"},  # → к Марии
        {"id": 3, "name": "Кто-то", "email": "stranger@example.com"},  # no_match
    ])

    r = client.post("/api/v1/amo/users/bulk-link-by-email", headers=_hdr(tok))
    assert r.status_code == 200, r.text
    s = r.json()["summary"]
    assert s["linked"] == 2
    assert s["no_match"] == 1
    assert s["already_bound"] == 0

    from sqlalchemy import select
    from app.models import Analyst
    ivan = db.execute(select(Analyst).where(Analyst.full_name == "Иван")).scalar_one()
    maria = db.execute(select(Analyst).where(Analyst.full_name == "Мария")).scalar_one()
    assert ivan.amo_user_id == 1
    assert maria.amo_user_id == 2


def test_bulk_link_skips_already_bound(env, monkeypatch):
    """Олег уже привязан к 99 — не трогаем."""
    client = env["client"]
    tok = _login(client)
    _patch_amo_users(monkeypatch, [
        {"id": 99, "name": "Oleg", "email": "o@example.com"},
    ])
    r = client.post("/api/v1/amo/users/bulk-link-by-email", headers=_hdr(tok))
    s = r.json()["summary"]
    assert s["already_bound"] == 1
    assert s["linked"] == 0


def test_bulk_link_handles_existing_other_binding_as_conflict(env, monkeypatch):
    """Иван уже привязан к Amo-юзеру 42 (например, был сопоставлен раньше).
    Bulk видит, что в Amo есть юзер с email i@example.com, но это уже другой id.
    Не перетягиваем молча — это conflict."""
    from sqlalchemy import select
    from app.models import Analyst

    db = env["db"]
    ivan = db.execute(select(Analyst).where(Analyst.full_name == "Иван")).scalar_one()
    ivan.amo_user_id = 42
    db.commit()

    client = env["client"]
    tok = _login(client)
    _patch_amo_users(monkeypatch, [
        {"id": 5, "name": "Ivan A", "email": "i@example.com"},  # тот же email, но другой Amo-id
    ])
    r = client.post("/api/v1/amo/users/bulk-link-by-email", headers=_hdr(tok))
    s = r.json()["summary"]
    assert s["conflicts"] == 1
    assert s["linked"] == 0
    # Иван остался с прежним 42, не перетянулся
    db.refresh(ivan)
    assert ivan.amo_user_id == 42


def test_unmapped_returns_only_unmapped_ids(env, monkeypatch):
    """Сканируем недавние вебхуки и возвращаем только тех, кого нет у нас."""
    client = env["client"]
    db = env["db"]
    tok = _login(client)

    # Несколько вебхуков — ответственные: 99 (Олег, привязан), 77 (нет), 42 (нет, дважды)
    payloads = [
        {"leads": {"add": [{"id": "1", "responsible_user_id": "99"}]}},
        {"leads": {"add": [{"id": "2", "responsible_user_id": "77"}]}},
        {"leads": {"update": [{"id": "3", "responsible_user_id": "42"}]}},
        {"tasks": {"add": [{"id": "9", "responsible_user_id": "42"}]}},
    ]
    for i, p in enumerate(payloads):
        client.post("/api/v1/amo/webhooks", json=p,
                    # уникальный idempotency-key
                    headers={"X-Forwarded-For": f"10.0.0.{i+1}"})

    _patch_amo_users(monkeypatch, [
        {"id": 77, "name": "Менеджер Семь", "email": "seven@example.com"},
        {"id": 42, "name": "Кто-то 42", "email": "forty2@example.com"},
    ])

    r = client.get("/api/v1/amo/users/unmapped?days=30", headers=_hdr(tok))
    assert r.status_code == 200
    body = r.json()
    ids = {u["amo_user_id"] for u in body["unmapped"]}
    # 99 у нас привязан (к Олегу), не попадает; 77 и 42 — нет
    assert ids == {77, 42}
    # сортировка: 42 встречался дважды → выше 77
    assert body["unmapped"][0]["amo_user_id"] == 42
    assert body["unmapped"][0]["occurrences"] == 2
    # имена обогащены из AmoCRM
    by_id = {u["amo_user_id"]: u for u in body["unmapped"]}
    assert by_id[42]["name"] == "Кто-то 42"


def test_unmapped_empty_when_all_mapped(env, monkeypatch):
    client = env["client"]
    tok = _login(client)
    # вебхуки только с привязанным amo_user_id=99
    client.post("/api/v1/amo/webhooks", json={"leads": {"add": [{"id": "1", "responsible_user_id": "99"}]}})
    _patch_amo_users(monkeypatch, [])
    r = client.get("/api/v1/amo/users/unmapped?days=30", headers=_hdr(tok))
    assert r.json()["unmapped"] == []


def test_unmapped_forbidden_for_non_admin(env, monkeypatch):
    from app.core.security import hash_password
    from app.models import User, UserRole
    db = env["db"]
    db.add(User(email="ann@example.com", password_hash=hash_password("password1"),
                role=UserRole.analyst, is_active=True))
    db.commit()
    client = env["client"]
    tok = client.post("/api/v1/auth/login",
                      json={"email": "ann@example.com", "password": "password1"}
                      ).json()["access_token"]
    r = client.get("/api/v1/amo/users/unmapped", headers=_hdr(tok))
    assert r.status_code == 403
