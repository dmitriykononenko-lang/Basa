# Таблица соответствия статусов 1С → amoCRM pipeline status_id
# Заполняется под конкретного клиента после получения списка воронок/статусов amoCRM

ONEC_TO_AMO: dict[str, int] = {
    # "Статус в 1С": amocrm_status_id
    "Новый": 0,           # TODO: подставить реальные ID
    "В работе": 0,
    "Отгружен": 0,
    "Закрыт": 0,
    "Отменён": 142,       # 142 = "Закрыто и не реализовано" (системный)
}

AMO_TO_ONEC: dict[int, str] = {v: k for k, v in ONEC_TO_AMO.items() if v != 0}

AMO_PIPELINE_ID: int = 0  # TODO: заполнить после получения от клиента
