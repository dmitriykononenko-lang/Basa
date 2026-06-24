from __future__ import annotations

from functools import lru_cache
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Core
    database_url: str = "postgresql+psycopg://basa:basa_dev_password@db:5432/basa"
    redis_url: str = "redis://redis:6379/0"

    # Auth
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_access_ttl_minutes: int = 60
    jwt_refresh_ttl_days: int = 30

    # AmoCRM token encryption (cryptography.Fernet key, 32 url-safe base64-encoded bytes)
    token_encryption_key: str

    # AmoCRM OAuth (optional in dev — может быть пусто до подключения)
    amo_client_id: Optional[str] = None
    amo_client_secret: Optional[str] = None
    amo_redirect_uri: Optional[str] = None
    amo_base_url: Optional[str] = None

    # Bootstrap
    initial_admin_email: str = "admin@example.com"
    initial_admin_password: str = "admin"

    @property
    def amo_oauth_configured(self) -> bool:
        return bool(self.amo_client_id and self.amo_client_secret and self.amo_redirect_uri and self.amo_base_url)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
