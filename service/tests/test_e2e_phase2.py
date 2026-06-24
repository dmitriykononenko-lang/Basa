"""End-to-end сценарии Фазы 2 на TestClient.

Симулируем реальный поток:
1. Admin логинится, создаёт аналитика (с amo_user_id).
2. Записывает в settings маппинг этапов → действий.
3. AmoCRM шлёт серию вебхуков: добавление сделки → перевод в "работа сдана"
   → "оплачено клиентом". Параллельно проверяем идемпотентность и блокировку
   отката.
4. Бухгалтер помечает выплату как `paid`.
5. Все события доступны через `/api/v1/webhook-log`.

RQ-очередь и реальный воркер заменены на синхронный вызов процессора в той же
сессии БД — это ровно тот код, что выполняется внутри воркера, без сетевых
прыжков через Redis.
"""

from __future__ import annotations

import os
from uuid import UUID, uuid4

from cryptography.fernet import Fernet

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://x:x@localhost/x")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/0")
os.environ.setdefault("JWT_SECRET", "e2e-test-secret-please-replace")
os.environ.setdefault("TOKEN_ENCRYPTION_KEY", Fernet.generate_key().decode())
os.environ.setdefault("INITIAL_ADMIN_EMAIL", "admin@example.com")
os.environ.setdefault("INITIAL_ADMIN_PASSWORD", "x")

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from sqlalchemy.types import JSON


