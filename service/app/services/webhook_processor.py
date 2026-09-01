"""Обработка событий из amo_webhook_log: применение действий по статусам и автосоздание выплат.

Каждая операция идемпотентна — повторный запуск не создаёт дублей и не «откатывает» статусы.
Поддерживаемые действия описаны в `app.models.StatusAction` и приходят из настройки
`amo_status_map` (id этапа воронки → действие).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    AmoWebhookLog,
    Analyst,
    Payment,
    PaymentStatus,
    Project,
    ProjectStatus,
    Setting,
    StatusAction,
)

logger = logging.getLogger(__name__)

STATUS_MAP_KEY = "amo_status_map"


# --- Helpers -----------------------------------------------------------------


def load_status_map(db: Session) -> dict[str, StatusAction]:
    """Прочитать `amo_status_map` из settings и привести значения к StatusAction."""
    row = db.get(Setting, STATUS_MAP_KEY)
    if row is None or not isinstance(row.value, dict):
        return {}
    result: dict[str, StatusAction] = {}
    for key, value in row.value.items():
        try:
            result[str(key)] = StatusAction(value)
        except ValueError:
            logger.warning("Unknown status action %r for stage %s in amo_status_map", value, key)
    return result


def _find_analyst(db: Session, amo_user_id: Optional[int]) -> Optional[Analyst]:
    if amo_user_id is None:
        return None
    return db.execute(select(Analyst).where(Analyst.amo_user_id == amo_user_id)).scalar_one_or_none()


def _find_project_by_amo_deal(db: Session, amo_deal_id: int) -> Optional[Project]:
    return db.execute(select(Project).where(Project.amo_deal_id == amo_deal_id)).scalar_one_or_none()


def _existing_accrued_payment(db: Session, project_id: UUID) -> Optional[Payment]:
    return db.execute(
        select(Payment).where(
            Payment.project_id == project_id,
            Payment.status == PaymentStatus.accrued,
        )
    ).scalars().first()


def _any_active_payment(db: Session, project_id: UUID) -> Optional[Payment]:
    """Любая выплата, не считая `cancelled` — для защиты от повторного начисления."""
    return db.execute(
        select(Payment).where(
            Payment.project_id == project_id,
            Payment.status != PaymentStatus.cancelled,
        )
    ).scalars().first()


# --- Outcomes ---------------------------------------------------------------


@dataclass
class ApplyOutcome:
    action: StatusAction
    project_id: Optional[UUID] = None
    payment_ids: list[UUID] = None  # type: ignore[assignment]
    notes: list[str] = None  # type: ignore[assignment]
    rollback_blocked: bool = False

    def __post_init__(self) -> None:
        if self.payment_ids is None:
            self.payment_ids = []
        if self.notes is None:
            self.notes = []


# --- Apply actions ----------------------------------------------------------


_STATUS_ORDER = {
    ProjectStatus.in_progress: 0,
    ProjectStatus.done: 1,
    ProjectStatus.paid: 2,
}


def _is_status_rollback(current: ProjectStatus, target: ProjectStatus) -> bool:
    if target == ProjectStatus.cancelled or current == ProjectStatus.cancelled:
        return False
    return _STATUS_ORDER.get(target, 99) < _STATUS_ORDER.get(current, 99)


def apply_action(
    db: Session,
    action: StatusAction,
    *,
    amo_deal_id: int,
    deal_name: Optional[str] = None,
    responsible_amo_user_id: Optional[int] = None,
    amo_status_id: Optional[int] = None,
    deal_price: Optional[Decimal] = None,
) -> ApplyOutcome:
    """Применить действие к проекту/выплате. Не коммитит — это задача вызывающего."""
    outcome = ApplyOutcome(action=action)

    if action == StatusAction.none:
        return outcome

    project = _find_project_by_amo_deal(db, amo_deal_id)

    # --- start_project ---
    if action == StatusAction.start_project:
        if project is not None:
            outcome.notes.append("project_already_exists")
            outcome.project_id = project.id
            # обновим метаданные (имя/ответственного/статус Amo)
            if deal_name:
                project.name = deal_name
            project.amo_status_id = amo_status_id
            return outcome

        analyst = _find_analyst(db, responsible_amo_user_id)
        if analyst is None:
            outcome.notes.append("analyst_not_mapped")
            return outcome

        project = Project(
            amo_deal_id=amo_deal_id,
            name=deal_name or f"Deal {amo_deal_id}",
            analyst_id=analyst.id,
            payment_amount=deal_price if deal_price is not None else analyst.default_rate,
            status=ProjectStatus.in_progress,
            amo_status_id=amo_status_id,
            started_at=datetime.now(timezone.utc),
        )
        db.add(project)
        db.flush()
        outcome.project_id = project.id
        outcome.notes.append("project_created")
        return outcome

    if project is None:
        outcome.notes.append("project_not_found")
        return outcome

    outcome.project_id = project.id

    # --- mark_done ---
    if action == StatusAction.mark_done:
        if _is_status_rollback(project.status, ProjectStatus.done):
            outcome.rollback_blocked = True
            outcome.notes.append(f"rollback_blocked_from_{project.status.value}")
            return outcome

        if project.status != ProjectStatus.done:
            project.status = ProjectStatus.done
            project.completed_at = project.completed_at or datetime.now(timezone.utc)
            outcome.notes.append("project_marked_done")

        if _any_active_payment(db, project.id) is None and project.payment_amount > 0:
            payment = Payment(
                project_id=project.id,
                analyst_id=project.analyst_id,
                amount=project.payment_amount,
                status=PaymentStatus.accrued,
                accrued_at=datetime.now(timezone.utc),
            )
            db.add(payment)
            db.flush()
            outcome.payment_ids.append(payment.id)
            outcome.notes.append("payment_accrued")
        else:
            outcome.notes.append("payment_accrued_skipped")
        return outcome

    # --- mark_ready_for_payout ---
    if action == StatusAction.mark_ready_for_payout:
        if _is_status_rollback(project.status, ProjectStatus.done):
            # для готовности к выплате проект должен быть как минимум 'done'
            outcome.rollback_blocked = True
            outcome.notes.append(f"rollback_blocked_from_{project.status.value}")
            return outcome

        accrued = _existing_accrued_payment(db, project.id)
        if accrued is None:
            outcome.notes.append("no_accrued_payment_to_promote")
            return outcome
        accrued.status = PaymentStatus.ready
        outcome.payment_ids.append(accrued.id)
        outcome.notes.append("payment_ready")
        return outcome

    # --- cancel ---
    if action == StatusAction.cancel:
        if project.status != ProjectStatus.cancelled:
            project.status = ProjectStatus.cancelled
            outcome.notes.append("project_cancelled")
        for p in db.execute(select(Payment).where(Payment.project_id == project.id)).scalars():
            if p.status not in (PaymentStatus.paid, PaymentStatus.cancelled):
                p.status = PaymentStatus.cancelled
                outcome.payment_ids.append(p.id)
        if outcome.payment_ids:
            outcome.notes.append("payments_cancelled")
        return outcome

    return outcome


# --- Webhook log processing -------------------------------------------------


def extract_lead_facts(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Из тела вебхука вытащить факты по сделкам: id, status_id, responsible_user_id, name, price."""
    facts: list[dict[str, Any]] = []
    leads = payload.get("leads", {})
    if not isinstance(leads, dict):
        return facts
    for action, items in leads.items():
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            lead_id = item.get("id")
            if lead_id is None:
                continue
            try:
                lead_id = int(lead_id)
            except (TypeError, ValueError):
                continue
            facts.append(
                {
                    "action": action,
                    "amo_deal_id": lead_id,
                    "amo_status_id": _coerce_int(item.get("status_id")),
                    "responsible_amo_user_id": _coerce_int(item.get("responsible_user_id")),
                    "name": item.get("name"),
                    "price": _coerce_decimal(item.get("price")),
                }
            )
    return facts


