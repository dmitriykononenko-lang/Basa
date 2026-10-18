"""Тесты для общих хелперов процессора, которые используются и в sync."""

from app.models import ProjectStatus
from app.services.webhook_processor import _is_status_rollback


def test_forward_transitions_allowed():
    assert _is_status_rollback(ProjectStatus.in_progress, ProjectStatus.done) is False
    assert _is_status_rollback(ProjectStatus.done, ProjectStatus.paid) is False


def test_backward_transitions_blocked():
    assert _is_status_rollback(ProjectStatus.done, ProjectStatus.in_progress) is True
    assert _is_status_rollback(ProjectStatus.paid, ProjectStatus.done) is True
    assert _is_status_rollback(ProjectStatus.paid, ProjectStatus.in_progress) is True


def test_cancellation_is_never_rollback():
    assert _is_status_rollback(ProjectStatus.paid, ProjectStatus.cancelled) is False
    assert _is_status_rollback(ProjectStatus.in_progress, ProjectStatus.cancelled) is False


def test_from_cancelled_is_never_rollback():
    # из отмены вперёд — не считаем откатом (админ восстанавливает руками)
    assert _is_status_rollback(ProjectStatus.cancelled, ProjectStatus.in_progress) is False
