from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import require_roles
from app.db.session import get_db
from app.models import Setting, StatusAction, User, UserRole
from app.services.webhook_processor import STATUS_MAP_KEY

router = APIRouter(prefix="/settings", tags=["settings"])

WHITELIST_KEY = "amo_webhook_allowed_ips"
TRACKED_TASK_TYPES_KEY = "tracked_task_types"


@router.get("/{key}")
def get_setting(
    key: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.admin)),
) -> dict[str, Any]:
    row = db.get(Setting, key)
    return {"key": key, "value": row.value if row else None}


@router.put("/{key}")
def put_setting(
    key: str,
    value: dict[str, Any],
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.admin)),
) -> dict[str, Any]:
    _validate_setting(key, value)
    row = db.get(Setting, key)
    if row is None:
        row = Setting(key=key, value=value)
        db.add(row)
    else:
        row.value = value
    db.commit()
    return {"key": key, "value": row.value}


def _validate_setting(key: str, value: dict[str, Any]) -> None:
    if key == STATUS_MAP_KEY:
        # ожидаем {stage_id_str: action_value_str}
        for stage_id, action in value.items():
            try:
                int(stage_id)
            except (TypeError, ValueError):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Stage id must be integer-like, got {stage_id!r}",
                )
            try:
                StatusAction(action)
            except ValueError:
                allowed = ", ".join(a.value for a in StatusAction)
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Unknown action {action!r} for stage {stage_id}. Allowed: {allowed}",
                )
        return

    if key == WHITELIST_KEY:
        ips = value.get("ips")
        if not isinstance(ips, list):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail='Expected {"ips": [list of CIDR/IPs]}',
            )
        import ipaddress

        for entry in ips:
            try:
                if "/" in entry:
                    ipaddress.ip_network(entry, strict=False)
                else:
                    ipaddress.ip_address(entry)
            except ValueError as exc:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid IP/CIDR: {entry} ({exc})",
                )
        return

    if key == TRACKED_TASK_TYPES_KEY:
        types = value.get("types")
        if types is not None and not isinstance(types, list):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail='Expected {"types": [int, ...]} or null',
            )