def _coerce_int(v: Any) -> Optional[int]:
    if v is None or v == "":
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _coerce_decimal(v: Any) -> Optional[Decimal]:
    if v is None or v == "":
        return None
    try:
        return Decimal(str(v))
    except Exception:  # noqa: BLE001
        return None


def process_webhook_log(db: Session, log_id: UUID) -> dict[str, Any]:
    """Применить действия по логу вебхука. Идемпотентно: повтор безопасен."""
    log = db.get(AmoWebhookLog, log_id)
    if log is None:
        raise ValueError(f"AmoWebhookLog {log_id} not found")

    if log.processed:
        return {"status": "already_processed", "log_id": str(log.id)}

    try:
        result = _process_payload(db, log.payload)
        log.processed = True
        log.error = None
        db.commit()
        return {"status": "ok", "log_id": str(log.id), **result}
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        # Помечаем ошибку отдельной транзакцией, чтобы запись осталась
        log = db.get(AmoWebhookLog, log_id)
        if log is not None:
            log.error = str(exc)[:4000]
            db.commit()
        # Записываем событие в окно алертов (ТЗ §9.2)
        try:
            from app.services.alerts import record_error  # лениво, чтобы избежать циклов

            record_error(f"log_id={log_id} {type(exc).__name__}: {exc}")
        except Exception:  # noqa: BLE001
            logger.exception("Failed to record alert event")
        logger.exception("Failed to process webhook log %s", log_id)
        raise


def _process_payload(db: Session, payload: dict[str, Any]) -> dict[str, Any]:
    # Lead-события — действия по статусам
    facts = extract_lead_facts(payload)
    status_map = load_status_map(db)

    outcomes: list[dict[str, Any]] = []
    for fact in facts:
        amo_status_id = fact["amo_status_id"]
        if amo_status_id is None:
            outcomes.append({"deal_id": fact["amo_deal_id"], "action": "none", "reason": "no_status_id"})
            continue
        action = status_map.get(str(amo_status_id), StatusAction.none)
        outcome = apply_action(
            db,
            action,
            amo_deal_id=fact["amo_deal_id"],
            deal_name=fact["name"],
            responsible_amo_user_id=fact["responsible_amo_user_id"],
            amo_status_id=amo_status_id,
            deal_price=fact["price"],
        )
        outcomes.append(
            {
                "deal_id": fact["amo_deal_id"],
                "action": outcome.action.value,
                "project_id": str(outcome.project_id) if outcome.project_id else None,
                "payment_ids": [str(p) for p in outcome.payment_ids],
                "notes": outcome.notes,
                "rollback_blocked": outcome.rollback_blocked,
            }
        )

    # Task-события — заполнение amo_tasks
    from app.services.task_processor import apply_task_fact, extract_task_facts

    task_outcomes: list[dict[str, Any]] = []
    for tf in extract_task_facts(payload):
        task_outcomes.append(apply_task_fact(db, tf))

    return {
        "outcomes": outcomes,
        "facts_count": len(facts),
        "tasks": task_outcomes,
        "tasks_count": len(task_outcomes),
    }
