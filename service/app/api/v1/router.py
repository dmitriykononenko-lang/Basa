from fastapi import APIRouter

from app.api.v1.endpoints import (
    alerts,
    amo,
    analysts,
    auth,
    metrics,
    payments,
    projects,
    settings as settings_endpoint,
    webhook_log,
)

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(auth.router)
api_router.include_router(analysts.router)
api_router.include_router(projects.router)
api_router.include_router(payments.router)
api_router.include_router(amo.router)
api_router.include_router(settings_endpoint.router)
api_router.include_router(webhook_log.router)
api_router.include_router(metrics.router)
api_router.include_router(alerts.router)
