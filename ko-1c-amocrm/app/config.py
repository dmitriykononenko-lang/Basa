from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # Database
    database_url: str = "postgresql+asyncpg://user:password@db:5432/ko_middleware"

    # amoCRM OAuth2
    amo_domain: str = ""
    amo_client_id: str = ""
    amo_client_secret: str = ""
    amo_redirect_uri: str = ""
    amo_refresh_token: str = ""

    # Webhook security
    webhook_secret: str = "changeme"

    # 1С (pull mode)
    onec_base_url: str = ""
    onec_user: str = ""
    onec_password: str = ""
    onec_poll_interval_seconds: int = 60

    # App
    debug: bool = False
    log_level: str = "INFO"


settings = Settings()
