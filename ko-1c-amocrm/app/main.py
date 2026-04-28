import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import health, webhook_1c, webhook_amo
from app.workers.poller_1c import poll_1c_orders
from app.workers.retry_worker import run_retry_worker

log = structlog.get_logger()

app = FastAPI(
    title="KO 1С↔amoCRM Middleware",
    version="0.1.0",
    docs_url="/docs" if settings.debug else None,
    redoc_url="/redoc" if settings.debug else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(webhook_1c.router)
app.include_router(webhook_amo.router)

_scheduler = AsyncIOScheduler()


@app.on_event("startup")
async def startup():
    log.info("app_starting")

    # Retry worker каждые 5 минут
    _scheduler.add_job(run_retry_worker, "interval", minutes=5, id="retry_worker")

    # Poller 1С (активен только если ONEC_BASE_URL задан)
    if settings.onec_base_url:
        _scheduler.add_job(
            poll_1c_orders,
            "interval",
            seconds=settings.onec_poll_interval_seconds,
            id="poller_1c",
        )
        log.info("poller_1c_enabled", interval=settings.onec_poll_interval_seconds)

    _scheduler.start()
    log.info("app_started")


@app.on_event("shutdown")
async def shutdown():
    _scheduler.shutdown(wait=False)
    from app.services.amocrm_client import amo_client
    await amo_client.close()
    log.info("app_stopped")
