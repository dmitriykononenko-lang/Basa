"""Тесты регистрации расписания и идемпотентности.

Реального Redis тут нет — подменяем `_get_scheduler` на in-memory заглушку,
проверяем что register_schedule заводит 4 cron'а и повтор не дублирует.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class _FakeJob:
    id: str
    func_name: str = ""


@dataclass
class _FakeScheduler:
    jobs: dict = field(default_factory=dict)

    def get_jobs(self, with_times: bool = False):
        items = list(self.jobs.values())
        if with_times:
            return [(j, None) for j in items]
        return items

    def cron(self, *, cron_string, func, id, repeat=None, timeout=300, queue_name="default"):
        self.jobs[id] = _FakeJob(id=id, func_name=func)

    def cancel(self, job):
        self.jobs.pop(job.id, None)


def _patch_scheduler(monkeypatch, fake):
    from app.services import scheduler as sched_mod
    monkeypatch.setattr(sched_mod, "_get_scheduler", lambda: fake)


def test_register_schedule_creates_four_jobs(monkeypatch):
    from app.services.scheduler import (
        JOB_DAILY_LEADS,
        JOB_DAILY_TASKS,
        JOB_HOURLY_LEADS,
        JOB_HOURLY_TASKS,
        register_schedule,
    )

    fake = _FakeScheduler()
    _patch_scheduler(monkeypatch, fake)

    result = register_schedule()
    assert result == {
        JOB_HOURLY_LEADS: "created",
        JOB_HOURLY_TASKS: "created",
        JOB_DAILY_LEADS: "created",
        JOB_DAILY_TASKS: "created",
    }
    assert set(fake.jobs.keys()) == set(result.keys())


def test_register_schedule_is_idempotent(monkeypatch):
    from app.services.scheduler import register_schedule

    fake = _FakeScheduler()
    _patch_scheduler(monkeypatch, fake)

    register_schedule()
    second = register_schedule()
    assert all(status == "exists" for status in second.values())
    assert len(fake.jobs) == 4


def test_remove_schedule(monkeypatch):
    from app.services.scheduler import register_schedule, remove_schedule

    fake = _FakeScheduler()
    _patch_scheduler(monkeypatch, fake)
    register_schedule()
    removed = remove_schedule()
    assert len(removed) == 4
    assert fake.jobs == {}


def test_list_scheduled_jobs(monkeypatch):
    from app.services.scheduler import list_scheduled_jobs, register_schedule

    fake = _FakeScheduler()
    _patch_scheduler(monkeypatch, fake)
    register_schedule()

    rows = list_scheduled_jobs()
    assert {r["id"] for r in rows} == {
        "basa.sched.hourly.leads",
        "basa.sched.hourly.tasks",
        "basa.sched.daily.leads.30d",
        "basa.sched.daily.tasks.30d",
    }


def test_hourly_leads_job_does_not_throw_when_amo_not_configured(monkeypatch):
    """Если у нас нет токенов AmoCRM, job должен молча скипнуться, а не падать."""
    from app.services import scheduler as sched_mod
    from app.services.amo_client import AmoApiError  # noqa: F401

    class _RaisingSync:
        def __call__(self, *args, **kwargs):
            raise RuntimeError("AmoCRM is not authorized yet")

    monkeypatch.setattr(sched_mod, "_sync_leads", _RaisingSync())
    monkeypatch.setattr(sched_mod, "_sync_tasks", _RaisingSync())

    # SessionLocal вызывается внутри — стопаем по этому пути
    class _Sess:
        def close(self): pass
    monkeypatch.setattr(sched_mod, "SessionLocal", lambda: _Sess())

    r = sched_mod.hourly_leads_job()
    assert "skipped" in r
    r = sched_mod.hourly_tasks_job()
    assert "skipped" in r
