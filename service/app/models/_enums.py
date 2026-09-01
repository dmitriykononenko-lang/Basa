from __future__ import annotations

import enum


class AnalystStatus(str, enum.Enum):
    active = "active"
    archived = "archived"


class ProjectStatus(str, enum.Enum):
    in_progress = "in_progress"
    done = "done"
    paid = "paid"
    cancelled = "cancelled"


class PaymentStatus(str, enum.Enum):
    accrued = "accrued"
    ready = "ready"
    paid = "paid"
    cancelled = "cancelled"


class UserRole(str, enum.Enum):
    admin = "admin"
    accountant = "accountant"
    analyst = "analyst"


class StatusAction(str, enum.Enum):
    """Действие, которое триггерится статусом сделки в AmoCRM (ТЗ §4.4)."""

    none = "none"
    start_project = "start_project"
    mark_done = "mark_done"
    mark_ready_for_payout = "mark_ready_for_payout"
    cancel = "cancel"
