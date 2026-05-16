"""Авто-расписание pull-синков с AmoCRM (ТЗ §2.3).

Расписание держится в Redis через `rq-scheduler`:
  - hourly:   sync_leads(24h) + sync_tasks(24h)
  - daily:    полная сверка задач за 30 дней в 03:30 UTC
  - daily:    полная сверка сделок за 30 дней в 03:35 UTC

Регистрируется при старте воркера (`python -m app.worker`). Идемпотентно:
если запись уже есть в очереди — не дублируем.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from redis import Redis
from rq_scheduler import Scheduler

from app.core.config import settings
from app.db.session import SessionLocal
from app.services.amo_client import AmoApiError
from app.services.sync import sync_leads as _sync_leads
from app.services.sync import sync_tasks as _sync_tasks

logger = logging.getLogger(__name__)

QUEUE_NAME = "default"

JOB_HOURLY_LEADS = "basa.sched.hourly.leads"
JOB_HOURLY_TASKS = "basa.sched.hourly.tasks"
JOB_DAILY_LEADS = "basa.sched.daily.leads.30d"
JOB_DAILY_TASKS = "basa.sched.daily.tasks.30d"


# ---- Jobs that the worker executes -----------------------------------------


def hourly_leads_job() -> dict:
    """Подтянуть сделки за последние 24 часа. Не падает, если Amo не подключён."""
    db = SessionLocal()
    try:
        result = _sync_leads(db)
        return {"job": JOB_HOURLY_LEADS, "leads_seen": result.leads_seen,
                "actions_applied": result.actions_applied,
                "rollbacks_blocked": result.rollbacks_blocked}
    except RuntimeError as exc:
        # OAuth ещё не подключён — это нормально, не алертим
        logger.info("hourly leads sync skipped: %s", exc)
        return {"job": JOB_HOURLY_LEADS, "skipped": str(exc)}
    except AmoApiError as exc:
        logger.warning("hourly leads sync failed: %s", exc)
        raise
    finally:
        db.close()


def hourly_tasks_job() -> dict:
    db = SessionLocal()
    try:
        result = _sync_tasks(db)
        return {"job": JOB_HOURLY_TASKS, "tasks_seen": result.tasks_seen,
                "tasks_upserted": result.tasks_upserted}
    except RuntimeError as exc:
        logger.info("hourly tasks sync skipped: %s", exc)
        return {"job": JOB_HOURLY_TASKS, "skipped": str(exc)}
    except AmoApiError as exc:
        logger.warning("hourly tasks sync failed: %s", exc)
        raise
    finally:
        db.close()


def daily_leads_30d_job() -> dict:
    db = SessionLocal()
    try:
        since = datetime.now(timezone.utc) - timedelta(days=30)
        result = _sync_leads(db, since=since)
        return {"job": JOB_DAILY_LEADS, "leads_seen": result.leads_seen,
                "actions_applied": result.actions_applied}
    except RuntimeError as exc:
        logger.info("daily leads sync skipped: %s", exc)
        return {"job": JOB_DAILY_LEADS, "skipped": str(exc)}
    finally:
        db.close()


def daily_tasks_30d_job() -> dict:
    db = SessionLocal()
    try:
        since = datetime.now(timezone.utc) - timedelta(days=30)
        result = _sync_tasks(db, since=since)
        return {"job": JOB_DAILY_TASKS, "tasks_seen": result.tasks_seen,
                "tasks_upserted": result.tasks_upserted}
    except RuntimeError as exc:
        logger.info("daily tasks sync skipped: %s", exc)
        return {"job": JOB_DAILY_TASKS, "skipped": str(exc)}
    finally:
        db.close()


# ---- Registration ----------------------------------------------------------


def _get_scheduler() -> Scheduler:
    redis = Redis.from_url(settings.redis_url)
    return Scheduler(queue_name=QUEUE_NAME, connection=redis)


def _ensure_cron(scheduler: Scheduler, job_id: str, cron: str, func_path: str) -> str:
    """Поставить cron-задачу, если такой ещё нет. Возвращает 'created' | 'exists'."""
    if job_id in (j.id for j in scheduler.get_jobs()):
        return "exists"
    scheduler.cron(
        cron_string=cron,
        func=func_path,
        id=job_id,
        repeat=None,
        timeout=300,
        queue_name=QUEUE_NAME,
    )
    return "created"


def register_schedule() -> dict[str, str]:
    """Зарегистрировать расписание в Redis-планировщике. Идемпотентно."""
    s = _get_scheduler()
    return {
        JOB_HOURLY_LEADS: _ensure_cron(s, JOB_HOURLY_LEADS, "5 * * * *",
                                       "app.services.scheduler.hourly_leads_job"),
        JOB_HOURLY_TASKS: _ensure_cron(s, JOB_HOURLY_TASKS, "10 * * * *",
                                       "app.services.scheduler.hourly_tasks_job"),
        JOB_DAILY_LEADS:  _ensure_cron(s, JOB_DAILY_LEADS, "30 3 * * *",
                                       "app.services.scheduler.daily_leads_30d_job"),
        JOB_DAILY_TASKS:  _ensure_cron(s, JOB_DAILY_TASKS, "35 3 * * *",
                                       "app.services.scheduler.daily_tasks_30d_job"),
    }


def list_scheduled_jobs() -> list[dict]:
    """Сводка расписания для админки."""
    s = _get_scheduler()
    out: list[dict] = []
    for job in s.get_jobs(with_times=True):
        job_obj, next_at = job if isinstance(job, tuple) else (job, None)
        out.append({
            "id": job_obj.id,
            "func": job_obj.func_name,
            "next_at": next_at.isoformat() if next_at else None,
        })
    return out


def remove_schedule() -> list[str]:
    """Снять всё наше расписание. Возвращает список снятых job_id."""
    s = _get_scheduler()
    removed: list[str] = []
    for job_id in (JOB_HOURLY_LEADS, JOB_HOURLY_TASKS, JOB_DAILY_LEADS, JOB_DAILY_TASKS):
        for job in s.get_jobs():
            if job.id == job_id:
                s.cancel(job)
                removed.append(job_id)
                break
    return removed
