"""Тесты OAuth-обвязки: state-CSRF, status, disconnect.

Сетевые вызовы к AmoCRM мы НЕ делаем — `AmoClient.exchange_code` и `get_users`
подменяются монкипатчем.
"""

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
    # AmoCRM env должен считаться настроенным (мы не ходим в реальный Amo)
    monkeypatch.setenv("AMO_CLIENT_ID", "test-client-id")
    monkeypatch.setenv("AMO_CLIENT_SECRET", "test-client-secret")
    monkeypatch.setenv("AMO_REDIRECT_URI", "https://basa.example.com/api/v1/amo/oauth/callback")
    monkeypatch.setenv("AMO_BASE_URL", "https://acc.amocrm.ru")

    # сброс кеша Settings + обновление имён, захваченных модулями на импорт
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
    db.add(User(email="admin@example.com", password_hash=hash_password("admin12345"), role=UserRole.admin, is_active=True))
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
    r = client.post("/api/v1/auth/login", json={"email": "admin@example.com", "password": "admin12345"})
    return r.json()["access_token"]


def _hdr(t):
    return {"Authorization": f"Bearer {t}"}


def test_oauth_start_returns_amocrm_url_and_persists_state(env):
    client = env["client"]
    tok = _login(client)
    r = client.get("/api/v1/amo/oauth/start", headers=_hdr(tok))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["url"].startswith("https://acc.amocrm.ru/oauth?")
    assert "client_id=test-client-id" in body["url"]
    assert "state=" in body["url"]

    # state сохранён в settings
    from app.models import Setting
    saved = env["db"].get(Setting, "amo_oauth_state")
    assert saved is not None
    assert saved.value["state"] == body["state"]


def test_oauth_callback_rejects_bad_state(env, monkeypatch):
    client = env["client"]
    tok = _login(client)
    # инициируем start, чтобы был сохранён state
    client.get("/api/v1/amo/oauth/start", headers=_hdr(tok))

    # подменяем exchange_code, чтобы убедиться что он НЕ вызвался
    called = {"exchange": False}
    from app.services import amo_client as ac
    def fake_exchange(self, code):
        called["exchange"] = True
        raise AssertionError("should not be called")
    monkeypatch.setattr(ac.AmoClient, "exchange_code", fake_exchange)

    r = client.get("/api/v1/amo/oauth/callback?code=abc&state=wrong-state")
    assert r.status_code == 400
    assert "OAuth state" in r.json()["detail"]
    assert called["exchange"] is False


def test_oauth_callback_happy_path(env, monkeypatch):
    client = env["client"]
    tok = _login(client)
    start = client.get("/api/v1/amo/oauth/start", headers=_hdr(tok)).json()
    real_state = start["state"]

    from app.services import amo_client as ac
    from app.services.amo_token_store import AmoTokens

    def fake_exchange(self, code):
        return AmoTokens(
            access_token="A", refresh_token="R",
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        )
    monkeypatch.setattr(ac.AmoClient, "exchange_code", fake_exchange)

    r = client.get(f"/api/v1/amo/oauth/callback?code=abc&state={real_state}")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "ok"

    # state одноразовый — второй вызов с тем же state провалится
    r2 = client.get(f"/api/v1/amo/oauth/callback?code=abc&state={real_state}")
    assert r2.status_code == 400


def test_oauth_status_and_disconnect(env, monkeypatch):
    client = env["client"]
    tok = _login(client)

    # 1) ещё не подключены
    r = client.get("/api/v1/amo/oauth/status", headers=_hdr(tok))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["configured"] is True
    assert body["connected"] is False
    assert body["base_url"] == "https://acc.amocrm.ru"

    # 2) подключаемся (через fake exchange, который сохраняет токены как реальный)
    from app.services import amo_client as ac
    from app.services.amo_token_store import AmoTokens, load_tokens, save_tokens

    def fake_exchange(self, code):
        save_tokens(self._db, "A", "R", 3600)
        return load_tokens(self._db)
    monkeypatch.setattr(ac.AmoClient, "exchange_code", fake_exchange)

    start = client.get("/api/v1/amo/oauth/start", headers=_hdr(tok)).json()
    client.get(f"/api/v1/amo/oauth/callback?code=abc&state={start['state']}")

    r = client.get("/api/v1/amo/oauth/status", headers=_hdr(tok))
    assert r.json()["connected"] is True

    # 3) disconnect — токены стёрты
    r = client.post("/api/v1/amo/oauth/disconnect", headers=_hdr(tok))
    assert r.status_code == 200
    r = client.get("/api/v1/amo/oauth/status", headers=_hdr(tok))
    assert r.json()["connected"] is False


def test_oauth_ping_calls_amocrm(env, monkeypatch):
    client = env["client"]
    tok = _login(client)

    from app.services import amo_client as ac
    from app.services.amo_token_store import load_tokens, save_tokens

    def fake_exchange(self, code):
        save_tokens(self._db, "A", "R", 3600)
        return load_tokens(self._db)
    monkeypatch.setattr(ac.AmoClient, "exchange_code", fake_exchange)
    monkeypatch.setattr(ac.AmoClient, "get_users", lambda self: {"_embedded": {"users": [{"id": 1}, {"id": 2}, {"id": 3}]}})

    start = client.get("/api/v1/amo/oauth/start", headers=_hdr(tok)).json()
    client.get(f"/api/v1/amo/oauth/callback?code=abc&state={start['state']}")

    r = client.post("/api/v1/amo/oauth/ping", headers=_hdr(tok))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "ok"
    assert body["users_visible"] == 3


def test_oauth_start_forbidden_without_env(env, monkeypatch):
    """Если env пустой — оба эндпоинта должны корректно отказывать."""
    monkeypatch.delenv("AMO_CLIENT_ID", raising=False)
    monkeypatch.delenv("AMO_CLIENT_SECRET", raising=False)
    monkeypatch.delenv("AMO_REDIRECT_URI", raising=False)
    monkeypatch.delenv("AMO_BASE_URL", raising=False)
    from app.core import config as cfg
    cfg.get_settings.cache_clear()
    cfg.settings = cfg.get_settings()
    import app.api.v1.endpoints.amo as amo_endpoint
    monkeypatch.setattr(amo_endpoint, "settings", cfg.settings)

    client = env["client"]
    tok = _login(client)
    r = client.get("/api/v1/amo/oauth/start", headers=_hdr(tok))
    assert r.status_code == 400
    assert "not configured" in r.json()["detail"]
