"""Обработка событий задач AmoCRM (tasks[add|update|complete]).

Правила (ТЗ §5.2):
- `deadline_initial` фиксируется один раз — при первом появлении задачи у нас.
  Все последующие изменения дедлайна в Amo пишутся только в `deadline_current`.
- Задачи без дедлайна сохраняются (попадают в категорию «без срока» в метриках),
  но не участвуют в расчёте % просрочек.
- При закрытии (`is_completed=true`) считаем `is_overdue` относительно
  ПЕРВОНАЧАЛЬНОГО дедлайна — иначе аналитик может двигать срок.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AmoTask, Analyst

logger = logging.getLogger(__name__)


@dataclass
class TaskFact:
    action: str  # add / update / complete
    amo_task_id: int
    amo_entity_id: Optional[int] = None
    responsible_amo_user_id: Optional[int] = None
    task_type: Optional[int] = None
    text: Optional[str] = None
    deadline: Optional[datetime] = None  # complete_till
    is_completed: Optional[bool] = None
    completed_at: Optional[datetime] = None


def extract_task_facts(payload: dict[str, Any]) -> list[TaskFact]:
    """Из тела вебхука вытащить факты по задачам."""
    facts: list[TaskFact] = []
    tasks = payload.get("tasks")
    if not isinstance(tasks, dict):
        return facts

    for action, items in tasks.items():
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            task_id = _coerce_int(item.get("id"))
            if task_id is None:
                continue

            facts.append(
                TaskFact(
                    action=str(action),
                    amo_task_id=task_id,
                    amo_entity_id=_coerce_int(item.get("entity_id") or item.get("element_id")),
                    responsible_amo_user_id=_coerce_int(item.get("responsible_user_id")),
                    task_type=_coerce_int(item.get("task_type_id") or item.get("task_type")),
                    text=item.get("text"),
                    deadline=_coerce_ts(item.get("complete_till") or item.get("complete_till_at")),
                    is_completed=_coerce_bool(item.get("is_completed")) if "is_completed" in item or action == "complete" else None,
                    completed_at=_coerce_ts(item.get("completed_at") or item.get("updated_at")) if action == "complete" else None,
                )
            )
    return facts


def apply_task_fact(db: Session, fact: TaskFact) -> dict[str, Any]:
    """Создать/обновить запись `amo_tasks` по факту вебхука. Не коммитит."""
    task = db.execute(select(AmoTask).where(AmoTask.amo_task_id == fact.amo_task_id)).scalar_one_or_none()
    created = task is None

    if task is None:
        task = AmoTask(
            amo_task_id=fact.amo_task_id,
            amo_entity_id=fact.amo_entity_id,
            task_type=fact.task_type,
            text=fact.text,
            deadline_initial=fact.deadline,  # фиксируем
            deadline_current=fact.deadline,
            is_completed=False,
            is_overdue=False,
        )
        db.add(task)

    # обновляем поля, КРОМЕ deadline_initial (фиксируется один раз)
    if fact.amo_entity_id is not None:
        task.amo_entity_id = fact.amo_entity_id
    if fact.task_type is not None:
        task.task_type = fact.task_type
    if fact.text is not None:
        task.text = fact.text
    if fact.deadline is not None:
        task.deadline_current = fact.deadline
        if task.deadline_initial is None:
            # появилась впервые при апдейте — фиксируем сейчас
            task.deadline_initial = fact.deadline

    # маппинг ответственного на нашего аналитика
    if fact.responsible_amo_user_id is not None:
        analyst = db.execute(
            select(Analyst).where(Analyst.amo_user_id == fact.responsible_amo_user_id)
        ).scalar_one_or_none()
        task.analyst_id = analyst.id if analyst is not None else None

    # закрытие
    if fact.is_completed is True or fact.action == "complete":
        task.is_completed = True
        task.completed_at = fact.completed_at or datetime.now(timezone.utc)
        completed = _ensure_aware(task.completed_at)
        deadline_init = _ensure_aware(task.deadline_initial)
        if completed is not None and deadline_init is not None and completed > deadline_init:
            task.is_overdue = True
        else:
            task.is_overdue = False
    elif fact.is_completed is False:
        task.is_completed = False
        task.completed_at = None
        task.is_overdue = False

    db.flush()
    return {
        "amo_task_id": task.amo_task_id,
        "action": fact.action,
        "created": created,
        "is_completed": task.is_completed,
        "is_overdue": task.is_overdue,
        "deadline_initial": task.deadline_initial.isoformat() if task.deadline_initial else None,
        "deadline_current": task.deadline_current.isoformat() if task.deadline_current else None,
    }


# --- coercers ---------------------------------------------------------------


def _ensure_aware(dt: Optional[datetime]) -> Optional[datetime]:
    """SQLite не хранит tz — на чтении делаем naive→aware UTC. На PG это no-op."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _coerce_int(v: Any) -> Optional[int]:
    if v is None or v == "":
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _coerce_bool(v: Any) -> Optional[bool]:
    if isinstance(v, bool):
        return v
    if v in (1, "1", "true", "True"):
        return True
    if v in (0, "0", "false", "False"):
        return False
    return None


def _coerce_ts(v: Any) -> Optional[datetime]:
    """Принимает unix-секунды (int/str) или ISO-строку; возвращает aware UTC datetime."""
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    if isinstance(v, (int, float)):
        return datetime.fromtimestamp(int(v), tz=timezone.utc)
    if isinstance(v, str):
        if v.isdigit():
            return datetime.fromtimestamp(int(v), tz=timezone.utc)
        try:
            return datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None
