from app.models import ProjectStatus
from app.services.sync import _is_rollback, _resolve_project_status


def test_resolve_status_known():
    assert _resolve_project_status(123, {"123": "done"}) == ProjectStatus.done


def test_resolve_status_unknown_id():
    assert _resolve_project_status(999, {"123": "done"}) is None


def test_resolve_status_bad_value():
    assert _resolve_project_status(123, {"123": "not-a-status"}) is None


def test_resolve_status_none_id():
    assert _resolve_project_status(None, {"123": "done"}) is None


def test_rollback_forward_allowed():
    assert _is_rollback(ProjectStatus.in_progress, ProjectStatus.done) is False
    assert _is_rollback(ProjectStatus.done, ProjectStatus.paid) is False


def test_rollback_backward_detected():
    assert _is_rollback(ProjectStatus.paid, ProjectStatus.done) is True
    assert _is_rollback(ProjectStatus.done, ProjectStatus.in_progress) is True


def test_cancellation_is_not_rollback():
    # отмена всегда разрешена
    assert _is_rollback(ProjectStatus.paid, ProjectStatus.cancelled) is False
    assert _is_rollback(ProjectStatus.in_progress, ProjectStatus.cancelled) is False
