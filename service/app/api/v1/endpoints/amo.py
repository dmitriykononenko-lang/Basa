from __future__ import annotations

import ipaddress
import logging
import secrets
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.config import settings
from app.db.session import get_db
from app.models import AmoWebhookLog, Setting, User, UserRole
from app.services.amo_client import AmoApiError, AmoClient
from app.services.amo_token_store import load_tokens
from app.services.queue import enqueue_webhook_log
from app.services.sync import sync_leads, sync_tasks

try:  # rq-scheduler опционален — без него /sync/schedule отвечает пустотой
    from app.services.scheduler import list_scheduled_jobs, register_schedule
except Exception:  # noqa: BLE001
    list_scheduled_jobs = None  # type: ignore[assignment]
    register_schedule = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/amo", tags=["amo"])

WEBHOOK_IPS_KEY = "amo_webhook_allowed_ips"
OAUTH_STATE_KEY = "amo_oauth_state"


@router.get("/oauth/start")
def oauth_start(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.admin)),
) -> dict:
    """Возвращает URL согласия AmoCRM и сохраняет одноразовый `state` для CSRF.

    SPA получает JSON и сам делает `location.href = url` — иначе fetch с Bearer-токеном
    не может пройти 302 на сторонний домен.
    """
    if not settings.amo_oauth_configured:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="AmoCRM OAuth is not configured")

    state = secrets.token_urlsafe(24)
    row = db.get(Setting, OAUTH_STATE_KEY)
    payload = {"state": state, "issued_at": datetime.now(timezone.utc).isoformat()}
    if row is None:
        db.add(Setting(key=OAUTH_STATE_KEY, value=payload))
    else:
        row.value = payload
    db.commit()

    params = {"client_id": settings.amo_client_id, "state": state}
    return {"url": f"{settings.amo_base_url}/oauth?{urlencode(params)}", "state": state}


@router.get("/oauth/callback")
def oauth_callback(
    code: str = Query(...),
    state: Optional[str] = Query(default=None),
    referer: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
) -> dict:
    """Callback от AmoCRM.

    Не защищён JWT, потому что Amo не пробрасывает наш токен. CSRF-защита —
    одноразовый `state`, который мы сохранили в settings перед редиректом.
    """
    saved = db.get(Setting, OAUTH_STATE_KEY)
    expected = (saved.value or {}).get("state") if saved else None
    if expected is None or state != expected:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired OAuth state")
    # одноразовый — гасим
    saved.value = {}
    db.commit()

    try:
        client = AmoClient(db)
        tokens = client.exchange_code(code)
    except AmoApiError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return {"status": "ok", "expires_at": tokens.expires_at.isoformat(), "referer": referer}


@router.get("/oauth/status")
def oauth_status(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.admin)),
) -> dict:
    """Текущее состояние интеграции: настроены ли env, есть ли токены, когда истекают."""
    tokens = load_tokens(db)
    return {
        "configured": settings.amo_oauth_configured,
        "client_id": settings.amo_client_id,
        "redirect_uri": settings.amo_redirect_uri,
        "base_url": settings.amo_base_url,
        "connected": tokens is not None,
        "access_token_expires_at": tokens.expires_at.isoformat() if tokens else None,
        "access_token_expired": tokens.is_expired(slack_seconds=0) if tokens else None,
    }


@router.post("/oauth/disconnect")
def oauth_disconnect(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.admin)),
) -> dict:
    """Сбросить сохранённые OAuth-токены."""
    from app.services.amo_token_store import TOKEN_SETTINGS_KEY

    row = db.get(Setting, TOKEN_SETTINGS_KEY)
    if row is not None:
        db.delete(row)
        db.commit()
    return {"status": "disconnected"}


@router.post("/oauth/ping")
def oauth_ping(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.admin)),
) -> dict:
    """Тестовый вызов AmoCRM API (GET /api/v4/users) для проверки токенов.

    Если access_token истёк — клиент сам обновит его через refresh_token.
    """
    try:
        client = AmoClient(db)
        users = client.get_users()
    except AmoApiError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    embedded = (users or {}).get("_embedded") or {}
    user_count = len(embedded.get("users") or [])
    return {"status": "ok", "users_visible": user_count}


@router.get("/users")
def list_amo_users(
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.admin)),
) -> dict:
    """Список пользователей из AmoCRM + информация о привязке к нашим аналитикам.

    Возвращает по каждому AmoCRM-юзеру: amo_user_id, name, email и, если уже
    привязан к аналитику, — его uuid / ФИО. Удобно для маппинга в UI.
    """
    from sqlalchemy import select as _sel

    from app.models import Analyst

    try:
        client = AmoClient(db)
        body = client.get_users()
    except AmoApiError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    amo_users = ((body or {}).get("_embedded") or {}).get("users") or []
    # одним запросом — все маппинги
    mapped = {
        a.amo_user_id: a
        for a in db.execute(_sel(Analyst).where(Analyst.amo_user_id.is_not(None))).scalars()
        if a.amo_user_id is not None
    }

    items: list[dict] = []
    for u in amo_users:
        amo_id = u.get("id")
        try:
            amo_id_int = int(amo_id) if amo_id is not None else None
        except (TypeError, ValueError):
            amo_id_int = None
        analyst = mapped.get(amo_id_int)
        items.append({
            "amo_user_id": amo_id_int,
            "name": u.get("name"),
            "email": u.get("email"),
            "rights_lang": u.get("lang"),
            "analyst_id": str(analyst.id) if analyst else None,
            "analyst_name": analyst.full_name if analyst else None,
        })
    return {"users": items, "total": len(items)}


