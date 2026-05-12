"""Pull-синхронизация AmoCRM → локальная БД (страховка от потерянных вебхуков).

Использует общий процессор `webhook_processor.apply_action`, чтобы поведение pull-а и
обработки вебхуков было идентичным.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.models import StatusAction
from app.services.amo_client import AmoClient
from app.services.webhook_processor import apply_action, load_status_map


@dataclass
class SyncResult:
    leads_seen: int = 0
    actions_applied: int = 0
    skipped: int = 0
    rollbacks_blocked: int = 0


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