@pytest.fixture()
def env(monkeypatch):
    """Поднимает SQLite-метаданные, переопределяет get_db и шунтирует enqueue в синхронный вызов."""
    from app.db.base import Base
    import app.models  # noqa: F401
    from app.core.security import hash_password
    from app.models import User, UserRole

    # PG-специфика → переносимые типы
    for table in Base.metadata.tables.values():
        for col in table.columns:
            if isinstance(col.type, postgresql.JSONB):
                col.type = JSON()
            if col.server_default is not None and "gen_random_uuid" in str(col.server_default.arg):
                col.server_default = None
                if col.default is None and col.primary_key:
                    col.default = lambda: uuid4()

    # StaticPool: все сессии получают одно подключение, иначе in-memory SQLite каждый раз новый
    engine = create_engine(
        "sqlite:///:memory:",
        future=True,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

    # SessionLocal внутри приложения тоже должен ходить в нашу БД (lifespan + воркер)
    from app.db import session as session_mod

    session_mod.engine = engine
    session_mod.SessionLocal = TestingSession

    # Один процесс — одна общая сессия для теста (упрощает проверки)
    db = TestingSession()

    # admin для логина
    admin = User(
        email="admin@example.com",
        password_hash=hash_password("admin12345"),
        role=UserRole.admin,
        full_name="Admin",
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

    # Шунтим очередь на синхронный процессор в той же сессии
    from app.services import queue as queue_mod
    from app.services.webhook_processor import process_webhook_log

    def fake_enqueue(log_id):
        process_webhook_log(db, UUID(str(log_id)))
        return f"sync-{log_id}"

    monkeypatch.setattr(queue_mod, "enqueue_webhook_log", fake_enqueue)
    monkeypatch.setattr("app.api.v1.endpoints.amo.enqueue_webhook_log", fake_enqueue)
    monkeypatch.setattr("app.api.v1.endpoints.webhook_log.enqueue_webhook_log", fake_enqueue)

    client = TestClient(app)
    yield {"client": client, "db": db, "engine": engine}

    db.close()
    app.dependency_overrides.clear()


def _login(client, email, password) -> str:
    r = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _hdr(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_full_phase2_flow(env):
    client = env["client"]
    db = env["db"]

    admin_token = _login(client, "admin@example.com", "admin12345")

    # 1. Создаём аналитика с amo_user_id=42
    r = client.post(
        "/api/v1/analysts",
        headers=_hdr(admin_token),
        json={"full_name": "Иван Аналитик", "email": "ivan@example.com", "amo_user_id": 42, "default_rate": 20000},
    )
    assert r.status_code == 201, r.text
    analyst_id = r.json()["id"]

    # 2. Маппинг статусов: 111 → start_project, 222 → mark_done, 333 → mark_ready_for_payout, 444 → cancel
    r = client.put(
        "/api/v1/settings/amo_status_map",
        headers=_hdr(admin_token),
        json={"111": "start_project", "222": "mark_done", "333": "mark_ready_for_payout", "444": "cancel"},
    )
    assert r.status_code == 200, r.text

    # 3a. Вебхук — добавление сделки в этап 111
    payload_start = {
        "leads": {
            "add": [
                {"id": "5001", "status_id": "111", "responsible_user_id": "42", "name": "Договор подписан", "price": "150000", "updated_at": "1700000001"}
            ]
        }
    }
    r = client.post("/api/v1/amo/webhooks", json=payload_start)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "queued"
    log_id_start = r.json()["log_id"]

    # Проверяем — проект создался, статус in_progress
    r = client.get("/api/v1/projects", headers=_hdr(admin_token))
    projects = r.json()
    assert len(projects) == 1
    project = projects[0]
    assert project["amo_deal_id"] == 5001
    assert project["status"] == "in_progress"
    assert project["analyst_id"] == analyst_id
    project_id = project["id"]

    # 3b. Идемпотентность: тот же payload — duplicate, проекта по-прежнему один
    r = client.post("/api/v1/amo/webhooks", json=payload_start)
    assert r.status_code == 200
    assert r.json()["status"] == "duplicate"
    r = client.get("/api/v1/projects", headers=_hdr(admin_token))
    assert len(r.json()) == 1

    # 4. Вебхук — "работа сдана" (этап 222 → mark_done)
    payload_done = {
        "leads": {
            "update": [
                {"id": "5001", "status_id": "222", "responsible_user_id": "42", "name": "Договор подписан", "price": "150000", "updated_at": "1700000002"}
            ]
        }
    }
    r = client.post("/api/v1/amo/webhooks", json=payload_done)
    assert r.status_code == 200

    r = client.get("/api/v1/projects", headers=_hdr(admin_token))
    assert r.json()[0]["status"] == "done"

    r = client.get("/api/v1/payments", headers=_hdr(admin_token))
    payments = r.json()
    assert len(payments) == 1
    assert payments[0]["status"] == "accrued"
    assert float(payments[0]["amount"]) == 150000.0  # из price сделки (default_rate был бы fallback)
    payment_id = payments[0]["id"]

    # 5. Повторный mark_done — выплата не дублируется
    payload_done2 = {
        "leads": {
            "update": [
                {"id": "5001", "status_id": "222", "responsible_user_id": "42", "updated_at": "1700000003"}
            ]
        }
    }
    r = client.post("/api/v1/amo/webhooks", json=payload_done2)
    assert r.status_code == 200
    r = client.get("/api/v1/payments", headers=_hdr(admin_token))
    assert len(r.json()) == 1

    # 6. "Оплачено клиентом" — выплата готова к выплате аналитику
    payload_ready = {
        "leads": {
            "update": [
                {"id": "5001", "status_id": "333", "updated_at": "1700000004"}
            ]
        }
    }
    r = client.post("/api/v1/amo/webhooks", json=payload_ready)
    assert r.status_code == 200

    r = client.get("/api/v1/payments", headers=_hdr(admin_token))
    assert r.json()[0]["status"] == "ready"

    # 7. Бухгалтер помечает выплату как paid
    from app.core.security import hash_password
    from app.models import User, UserRole

    bookkeeper = User(
        email="acc@example.com",
        password_hash=hash_password("acc12345"),
        role=UserRole.accountant,
        is_active=True,
    )
    db.add(bookkeeper)
    db.commit()

    acc_token = _login(client, "acc@example.com", "acc12345")
    r = client.post(f"/api/v1/payments/{payment_id}/mark-paid", headers=_hdr(acc_token), json={})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "paid"

    # 8. Откат: вебхук «вернули на mark_done» после того как уже paid → блокируем
    payload_rollback = {
        "leads": {
            "update": [
                {"id": "5001", "status_id": "222", "updated_at": "1700000005"}
            ]
        }
    }
    r = client.post("/api/v1/amo/webhooks", json=payload_rollback)
    assert r.status_code == 200

    # выплата осталась paid (не сбросили), проект остался done
    # (mark_done на проекте с paid-выплатой не должен ничего сломать —
    # rollback блокируется при попытке вернуть статус проекта назад)
    r = client.get("/api/v1/payments", headers=_hdr(admin_token))
    assert r.json()[0]["status"] == "paid"

    # 9. Журнал вебхуков — все 5 (start, dup пропущен, done, done2, ready, rollback)
    r = client.get("/api/v1/webhook-log?processed=true", headers=_hdr(admin_token))
    logs = r.json()
    # 5 уникальных вебхуков попали в лог (дубликат не записался)
    assert len(logs) == 5
    assert all(log["processed"] is True for log in logs)

    # detail
    r = client.get(f"/api/v1/webhook-log/{log_id_start}", headers=_hdr(admin_token))
    assert r.status_code == 200
    assert r.json()["payload"]["leads"]["add"][0]["id"] == "5001"


def test_webhook_ip_whitelist_blocks_outsider(env):
    client = env["client"]
    admin_token = _login(client, "admin@example.com", "admin12345")

    # Включаем whitelist
    r = client.put(
        "/api/v1/settings/amo_webhook_allowed_ips",
        headers=_hdr(admin_token),
        json={"ips": ["10.0.0.0/8"]},
    )
    assert r.status_code == 200

    # Стучимся с «не из сети» через X-Forwarded-For
    r = client.post(
        "/api/v1/amo/webhooks",
        json={"leads": {"add": [{"id": "999", "status_id": "111"}]}},
        headers={"X-Forwarded-For": "8.8.8.8"},
    )
    assert r.status_code == 403

    # А с «своего» — пускаем
    r = client.post(
        "/api/v1/amo/webhooks",
        json={"leads": {"add": [{"id": "999", "status_id": "111", "updated_at": "1700000999"}]}},
        headers={"X-Forwarded-For": "10.1.2.3"},
    )
    assert r.status_code == 200


def test_settings_validation_rejects_bad_action(env):
    client = env["client"]
    admin_token = _login(client, "admin@example.com", "admin12345")
    r = client.put(
        "/api/v1/settings/amo_status_map",
        headers=_hdr(admin_token),
        json={"111": "definitely-not-a-real-action"},
    )
    assert r.status_code == 400
    assert "Allowed:" in r.json()["detail"]


def test_reprocess_endpoint_works(env):
    client = env["client"]
    db = env["db"]
    admin_token = _login(client, "admin@example.com", "admin12345")

    # создаём аналитика и маппинг
    client.post(
        "/api/v1/analysts",
        headers=_hdr(admin_token),
        json={"full_name": "A", "email": "a@example.com", "amo_user_id": 77, "default_rate": 1000},
    )
    client.put(
        "/api/v1/settings/amo_status_map",
        headers=_hdr(admin_token),
        json={"111": "start_project"},
    )

    # вебхук с НЕ-мапленным responsible_user_id → проект не создаётся, лог processed=true
    payload = {"leads": {"add": [{"id": "6001", "status_id": "111", "responsible_user_id": "9999", "updated_at": "1"}]}}
    r = client.post("/api/v1/amo/webhooks", json=payload)
    log_id = r.json()["log_id"]

    # пока projects пуст
    assert client.get("/api/v1/projects", headers=_hdr(admin_token)).json() == []

    # Чиним маппинг — добавляем правильный amo_user_id (77) и переобрабатываем
    # (предположим — аналитик уже был, просто проверим что reprocess работает после фикса маппинга)
    payload_fix = {"leads": {"add": [{"id": "6001", "status_id": "111", "responsible_user_id": "77", "updated_at": "2"}]}}
    # имитируем «прошлую запись» — обновляем payload в логе
    from app.models import AmoWebhookLog

    log = db.get(AmoWebhookLog, UUID(log_id))
    log.payload = payload_fix
    db.commit()

    r = client.post(f"/api/v1/webhook-log/{log_id}/reprocess?sync=true", headers=_hdr(admin_token))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "processed"

    # проект создан
    projects = client.get("/api/v1/projects", headers=_hdr(admin_token)).json()
    assert len(projects) == 1
    assert projects[0]["amo_deal_id"] == 6001


def test_analyst_only_sees_own_projects(env):
    """Аналитик видит только свои проекты, даже если запросил без фильтра."""
    client = env["client"]
    db = env["db"]
    admin_token = _login(client, "admin@example.com", "admin12345")

    # Создаём двух аналитиков
    r = client.post(
        "/api/v1/analysts",
        headers=_hdr(admin_token),
        json={"full_name": "A1", "email": "a1@example.com", "amo_user_id": 10, "default_rate": 100},
    )
    a1_id = r.json()["id"]
    r = client.post(
        "/api/v1/analysts",
        headers=_hdr(admin_token),
        json={"full_name": "A2", "email": "a2@example.com", "amo_user_id": 20, "default_rate": 100},
    )
    a2_id = r.json()["id"]

    # Маппинг и создание проектов от обоих
    client.put(
        "/api/v1/settings/amo_status_map",
        headers=_hdr(admin_token),
        json={"111": "start_project"},
    )
    for deal_id, amo_uid in ((7001, 10), (7002, 20)):
        client.post(
            "/api/v1/amo/webhooks",
            json={"leads": {"add": [{"id": str(deal_id), "status_id": "111", "responsible_user_id": str(amo_uid), "updated_at": str(deal_id)}]}},
        )

    # Создаём пользователя-аналитика, привязанного к A1
    from app.core.security import hash_password
    from app.models import Analyst, User, UserRole

    analyst_user = User(
        email="a1user@example.com",
        password_hash=hash_password("a1user12345"),
        role=UserRole.analyst,
        is_active=True,
    )
    db.add(analyst_user)
    db.flush()
    a1 = db.get(Analyst, UUID(a1_id))
    a1.user_id = analyst_user.id
    db.commit()

    a1_token = _login(client, "a1user@example.com", "a1user12345")
    r = client.get("/api/v1/projects", headers=_hdr(a1_token))
    assert r.status_code == 200
    projects = r.json()
    assert len(projects) == 1
    assert projects[0]["analyst_id"] == a1_id  # только свой
