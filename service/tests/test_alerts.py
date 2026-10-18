from __future__ import annotations

from time import time


class _FakeRedis:
    """Минимальная заглушка под используемые методы Redis sorted set."""

    def __init__(self):
        self._zset: dict[str, list[tuple[float, bytes]]] = {}

    def zadd(self, key, mapping):
        self._zset.setdefault(key, [])
        for member, score in mapping.items():
            self._zset[key].append((float(score), str(member).encode()))

    def zremrangebyscore(self, key, min_score, max_score):
        items = self._zset.get(key, [])
        kept = [(s, m) for s, m in items if not (min_score <= s <= max_score)]
        self._zset[key] = kept

    def zcount(self, key, min_score, max_score):
        return sum(1 for s, _ in self._zset.get(key, []) if min_score <= s <= max_score)

    def zrevrangebyscore(self, key, max_score, min_score, start=0, num=None, withscores=False):
        items = [(s, m) for s, m in self._zset.get(key, []) if min_score <= s <= max_score]
        items.sort(key=lambda x: x[0], reverse=True)
        items = items[start:start + (num or len(items))]
        return [(m, s) for s, m in items] if withscores else [m for _, m in items]


def test_alert_status_starts_clean(monkeypatch):
    from app.services import alerts

    fake = _FakeRedis()
    monkeypatch.setattr(alerts, "_redis", lambda: fake)

    st = alerts.get_status(threshold=10)
    assert st.errors_last_hour == 0
    assert st.triggered is False


def test_alert_triggers_above_threshold(monkeypatch):
    from app.services import alerts

    fake = _FakeRedis()
    monkeypatch.setattr(alerts, "_redis", lambda: fake)

    now = time()
    for i in range(11):
        alerts.record_error(f"err {i}", now_ts=now - i)

    st = alerts.get_status(threshold=10, now_ts=now)
    assert st.errors_last_hour == 11
    assert st.triggered is True


def test_old_errors_drop_out_of_window(monkeypatch):
    from app.services import alerts

    fake = _FakeRedis()
    monkeypatch.setattr(alerts, "_redis", lambda: fake)

    now = time()
    alerts.record_error("old", now_ts=now - 7200)  # 2 часа назад
    alerts.record_error("recent", now_ts=now - 60)

    st = alerts.get_status(threshold=10, now_ts=now)
    assert st.errors_last_hour == 1


def test_recent_errors_returns_messages(monkeypatch):
    from app.services import alerts

    fake = _FakeRedis()
    monkeypatch.setattr(alerts, "_redis", lambda: fake)

    now = time()
    alerts.record_error("oops one", now_ts=now - 100)
    alerts.record_error("oops two", now_ts=now - 10)

    recent = alerts.list_recent_errors(limit=10, now_ts=now)
    details = [r["detail"] for r in recent]
    assert "oops two" in details
    assert "oops one" in details


def test_redis_unavailable_does_not_throw(monkeypatch):
    from app.services import alerts

    monkeypatch.setattr(alerts, "_redis", lambda: None)
    alerts.record_error("test")  # не должно бросить
    st = alerts.get_status()
    assert st.errors_last_hour == 0
    assert alerts.list_recent_errors() == []