@router.post("/sync/run")
def run_sync(
    since: Optional[datetime] = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.admin)),
) -> dict:
    try:
        result = sync_leads(db, since=since)
    except AmoApiError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return {
        "leads_seen": result.leads_seen,
        "actions_applied": result.actions_applied,
        "skipped": result.skipped,
        "rollbacks_blocked": result.rollbacks_blocked,
    }


@router.get("/sync/schedule")
def get_schedule(
    _: User = Depends(require_roles(UserRole.admin)),
) -> dict:
    """Сводка авто-расписания pull-синков (нужен запущенный scheduler_worker)."""
    if list_scheduled_jobs is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="rq-scheduler не установлен")
    try:
        jobs = list_scheduled_jobs()
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail=f"Redis недоступен: {exc}") from exc
    return {"jobs": jobs}


@router.post("/sync/schedule/register")
def register_sync_schedule(
    _: User = Depends(require_roles(UserRole.admin)),
) -> dict:
    """Принудительно зарегистрировать расписание (на случай свежего Redis)."""
    if register_schedule is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="rq-scheduler не установлен")
    try:
        return {"registered": register_schedule()}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail=str(exc)) from exc


@router.post("/sync/tasks")
def run_sync_tasks(
    since: Optional[datetime] = None,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.admin)),
) -> dict:
    try:
        result = sync_tasks(db, since=since)
    except AmoApiError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    return {
        "tasks_seen": result.tasks_seen,
        "tasks_upserted": result.tasks_upserted,
        "skipped": result.skipped,
    }


@router.post("/webhooks", status_code=status.HTTP_200_OK)
async def amo_webhook(request: Request, db: Session = Depends(get_db)) -> dict:
    """Приём вебхуков от AmoCRM.

    Быстро отвечает 200 (ТЗ 9.2): записывает payload в `amo_webhook_log` с ключом
    идемпотентности и ставит обработку в RQ. Реальная работа — в воркере.
    """
    _check_source_ip(db, request)

    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001
        payload = {"raw": (await request.body()).decode("utf-8", errors="replace")}

    event_type = _detect_event_type(payload)
    idem = _build_idempotency_key(payload, event_type)

    if idem is not None:
        existing = (
            db.query(AmoWebhookLog).filter(AmoWebhookLog.idempotency_key == idem).first()
        )
        if existing is not None:
            # повторная доставка — переотправляем в очередь только если ещё не обработали
            if not existing.processed:
                enqueue_webhook_log(existing.id)
            return {"status": "duplicate", "log_id": str(existing.id)}

    log = AmoWebhookLog(event_type=event_type, payload=payload, idempotency_key=idem)
    db.add(log)
    db.commit()
    db.refresh(log)

    job_id = enqueue_webhook_log(log.id)
    return {"status": "queued", "log_id": str(log.id), "job_id": job_id}


def _check_source_ip(db: Session, request: Request) -> None:
    """IP-whitelist по настройке `amo_webhook_allowed_ips` (CIDR или одиночные адреса).

    Если список пустой/отсутствует — пропускаем всех. Это позволяет включать защиту
    постепенно: сначала настройку, потом enforcement. Источник IP читаем из
    X-Forwarded-For (первый в цепочке) — Amo идёт через ваш reverse proxy.
    """
    row = db.get(Setting, WEBHOOK_IPS_KEY)
    if row is None:
        return
    allowed = row.value.get("ips", []) if isinstance(row.value, dict) else []
    if not allowed:
        return

    client_ip = _resolve_client_ip(request)
    if client_ip is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot resolve client IP")

    try:
        ip_obj = ipaddress.ip_address(client_ip)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid client IP")

    for entry in allowed:
        try:
            if "/" in entry:
                if ip_obj in ipaddress.ip_network(entry, strict=False):
                    return
            else:
                if ip_obj == ipaddress.ip_address(entry):
                    return
        except ValueError:
            continue

    logger.warning("Rejected AmoCRM webhook from %s (not in whitelist)", client_ip)
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Source IP is not allowed")


def _resolve_client_ip(request: Request) -> Optional[str]:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    if request.client is None:
        return None
    return request.client.host


def _detect_event_type(payload: dict) -> str:
    for top in ("leads", "tasks"):
        if top in payload and isinstance(payload[top], dict):
            for action in payload[top]:
                return f"{top}[{action}]"
    return "unknown"


def _build_idempotency_key(payload: dict, event_type: str) -> Optional[str]:
    for top in ("leads", "tasks"):
        section = payload.get(top, {})
        if not isinstance(section, dict):
            continue
        for action, items in section.items():
            if not isinstance(items, list) or not items:
                continue
            first = items[0]
            amo_id = first.get("id")
            updated_at = first.get("updated_at") or first.get("last_modified") or ""
            if amo_id is not None:
                return f"{top}.{action}.{amo_id}.{updated_at}"
    return None
