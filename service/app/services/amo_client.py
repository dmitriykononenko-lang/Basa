"""HTTP-клиент AmoCRM REST API v4."""

from __future__ import annotations

from typing import Any, Optional

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.services.amo_token_store import AmoTokens, load_tokens, save_tokens


class AmoApiError(RuntimeError):
    def __init__(self, status_code: int, body: str) -> None:
        super().__init__(f"AmoCRM API error {status_code}: {body}")
        self.status_code = status_code
        self.body = body


class AmoClient:
    """Тонкая обёртка над httpx с автообновлением access_token."""

    def __init__(self, db: Session, *, http_timeout: float = 15.0) -> None:
        if not settings.amo_oauth_configured:
            raise RuntimeError("AmoCRM OAuth is not configured (.env)")
        self._db = db
        self._timeout = http_timeout

    # ---- OAuth ----

    def exchange_code(self, code: str) -> AmoTokens:
        resp = httpx.post(
            f"{settings.amo_base_url}/oauth2/access_token",
            json={
                "client_id": settings.amo_client_id,
                "client_secret": settings.amo_client_secret,
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": settings.amo_redirect_uri,
            },
            timeout=self._timeout,
        )
        if resp.status_code != 200:
            raise AmoApiError(resp.status_code, resp.text)
        data = resp.json()
        save_tokens(self._db, data["access_token"], data["refresh_token"], data["expires_in"])
        return load_tokens(self._db)  # type: ignore[return-value]

    def refresh(self, refresh_token: str) -> AmoTokens:
        resp = httpx.post(
            f"{settings.amo_base_url}/oauth2/access_token",
            json={
                "client_id": settings.amo_client_id,
                "client_secret": settings.amo_client_secret,
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "redirect_uri": settings.amo_redirect_uri,
            },
            timeout=self._timeout,
        )
        if resp.status_code != 200:
            raise AmoApiError(resp.status_code, resp.text)
        data = resp.json()
        save_tokens(self._db, data["access_token"], data["refresh_token"], data["expires_in"])
        return load_tokens(self._db)  # type: ignore[return-value]

    def _get_access_token(self) -> str:
        tokens = load_tokens(self._db)
        if tokens is None:
            raise RuntimeError("AmoCRM is not authorized yet — visit /api/v1/amo/oauth/start first")
        if tokens.is_expired():
            tokens = self.refresh(tokens.refresh_token)
        return tokens.access_token

    # ---- REST ----

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        url = f"{settings.amo_base_url}{path}"
        headers = kwargs.pop("headers", {})
        headers["Authorization"] = f"Bearer {self._get_access_token()}"
        resp = httpx.request(method, url, headers=headers, timeout=self._timeout, **kwargs)
        if resp.status_code == 204:
            return None
        if resp.status_code >= 400:
            raise AmoApiError(resp.status_code, resp.text)
        return resp.json()

    def get_leads(self, *, updated_since_ts: Optional[int] = None, page: int = 1, limit: int = 250) -> Any:
        params: dict[str, Any] = {"page": page, "limit": limit, "with": "contacts"}
        if updated_since_ts is not None:
            params["filter[updated_at][from]"] = updated_since_ts
        return self._request("GET", "/api/v4/leads", params=params)

    def get_lead(self, lead_id: int) -> Any:
        return self._request("GET", f"/api/v4/leads/{lead_id}", params={"with": "contacts,catalog_elements"})

    def get_tasks(self, *, updated_since_ts: Optional[int] = None, page: int = 1, limit: int = 250) -> Any:
        params: dict[str, Any] = {"page": page, "limit": limit}
        if updated_since_ts is not None:
            params["filter[updated_at][from]"] = updated_since_ts
        return self._request("GET", "/api/v4/tasks", params=params)

    def get_pipelines(self) -> Any:
        return self._request("GET", "/api/v4/leads/pipelines")

    def get_users(self) -> Any:
        return self._request("GET", "/api/v4/users")
