from app.schemas import OnecOrder
from app.services.mapper import onec_order_to_amo_lead


def _make_order(**kwargs) -> OnecOrder:
    defaults = {
        "order_number": "ЗК-0001",
        "status": "Новый",
        "client_name": "Иван Иванов",
        "client_phone": "+79001234567",
        "client_email": "ivan@example.com",
        "total_amount": 15000.0,
    }
    return OnecOrder(**(defaults | kwargs))


def test_lead_name_contains_order_number():
    order = _make_order(order_number="ЗК-9999")
    lead = onec_order_to_amo_lead(order)
    assert "ЗК-9999" in lead["name"]


def test_lead_price_is_int():
    order = _make_order(total_amount=12345.67)
    lead = onec_order_to_amo_lead(order)
    assert isinstance(lead["price"], int)
    assert lead["price"] == 12345


def test_unknown_status_maps_to_zero():
    order = _make_order(status="НеизвестныйСтатус")
    lead = onec_order_to_amo_lead(order)
    assert lead["status_id"] == 0
