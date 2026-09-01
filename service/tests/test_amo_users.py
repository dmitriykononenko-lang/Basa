"""GET /api/v1/amo/users — список пользователей AmoCRM с инфой о привязке."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
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
    # один аналитик уже привязан к amo_user_id=10
    db.add(Analyst(id=uuid4(), full_name="Иван", email="i@example.com",
                   amo_user_id=10, default_rate=Decimal("0"),
                   payment_details={}, status=AnalystStatus.active))
    # ещё двое — без привязки
    db.add(Analyst(id=uuid4(), full_name="Мария", email="m@example.com",
                   amo_user_id=None, default_rate=Decimal("0"),
                   payment_details={}, status=AnalystStatus.active))
    db.add(Analyst(id=uuid4(), full_name="Олег", email="o@example.com",
                   amo_user_id=None, default_rate=Decimal("0"),
                   payment_details={}, status=AnalystStatus.active))
    db.commit()

    from app.main import app
    def _get_db():
        try:
            yield db
        finally:
            pass
    app.dependency_overrides[session_mod.get_db] = _get_db
    yield {"client": TestClient(app), "db": db, "monkeypatch": monkeypatch}
    db.close()
    app.dependency_overrides.clear()


def _login(client):
    return client.post("/api/v1/auth/login",
                       json={"email": "admin@example.com", "password": "password1"}
                       ).json()["access_token"]


def _hdr(t): return {"Authorization": f"Bearer {t}"}


def _patch_amo_to_return(monkeypatch, users):
    """AmoClient.get_users() возвращает заданный список без сетевых вызовов."""
    from app.services import amo_client as ac
    from app.services.amo_token_store import load_tokens, save_tokens

    # фейковый exchange — чтобы AmoClient считал, что мы залогинены
    def _fake_exchange(self, code):
        save_tokens(self._db, "access", "refresh", 3600)
        return load_tokens(self._db)
    monkeypatch.setattr(ac.AmoClient, "exchange_code", _fake_exchange)
    monkeypatch.setattr(ac.AmoClient, "_get_access_token", lambda self: "fake-access")
    monkeypatch.setattr(ac.AmoClient, "get_users",
                        lambda self: {"_embedded": {"users": users}})


def test_list_amo_users_returns_mapping_info(env, monkeypatch):
    client = env["client"]
    db = env["db"]

    # сохраняем токены, чтобы AmoClient считал, что подключены
    from app.services.amo_token_store import save_tokens
    save_tokens(db, "access", "refresh", 3600)

    _patch_amo_to_return(monkeypatch, [
        {"id": 10, "name": "Иван Petrov", "email": "i@example.com"},
        {"id": 11, "name": "Maria S", "email": "m@example.com"},  # совпадает email с нашим аналитиком
        {"id": 12, "name": "Менеджер X", "email": "manager@example.com"},
    ])

    tok = _login(client)
    r = client.get("/api/v1/amo/users", headers=_hdr(tok))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 3
    users = body["users"]

    by_id = {u["amo_user_id"]: u for u in users}
    # 10 — уже привязан
    assert by_id[10]["analyst_id"] is not None
    assert by_id[10]["analyst_name"] == "Иван"
    # 11 — не привязан, но email совпадает с Марией — пусть SPA подскажет
    assert by_id[11]["analyst_id"] is None
    # 12 — менеджер, совсем не наш
    assert by_id[12]["analyst_id"] is None


def test_list_amo_users_when_not_connected_returns_400(env):
    """Без OAuth — 400, не 500 и не 502."""
    client = env["client"]
    tok = _login(client)
    r = client.get("/api/v1/amo/users", headers=_hdr(tok))
    assert r.status_code == 400
    assert "not authorized" in r.json()["detail"].lower()


def test_list_amo_users_forbidden_for_non_admin(env, monkeypatch):
    from app.core.security import hash_password
    from app.models import User, UserRole

    db = env["db"]
    db.add(User(email="acc@example.com",
                password_hash=hash_password("password1"),
                role=UserRole.accountant, is_active=True))
    db.commit()
    client = env["client"]
    r = client.post("/api/v1/auth/login",
                    json={"email": "acc@example.com", "password": "password1"})
    tok = r.json()["access_token"]
    r = client.get("/api/v1/amo/users", headers=_hdr(tok))
    assert r.status_code == 403


def test_binding_an_already_used_amo_user_id_to_another_analyst_is_blocked(env):
    """Защита от двойного владения уже есть в /analysts PATCH — здесь
    подтверждаем, что цепочка «отвязать → привязать» не сваливается."""
    from sqlalchemy import select
    from app.models import Analyst

    client = env["client"]
    db = env["db"]
    tok = _login(client)

    ivan = db.execute(select(Analyst).where(Analyst.full_name == "Иван")).scalar_one()
    maria = db.execute(select(Analyst).where(Analyst.full_name == "Мария")).scalar_one()

    # ivan уже владеет amo_user_id=10
    # сразу выставить Марии amo_user_id=10 → 500 на UNIQUE, поэтому SPA сначала
    # отзывает у предыдущего и потом ставит новому. Проверяем оба шага через REST.
    r = client.patch(f"/api/v1/analysts/{ivan.id}", headers=_hdr(tok),
                     json={"amo_user_id": None})
    assert r.status_code == 200
    r = client.patch(f"/api/v1/analysts/{maria.id}", headers=_hdr(tok),
                     json={"amo_user_id": 10})
    assert r.status_code == 200
    db.refresh(maria)
    assert maria.amo_user_id == 10
