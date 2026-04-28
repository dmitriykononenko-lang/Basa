import time
from typing import Any

import httpx
import structlog

from app.config import settings

log = structlog.get_logger()

_token_cache: dict[str, Any] = {}


class AmoCRMError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        super().__init__(f"amoCRM {status_code}: {detail}")


class AmoCRMClient:
    def __init__(self) -> None:
        self.base_url = f"https://{settings.amo_domain}"
        self._client = httpx.AsyncClient(base_url=self.base_url, timeout=15)

    # ─── OAuth2 ───────────────────────────────────────────────────────────────

    async def _get_token(self) -> str:
        if _token_cache.get("access_token") and _token_cache.get("expires_at", 0) > time.time() + 60:
            return _token_cache["access_token"]

        resp = await self._client.post(
            "/oauth2/access_token",
            json={
                "client_id": settings.amo_client_id,
                "client_secret": settings.amo_client_secret,
                "grant_type": "refresh_token",
                "refresh_token": settings.amo_refresh_token,
                "redirect_uri": settings.amo_redirect_uri,
            },
        )
        self._raise_for_status(resp)
        data = resp.json()
        _token_cache["access_token"] = data["access_token"]
        _token_cache["expires_at"] = time.time() + data["expires_in"]
        # В проде: сохранить новый refresh_token в БД — он обновляется каждый раз
        log.info("amo_token_refreshed")
        return _token_cache["access_token"]

    async def _headers(self) -> dict[str, str]:
        token = await self._get_token()
        return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    # ─── Leads ────────────────────────────────────────────────────────────────

    async def create_lead(self, lead_data: dict) -> dict:
        resp = await self._client.post(
            "/api/v4/leads", json=[lead_data], headers=await self._headers()
        )
        self._raise_for_status(resp)
        created = resp.json()["_embedded"]["leads"][0]
        log.info("amo_lead_created", lead_id=created["id"])
        return created

    async def update_lead(self, lead_id: int, lead_data: dict) -> dict:
        lead_data = {**lead_data, "id": lead_id}
        resp = await self._client.patch(
            "/api/v4/leads", json=[lead_data], headers=await self._headers()
        )
        self._raise_for_status(resp)
        updated = resp.json()["_embedded"]["leads"][0]
        log.info("amo_lead_updated", lead_id=lead_id)
        return updated

    async def get_lead(self, lead_id: int) -> dict:
        resp = await self._client.get(
            f"/api/v4/leads/{lead_id}", headers=await self._headers()
        )
        self._raise_for_status(resp)
        return resp.json()

    # ─── Contacts ─────────────────────────────────────────────────────────────

    async def find_contact_by_phone(self, phone: str) -> dict | None:
        resp = await self._client.get(
            "/api/v4/contacts",
            params={"query": phone, "limit": 1},
            headers=await self._headers(),
        )
        if resp.status_code == 204:
            return None
        self._raise_for_status(resp)
        contacts = resp.json().get("_embedded", {}).get("contacts", [])
        return contacts[0] if contacts else None

    async def create_contact(self, contact_data: dict) -> dict:
        resp = await self._client.post(
            "/api/v4/contacts", json=[contact_data], headers=await self._headers()
        )
        self._raise_for_status(resp)
        created = resp.json()["_embedded"]["contacts"][0]
        log.info("amo_contact_created", contact_id=created["id"])
        return created

    async def link_contact_to_lead(self, lead_id: int, contact_id: int) -> None:
        resp = await self._client.post(
            f"/api/v4/leads/{lead_id}/links",
            json=[{"to_entity_id": contact_id, "to_entity_type": "contacts"}],
            headers=await self._headers(),
        )
        self._raise_for_status(resp)

    # ─── Tasks ────────────────────────────────────────────────────────────────

    async def create_task(self, task_data: dict) -> dict:
        resp = await self._client.post(
            "/api/v4/tasks", json=[task_data], headers=await self._headers()
        )
        self._raise_for_status(resp)
        created = resp.json()["_embedded"]["tasks"][0]
        log.info("amo_task_created", task_id=created["id"], lead_id=task_data.get("entity_id"))
        return created

    # ─── Setup helpers ────────────────────────────────────────────────────────

    async def get_pipelines(self) -> list[dict]:
        """Вспомогательный метод для первичной настройки маппинга статусов."""
        resp = await self._client.get(
            "/api/v4/leads/pipelines", headers=await self._headers()
        )
        self._raise_for_status(resp)
        return resp.json()["_embedded"]["pipelines"]

    async def get_custom_fields(self, entity: str = "leads") -> list[dict]:
        """Получить список кастомных полей для настройки AmoFields в status_map.py."""
        resp = await self._client.get(
            f"/api/v4/{entity}/custom_fields", headers=await self._headers()
        )
        self._raise_for_status(resp)
        return resp.json()["_embedded"]["custom_fields"]

    # ─── Helpers ──────────────────────────────────────────────────────────────

    @staticmethod
    def _raise_for_status(resp: httpx.Response) -> None:
        if resp.status_code >= 400:
            raise AmoCRMError(resp.status_code, resp.text)

    async def close(self) -> None:
        await self._client.aclose()


amo_client = AmoCRMClient()
