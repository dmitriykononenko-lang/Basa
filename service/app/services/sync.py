"""Pull-синхронизация AmoCRM → локальная БД (страховка от потерянных вебхуков).

Использует общий процессор `webhook_processor.apply_action` и `task_processor.apply_task_fact`,
чтобы поведение pull-а и обработки вебхуков было идентичным.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.models import StatusAction
from app.services.amo_client import AmoClient
from app.services.task_processor import TaskFact, apply_task_fact, _coerce_int, _coerce_ts
from app.services.webhook_processor import apply_action, load_status_map


@dataclass
class SyncResult:
    leads_seen: int = 0
    actions_applied: int = 0
    skipped: int = 0
    rollbacks_blocked: int = 0


@dataclass
class TaskSyncResult:
    tasks_seen: int = 0
    tasks_upserted: int = 0
    skipped: int = 0


def sync_leads(db: Session, since: Optional[datetime] = None) -> SyncResult:
    """Подтянуть сделки за период и применить действия по маппингу статусов.

    Не пишет в Amo; только чтение (ТЗ 1.2). Действия применяются через тот же
    `apply_action`, что и в воркере вебхуков — поэтому семантика одинакова и
    откаты статусов одинаково блокируются.
    """
    result = SyncResult()
    client = AmoClient(db)
    status_map = load_status_map(db)

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

        next_link = ((data.get("_links") or {}).get("next") or {}).get("href")
        if not next_link:
            break
        page += 1

    db.commit()
    return result


def _apply_lead(
    db: Session,
    lead: dict[str, Any],
    status_map: dict[str, StatusAction],
    result: SyncResult,
) -> bool:
    amo_deal_id = lead.get("id")
    if amo_deal_id is None:
        return False

    amo_status_id = lead.get("status_id")
    action = status_map.get(str(amo_status_id), StatusAction.none) if amo_status_id is not None else StatusAction.none

    price = lead.get("price")
    try:
        price_decimal = Decimal(str(price)) if price not in (None, "") else None
    except Exception:  # noqa: BLE001
        price_decimal = None

    outcome = apply_action(
        db,
        action,
        amo_deal_id=int(amo_deal_id),
        deal_name=lead.get("name"),
        responsible_amo_user_id=lead.get("responsible_user_id"),
        amo_status_id=amo_status_id,
        deal_price=price_decimal,
    )
    if outcome.rollback_blocked:
        result.rollbacks_blocked += 1
    if outcome.notes and "skipped" not in (outcome.notes or []):
        result.actions_applied += 1
    return True


# --- Tasks ------------------------------------------------------------------


def sync_tasks(db: Session, since: Optional[datetime] = None) -> TaskSyncResult:
    """Подтянуть задачи за период и заполнить `amo_tasks` через apply_task_fact.

    По ТЗ §2.3:
    - почасовая страховка — `since` за последние 24 часа;
    - суточная сверка — `since` за последние 30 дней (вызывать отдельно).
    Сам выбор окна делает caller.
    """
    result = TaskSyncResult()
    client = AmoClient(db)

    if since is None:
        since = datetime.now(timezone.utc) - timedelta(hours=24)
    updated_since_ts = int(since.timestamp())

    page = 1
    while True:
        data = client.get_tasks(updated_since_ts=updated_since_ts, page=page)
        if not data:
            break
        tasks = (data.get("_embedded") or {}).get("tasks") or []
        if not tasks:
            break

        for task in tasks:
            result.tasks_seen += 1
            if _apply_task(db, task, result):
                result.tasks_upserted += 1
            else:
                result.skipped += 1

        next_link = ((data.get("_links") or {}).get("next") or {}).get("href")
        if not next_link:
            break
        page += 1

    db.commit()
    return result


def _apply_task(db: Session, raw: dict[str, Any], result: TaskSyncResult) -> bool:
    task_id = _coerce_int(raw.get("id"))
    if task_id is None:
        return False

    is_completed_val = raw.get("is_completed")
    is_completed: Optional[bool] = bool(is_completed_val) if is_completed_val is not None else None

    fact = TaskFact(
        action="update",  # pull трактуем как update — apply сам разберётся по is_completed
        amo_task_id=task_id,
        amo_entity_id=_coerce_int(raw.get("entity_id") or raw.get("element_id")),
        responsible_amo_user_id=_coerce_int(raw.get("responsible_user_id")),
        task_type=_coerce_int(raw.get("task_type_id") or raw.get("task_type")),
        text=raw.get("text"),
        deadline=_coerce_ts(raw.get("complete_till") or raw.get("complete_till_at")),
        is_completed=is_completed,
        completed_at=_coerce_ts(raw.get("updated_at")) if is_completed else None,
    )
    apply_task_fact(db, fact)
    return True
