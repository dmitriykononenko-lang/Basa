from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db
from app.models import AmoWebhookLog, User, UserRole
from app.services.queue import enqueue_webhook_log
from app.services.webhook_processor import process_webhook_log

router = APIRouter(prefix="/webhook-log", tags=["webhook-log"])


@router.get("")
def list_logs(
    event_type: Optional[str] = None,
    processed: Optional[bool] = None,
    has_error: Optional[bool] = None,
    from_: Optional[datetime] = Query(default=None, alias="from"),
    to: Optional[datetime] = None,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.admin)),
) -> list[dict[str, Any]]:
    stmt = select(AmoWebhookLog).order_by(AmoWebhookLog.received_at.desc())
    if event_type:
        stmt = stmt.where(AmoWebhookLog.event_type == event_type)
    if processed is not None:
        stmt = stmt.where(AmoWebhookLog.processed == processed)
    if has_error is True:
        stmt = stmt.where(AmoWebhookLog.error.is_not(None))
    elif has_error is False:
        stmt = stmt.where(AmoWebhookLog.error.is_(None))
    if from_:
        stmt = stmt.where(AmoWebhookLog.received_at >= from_)
    if to:
        stmt = stmt.where(AmoWebhookLog.received_at <= to)
    stmt = stmt.limit(limit).offset(offset)
    rows = list(db.execute(stmt).scalars())
    return [
        {
            "id": str(r.id),
            "received_at": r.received_at.isoformat(),
            "event_type": r.event_type,
            "idempotency_key": r.idempotency_key,
            "processed": r.processed,
            "error": r.error,
        }
        for r in rows
    ]


@router.get("/{log_id}")
def get_log(
    log_id: UUID,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.admin)),
) -> dict[str, Any]:
    log = db.get(AmoWebhookLog, log_id)
    if log is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Log not found")
    return {
        "id": str(log.id),
        "received_at": log.received_at.isoformat(),
        "event_type": log.event_type,
        "idempotency_key": log.idempotency_key,
        "processed": log.processed,
        "error": log.error,
        "payload": log.payload,
    }


@router.post("/{log_id}/reprocess")
def reprocess(
    log_id: UUID,
    sync: bool = Query(default=False, description="Если true — обработать в текущем запросе вместо очереди"),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.admin)),
) -> dict[str, Any]:
    log = db.get(AmoWebhookLog, log_id)
    if log is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Log not found")
    # Сбрасываем processed/error, чтобы процессор отработал снова
    log.processed = False
    log.error = None
    db.commit()

    if sync:
        result = process_webhook_log(db, log.id)
        return {**result, "status": "processed"}

    job_id = enqueue_webhook_log(log.id)
    return {"status": "queued", "log_id": str(log.id), "job_id": job_id}


@router.post("/reprocess-unprocessed")
def reprocess_unprocessed(
    limit: int = Query(default=100, ge=1, le=1000),
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.admin)),
) -> dict[str, Any]:
    stmt = (
        select(AmoWebhookLog)
        .where(AmoWebhookLog.processed.is_(False))
        .order_by(AmoWebhookLog.received_at.asc())
        .limit(limit)
    )
    rows = list(db.execute(stmt).scalars())
    queued: list[str] = []
    for row in rows:
        if enqueue_webhook_log(row.id) is not None:
            queued.append(str(row.id))
    return {"requeued": len(queued), "log_ids": queued}
