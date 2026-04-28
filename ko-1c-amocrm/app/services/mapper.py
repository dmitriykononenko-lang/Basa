from datetime import datetime, timezone

from app.schemas import OnecOrder
from app.services.status_map import AMO_PIPELINE_ID, AmoFields, ONEC_TO_AMO


def onec_order_to_amo_lead(order: OnecOrder) -> dict:
    """Преобразует заказ 1С в тело запроса для создания/обновления лида amoCRM."""
    status_id = ONEC_TO_AMO.get(order.status, 0)

    return {
        "name": order.order_number,
        "pipeline_id": AMO_PIPELINE_ID,
        "status_id": status_id,
        "custom_fields_values": _build_custom_fields(order),
    }


def _build_custom_fields(order: OnecOrder) -> list[dict]:
    fields: list[dict] = []

    def add(field_id: int, value: object) -> None:
        if field_id and value not in (None, "", 0, 0.0):
            fields.append({"field_id": field_id, "values": [{"value": value}]})

    add(AmoFields.ORDER_NUMBER, order.order_number)
    add(AmoFields.EXPORT_DATE, _date_to_ts(order.export_date))
    add(AmoFields.EXPORT_PERIOD, order.export_period)
    add(AmoFields.CARGO_TYPE, order.cargo_type)
    add(AmoFields.VOLUME, order.volume)
    add(AmoFields.WEIGHT, order.weight)
    add(AmoFields.DELIVERY_ADDRESS, order.delivery_address)
    add(AmoFields.CANCEL_REASON, order.cancel_reason)
    add(AmoFields.NOTES, order.notes)

    return fields


def build_contact(order: OnecOrder) -> dict:
    """Тело запроса для создания контакта в amoCRM."""
    contact: dict = {"name": order.full_name or "Без имени", "custom_fields_values": []}

    if order.phone:
        contact["custom_fields_values"].append(
            {"field_code": "PHONE", "values": [{"value": order.phone, "enum_code": "WORK"}]}
        )
    return contact


def build_task(order: OnecOrder, lead_id: int) -> dict | None:
    """
    Задача «Связаться с клиентом, подтвердить вывоз».
    Срок = за 2 часа до начала периода вывоза.
    Возвращает None, если дата/период не заданы.
    """
    if not order.export_date or not order.export_period:
        return None

    start_hour = _parse_period_start(order.export_period)
    if start_hour is None:
        return None

    deadline_hour = max(0, start_hour - 2)
    deadline_dt = datetime(
        order.export_date.year,
        order.export_date.month,
        order.export_date.day,
        deadline_hour,
        0,
        tzinfo=timezone.utc,
    )

    return {
        "text": "Связаться с клиентом, подтвердить вывоз",
        "task_type_id": 1,  # 1 = звонок (стандартный тип amoCRM)
        "complete_till": int(deadline_dt.timestamp()),
        "entity_id": lead_id,
        "entity_type": "leads",
    }


def amo_lead_to_onec_status(status_id: int) -> str | None:
    from app.services.status_map import AMO_TO_ONEC
    return AMO_TO_ONEC.get(status_id)


def _date_to_ts(d) -> int | None:
    if d is None:
        return None
    from datetime import date as date_type
    if isinstance(d, date_type):
        return int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp())
    return None


def _parse_period_start(period: str) -> int | None:
    """Из строки «9-15» возвращает 9."""
    try:
        return int(period.split("-")[0].strip())
    except (ValueError, IndexError):
        return None
