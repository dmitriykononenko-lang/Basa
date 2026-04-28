"""
Клиент для обращения к HTTP-сервису 1С (обратная синхронизация).
Используется при изменении этапа сделки в amoCRM.

Требования к 1С-программисту:
  Реализовать HTTP-сервис с маршрутом POST /hs/amocrm/v1/status
  Тело запроса (JSON):
    {
      "amocrm_lead_id": 12345,
      "order_number":   "M00008597",
      "new_status":     "Подтверждён"
    }
  Аутентификация: Basic Auth (логин/пароль из настроек) или заголовок X-Auth-Token.
  Ожидаемый ответ: HTTP 200 + {"ok": true}.
  При ошибке: HTTP 4xx/5xx + {"error": "описание"}.
"""

import httpx
import structlog

from app.config import settings

log = structlog.get_logger()


class OnecClientError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        super().__init__(f"1С {status_code}: {detail}")


class OnecClient:
    def __init__(self) -> None:
        self._client = httpx.AsyncClient(timeout=20)

    async def update_order_status(
        self, order_number: str, amocrm_lead_id: int, new_status: str
    ) -> None:
        if not settings.onec_base_url:
            log.warning("onec_client_no_url_configured")
            return

        url = settings.onec_base_url.rstrip("/") + "/hs/amocrm/v1/status"
        payload = {
            "amocrm_lead_id": amocrm_lead_id,
            "order_number": order_number,
            "new_status": new_status,
        }

        resp = await self._client.post(
            url,
            json=payload,
            auth=(settings.onec_user, settings.onec_password) if settings.onec_user else None,
        )

        if resp.status_code >= 400:
            raise OnecClientError(resp.status_code, resp.text)

        log.info("onec_status_updated", order=order_number, status=new_status)

    async def close(self) -> None:
        await self._client.aclose()


onec_client = OnecClient()
