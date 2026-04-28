from app.schemas import OnecOrder
from app.services.status_map import AMO_PIPELINE_ID, ONEC_TO_AMO


def onec_order_to_amo_lead(order: OnecOrder) -> dict:
    """Преобразует заказ из 1С в тело запроса для создания/обновления лида amoCRM."""

    status_id = ONEC_TO_AMO.get(order.status, 0)

    lead: dict = {
        "name": f"Заказ {order.order_number}",
        "pipeline_id": AMO_PIPELINE_ID,
        "status_id": status_id,
        "price": int(order.total_amount),
        "custom_fields_values": _build_custom_fields(order),
    }
    return lead


def _build_custom_fields(order: OnecOrder) -> list[dict]:
    """Кастомные поля лида. ID полей уточняются под аккаунт клиента."""
    fields = []

    # TODO: заменить field_id на реальные после получения от клиента
    FIELD_ORDER_NUMBER = 0
    FIELD_COMMENT = 0

    if FIELD_ORDER_NUMBER and order.order_number:
        fields.append({"field_id": FIELD_ORDER_NUMBER, "values": [{"value": order.order_number}]})
    if FIELD_COMMENT and order.comment:
        fields.append({"field_id": FIELD_COMMENT, "values": [{"value": order.comment}]})

    return fields


def amo_lead_to_onec_status(amocrm_status_id: int) -> str | None:
    """Возвращает статус для обратной отправки в 1С, или None если маппинга нет."""
    from app.services.status_map import AMO_TO_ONEC
    return AMO_TO_ONEC.get(amocrm_status_id)
