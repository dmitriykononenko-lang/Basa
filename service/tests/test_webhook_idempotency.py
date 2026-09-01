from app.api.v1.endpoints.amo import _build_idempotency_key, _detect_event_type


def test_detect_leads_add():
    payload = {"leads": {"add": [{"id": 42, "updated_at": 1700000000}]}}
    assert _detect_event_type(payload) == "leads[add]"


def test_detect_tasks_complete():
    payload = {"tasks": {"complete": [{"id": 7}]}}
    assert _detect_event_type(payload) == "tasks[complete]"


def test_detect_unknown():
    assert _detect_event_type({"foo": "bar"}) == "unknown"


def test_idempotency_key_includes_id_and_updated():
    payload = {"leads": {"update": [{"id": 42, "updated_at": 1700000000}]}}
    assert _build_idempotency_key(payload, "leads[update]") == "leads.update.42.1700000000"


def test_idempotency_key_missing_id_returns_none():
    assert _build_idempotency_key({"leads": {"update": [{}]}}, "x") is None


def test_idempotency_key_no_items_returns_none():
    assert _build_idempotency_key({"leads": {"update": []}}, "x") is None
