# Маппинг статусов 1С ↔ этапы воронки amoCRM.
# Заполняется после получения полного списка статусов от KO:AGENCY.
# Значения status_id берутся из GET /api/v4/leads/pipelines.

AMO_PIPELINE_ID: int = 0  # TODO: заполнить

# Статус 1С → status_id этапа amoCRM
ONEC_TO_AMO: dict[str, int] = {
    # "Статус в 1С": amocrm_status_id
    # Примеры — будут уточнены после согласования с KO:AGENCY:
    # "Новый":              123001,
    # "Подтверждён":        123002,
    # "В работе":           123003,
    # "Выполнен":           123004,
    # "Отменён":            142,     # 142 = системный «Закрыто и не реализовано»
}

# Обратный маппинг: status_id amoCRM → статус 1С
AMO_TO_ONEC: dict[int, str] = {v: k for k, v in ONEC_TO_AMO.items()}

# Кастомные поля сделки amoCRM (field_id заполняется после получения доступа)
class AmoFields:
    ORDER_NUMBER: int = 0       # Номер заказа 1С
    EXPORT_DATE: int = 0        # Дата вывоза
    EXPORT_PERIOD: int = 0      # Период вывоза («9-15»)
    CARGO_TYPE: int = 0         # Тип груза
    VOLUME: int = 0             # Объём
    WEIGHT: int = 0             # Вес
    DELIVERY_ADDRESS: int = 0   # Адрес доставки
    CANCEL_REASON: int = 0      # Причина отмены
    NOTES: int = 0              # Примечания
