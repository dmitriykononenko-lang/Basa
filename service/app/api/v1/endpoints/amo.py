from __future__ import annotations

from datetime import datetime
from typing import Optional
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.core.config import settings
from app.db.session import get_db
from app.models import AmoWebhookLog, User, UserRole
from app.services.amo_client import AmoApiError, AmoClient
from app.services.sync import sync_leads

router = APIRouter(prefix="/amo", tags=["amo"])


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
        "projects_created": result.projects_created,
        "projects_updated": result.projects_updated,
        "skipped": result.skipped,
    }


@router.post("/webhooks", status_code=status.HTTP_200_OK)
async def amo_webhook(request: Request, db: Session = Depends(get_db)) -> dict:
    """Приём вебхуков от AmoCRM.

    В этой версии — только логирование в amo_webhook_log с ключом идемпотентности.
    Реальную обработку (Phase 2) перенесём в воркер RQ.
    """
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
            return {"status": "duplicate"}

    db.add(AmoWebhookLog(event_type=event_type, payload=payload, idempotency_key=idem))
    db.commit()
    return {"status": "queued"}


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
