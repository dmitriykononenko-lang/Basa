from datetime import date

from app.schemas import OnecOrder
from app.services.mapper import build_task, onec_order_to_amo_lead


def _make_order(**kwargs) -> OnecOrder:
    defaults = {
        "order_number": "M00008597",
        "status": "Новый",
        "last_name": "Иванов",
        "first_name": "Иван",
        "middle_name": "Иванович",
        "phone": "+79001234567",
        "cargo_type": "Товар",
        "volume": 3.5,
        "weight": 120.0,
        "export_date": date(2025, 6, 15),
        "export_period": "9-15",
        "delivery_address": "г. Москва, ул. Ленина, 1",
    }
    return OnecOrder(**(defaults | kwargs))


def test_lead_name_equals_order_number():
    order = _make_order()
    lead = onec_order_to_amo_lead(order)
    assert lead["name"] == "M00008597"


def test_unknown_status_maps_to_zero():
    order = _make_order(status="НеизвестныйСтатус")
    lead = onec_order_to_amo_lead(order)
    assert lead["status_id"] == 0


def test_full_name():
    order = _make_order(last_name="Петров", first_name="Пётр", middle_name="Петрович")
    assert order.full_name == "Петров Пётр Петрович"


def test_full_name_partial():
    order = _make_order(last_name="Смирнов", first_name="Алексей", middle_name="")
    assert order.full_name == "Смирнов Алексей"


class TestBuildTask:
    def test_deadline_two_hours_before_period_start(self):
        order = _make_order(export_date=date(2025, 6, 15), export_period="9-15")
        task = build_task(order, lead_id=42)
        assert task is not None
        # 2025-06-15 07:00 UTC = 1749978000
        assert task["complete_till"] == 1749978000
        assert task["entity_id"] == 42

    def test_no_date_returns_none(self):
        order = _make_order(export_date=None, export_period="9-15")
        assert build_task(order, lead_id=1) is None

    def test_no_period_returns_none(self):
        order = _make_order(export_period="")
        assert build_task(order, lead_id=1) is None

    def test_period_start_zero_clamps_to_zero(self):
        order = _make_order(export_date=date(2025, 6, 15), export_period="1-5")
        task = build_task(order, lead_id=1)
        assert task is not None
        # 1 - 2 → clamped to 0, so 00:00 UTC
        assert task["complete_till"] == int(
            __import__("datetime").datetime(2025, 6, 15, 0, 0, tzinfo=__import__("datetime").timezone.utc).timestamp()
        )
