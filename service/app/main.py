from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import select

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models import User, UserRole

logger = logging.getLogger("basa")


def _ensure_initial_admin() -> None:
    """Создать первого администратора при пустой базе users."""
    with SessionLocal() as db:
        any_user = db.execute(select(User).limit(1)).scalar_one_or_none()
        if any_user is not None:
            return
        admin = User(
            email=settings.initial_admin_email,
            password_hash=hash_password(settings.initial_admin_password),
            role=UserRole.admin,
            full_name="Initial Admin",
            is_active=True,
        )
        db.add(admin)
        db.commit()
        logger.warning(
            "Bootstrapped initial admin %s — change the password immediately!",
            settings.initial_admin_email,
        )


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        _ensure_initial_admin()
    except Exception:  # noqa: BLE001
        logger.exception("Failed to bootstrap initial admin")
    yield


app = FastAPI(
    title="Basa — сервис учёта проектов и выплат",
    version="0.1.0",
    description="Учёт работы аналитиков, проектов и выплат с интеграцией AmoCRM.",
    lifespan=lifespan,
)


@app.get("/healthz", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(api_router)
