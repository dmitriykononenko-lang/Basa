from __future__ import annotations

import ipaddress
import logging
from datetime import datetime
from typing import Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.config import settings
from app.db.session import get_db
from app.models import AmoWebhookLog, Setting, User, UserRole
from app.services.amo_client import AmoApiError, AmoClient
from app.services.queue import enqueue_webhook_log
from app.services.sync import sync_leads, sync_tasks

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/amo", tags=["amo"])

WEBHOOK_IPS_KEY = "amo_webhook_allowed_ips"


@router.get("/oauth/start")
def oauth_start(_: User = Depends(require_roles(UserRole.admin))) -> RedirectResponse:
    if not settings.amo_oauth_configured:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="AmoCRM OAuth is not configured")
    params = {
        "client_id": settings.amo_client_id,
        "state": "basa",
        "mode": "post_message",
    }
    return RedirectResponse(url=f"{settings.amo_base_url}/oauth?{urlencode(params)}")


@router.get("/oauth/callback")
def oauth_callback(
    code: str = Query(...),
    db: Session = Depends(get_db),
) -> dict:
    """Callback от AmoCRM. Не защищён JWT, поскольку Amo не передаёт наш токен."""
    try:
        client = AmoClient(db)
        tokens = client.exchange_code(code)
    except AmoApiError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return {"status": "ok", "expires_at": tokens.expires_at.isoformat()}


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
