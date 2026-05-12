"""Pull-синхронизация AmoCRM → локальная БД (страховка от потерянных вебхуков)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Analyst, Project, ProjectStatus, Setting
from app.services.amo_client import AmoClient

STATUS_MAP_KEY = "amo_status_map"


@dataclass
class SyncResult:
    leads_seen: int = 0
    projects_created: int = 0
    projects_updated: int = 0
    skipped: int = 0


def _load_status_map(db: Session) -> dict[str, str]:
    row = db.get(Setting, STATUS_MAP_KEY)
    if row is None or not isinstance(row.value, dict):
        return {}
    return {str(k): str(v) for k, v in row.value.items()}


def _resolve_project_status(amo_status_id: Optional[int], status_map: dict[str, str]) -> Optional[ProjectStatus]:
    if amo_status_id is None:
        return None
    mapped = status_map.get(str(amo_status_id))
    if mapped is None:
        return None
    try:
        return ProjectStatus(mapped)
    except ValueError:
        return None


def sync_leads(db: Session, since: Optional[datetime] = None) -> SyncResult:
    """Подтянуть сделки за период и создать/обновить проекты.

    Не пишет в Amo; только чтение (ТЗ 1.2).
    """
    result = SyncResult()
    client = AmoClient(db)
    status_map = _load_status_map(db)

    if since is None:
        since = datetime.now(timezone.utc) - timedelta(hours=24)
    updated_since_ts = int(since.timestamp())

    page = 1
    while True:
        data = client.get_leads(updated_since_ts=updated_since_ts, page=page)
        if not data:
            break
        leads = (data.get("_embedded") or {}).get("leads") or []
        if not leads:
            break

        for lead in leads:
            result.leads_seen += 1
            if not _apply_lead(db, lead, status_map, result):
                result.skipped += 1

        # пагинация
        next_link = ((data.get("_links") or {}).get("next") or {}).get("href")
        if not next_link:
            break
        page += 1

    db.commit()
    return result


def _apply_lead(db: Session, lead: dict[str, Any], status_map: dict[str, str], result: SyncResult) -> bool:
    amo_deal_id = lead.get("id")
    if amo_deal_id is None:
        return False

    responsible_amo_user_id = lead.get("responsible_user_id")
    analyst: Optional[Analyst] = None
    if responsible_amo_user_id is not None:
        analyst = db.execute(
            select(Analyst).where(Analyst.amo_user_id == responsible_amo_user_id)
        ).scalar_one_or_none()
    if analyst is None:
        # без аналитика проект создать не можем
        return False

    project = db.execute(
        select(Project).where(Project.amo_deal_id == amo_deal_id)
    ).scalar_one_or_none()

    amo_status_id = lead.get("status_id")
    new_status = _resolve_project_status(amo_status_id, status_map)

    if project is None:
        project = Project(
            amo_deal_id=amo_deal_id,
            name=lead.get("name") or f"Deal {amo_deal_id}",
            analyst_id=analyst.id,
            payment_amount=analyst.default_rate,
            amo_status_id=amo_status_id,
            status=new_status or ProjectStatus.in_progress,
            started_at=datetime.fromtimestamp(lead["created_at"], tz=timezone.utc)
            if lead.get("created_at")
            else None,
        )
        db.add(project)
        result.projects_created += 1
        return True

    # обновление: имя/ответственного/статус, c учётом Q6 — не откатываем статус назад автоматически
    project.name = lead.get("name") or project.name
    project.analyst_id = analyst.id
    project.amo_status_id = amo_status_id

    if new_status is not None and not _is_rollback(project.status, new_status):
        if new_status == ProjectStatus.done and project.completed_at is None:
            project.completed_at = datetime.now(timezone.utc)
        project.status = new_status

    result.projects_updated += 1
    return True


_STATUS_ORDER = {
    ProjectStatus.in_progress: 0,
    ProjectStatus.done: 1,
    ProjectStatus.paid: 2,
    ProjectStatus.cancelled: 3,
}


def _is_rollback(current: ProjectStatus, new: ProjectStatus) -> bool:
    """Откат — переход к статусу с меньшим порядковым номером (кроме отмены)."""
    if new == ProjectStatus.cancelled:
        return False
    return _STATUS_ORDER[new] < _STATUS_ORDER[current]
