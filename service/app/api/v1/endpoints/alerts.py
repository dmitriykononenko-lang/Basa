from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter, Depends, Query

from app.api.deps import require_roles
from app.models import User, UserRole
from app.services.alerts import (
    DEFAULT_THRESHOLD,
    get_status,
    list_recent_errors,
)

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("/status")
def alerts_status(
    threshold: int = Query(default=DEFAULT_THRESHOLD, ge=1),
    _: User = Depends(require_roles(UserRole.admin)),
) -> dict:
    return asdict(get_status(threshold=threshold))


@router.get("/recent")
def alerts_recent(
    limit: int = Query(default=50, ge=1, le=500),
    _: User = Depends(require_roles(UserRole.admin)),
) -> list[dict]:
    return list_recent_errors(limit=limit)
