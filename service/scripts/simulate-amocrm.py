#!/usr/bin/env python3
"""Симулятор вебхуков AmoCRM.

Дёргает работающий сервис Basa так, как это делал бы реальный AmoCRM:
шлёт серию вебхуков по сделкам/задачам с правильной структурой payload'а,
после каждого проверяет состояние через REST API и печатает понятный лог.

Без зависимостей — только стандартная библиотека (urllib + json).

Запуск:
    python3 scripts/simulate-amocrm.py --scenario all
    python3 scripts/simulate-amocrm.py --scenario happy
    BASE=https://basa.example.com python3 scripts/simulate-amocrm.py

ENV / флаги:
    BASE                  http://localhost:8000           базовый URL сервиса
    ADMIN_EMAIL           admin@example.com               кто логинится
    ADMIN_PASSWORD        change-me                       пароль
    --scenario {all,happy,rollback,tasks,duplicate}
    --no-setup            пропустить создание аналитика и маппинга
    --keep-data           не чистить созданное (по умолчанию ничего не удаляется в любом случае)
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Optional


# ---------- Pretty print ----------------------------------------------------

class C:
    R = "\033[0m"
    G = "\033[32m"
    Y = "\033[33m"
    RED = "\033[31m"
    B = "\033[1m"
    DIM = "\033[2m"
    CYAN = "\033[36m"


def step(title: str) -> None:
    print(f"\n{C.B}== {title} =={C.R}")


def ok(msg: str) -> None:
    print(f"  {C.G}✓{C.R} {msg}")


def warn(msg: str) -> None:
    print(f"  {C.Y}!{C.R} {msg}")


def fail(msg: str, details: str = "") -> "NoReturn":
    print(f"  {C.RED}✗{C.R} {msg}")
    if details:
        print(f"    {details}")
    sys.exit(1)


def dim(msg: str) -> None:
    print(f"  {C.DIM}{msg}{C.R}")


# ---------- HTTP client ------------------------------------------------------


@dataclass
class Client:
    base: str
    token: Optional[str] = None

    def request(
        self,
        method: str,
        path: str,
        *,
        json_body: Any = None,
        expect: Optional[int] = None,
    ) -> tuple[int, Any]:
        url = self.base.rstrip("/") + path
        data = None
        headers = {"Accept": "application/json"}
        if json_body is not None:
            data = json.dumps(json_body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"

        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                code = resp.getcode()
                body_raw = resp.read()
        except urllib.error.HTTPError as exc:
            code = exc.code
            body_raw = exc.read()
        except urllib.error.URLError as exc:
            fail(f"Сетевая ошибка: {exc}", f"{method} {url}")

        body: Any
        try:
            body = json.loads(body_raw.decode("utf-8")) if body_raw else None
        except json.JSONDecodeError:
            body = body_raw.decode("utf-8", errors="replace")

        if expect is not None and code != expect:
            fail(
                f"{method} {path} вернул {code}, ожидался {expect}",
                json.dumps(body, ensure_ascii=False)[:500] if body else "",
            )
        return code, body


# ---------- Payload builders -------------------------------------------------


_ts_counter = [0]


def fresh_ts() -> int:
    """Строго возрастающий unix-таймстамп. AmoCRM в реальной жизни тоже не повторяет
    `updated_at` для разных событий по одной сущности — здесь моделируем то же."""
    now = int(time.time())
    _ts_counter[0] = max(_ts_counter[0] + 1, now)
    return _ts_counter[0]


def now_ts() -> int:
    return int(time.time())


def lead_payload(action: str, *, deal_id: int, status_id: int, user_id: int,
                 name: str = "Сделка", price: int = 100000,
                 event_ts: Optional[int] = None) -> dict:
    """Реалистичный AmoCRM-payload для leads[add|update|delete].

    Поля выровнены под то, что реально шлёт AmoCRM v4. `updated_at` задаётся
    `event_ts` или растущим счётчиком — это часть ключа идемпотентности.
    """
    ts = event_ts if event_ts is not None else fresh_ts()
    return {
        "leads": {
            action: [
                {
                    "id": str(deal_id),
                    "name": name,
                    "status_id": str(status_id),
                    "price": str(price),
                    "responsible_user_id": str(user_id),
                    "last_modified": str(ts),
                    "modified_user_id": str(user_id),
                    "created_user_id": str(user_id),
                    "date_create": str(ts - 3600),
                    "pipeline_id": "1318851",
                    "account_id": "12345678",
                    "updated_at": str(ts),
                    "custom_fields": [],
                    "contacts": ["54321"],
                }
            ]
        },
        "account": {"id": "12345678", "subdomain": "example"},
    }


def task_payload(action: str, *, task_id: int, entity_id: int, user_id: int,
                 task_type: int = 1, text: str = "Позвонить клиенту",
                 complete_till: Optional[int] = None,
                 is_completed: Optional[bool] = None,
                 completed_at: Optional[int] = None,
                 event_ts: Optional[int] = None) -> dict:
    ts = event_ts if event_ts is not None else fresh_ts()
    item: dict[str, Any] = {
        "id": str(task_id),
        "element_id": str(entity_id),
        "element_type": "2",  # 2 = lead
        "task_type": str(task_type),
        "text": text,
        "responsible_user_id": str(user_id),
        "created_at": str(ts - 3600),
        "account_id": "12345678",
        "updated_at": str(ts),
        "status": "1" if is_completed else "0",
    }
    if complete_till is not None:
        item["complete_till"] = str(complete_till)
    if is_completed is not None:
        item["is_completed"] = is_completed
    if completed_at is not None:
        item["completed_at"] = str(completed_at)
    return {"tasks": {action: [item]}}


# ---------- Setup helpers ----------------------------------------------------


# Этапы воронки, которые мы будем эмулировать
STAGE_CONTRACT_SIGNED = 1101
STAGE_WORK_DONE = 1102
STAGE_PAID_BY_CLIENT = 1103
STAGE_CANCELLED = 1104

AMO_USER_ID = 504141


def login(client: Client, email: str, password: str) -> None:
    step(f"Логин под {email}")
    _, body = client.request("POST", "/api/v1/auth/login",
                             json_body={"email": email, "password": password},
                             expect=200)
    client.token = body["access_token"]
    ok("получили access_token")


def ensure_analyst(client: Client) -> str:
    """Найти/создать аналитика с AMO_USER_ID и вернуть его UUID."""
    _, analysts = client.request("GET", "/api/v1/analysts", expect=200)
    for a in analysts:
        if a.get("amo_user_id") == AMO_USER_ID:
            ok(f"аналитик найден: {a['full_name']} ({a['id']})")
            return a["id"]
    payload = {
        "full_name": "Иван Симулятор",
        "email": f"sim-{AMO_USER_ID}@example.com",
        "amo_user_id": AMO_USER_ID,
        "default_rate": 25000,
    }
    _, a = client.request("POST", "/api/v1/analysts", json_body=payload, expect=201)
    ok(f"создан аналитик {a['full_name']} ({a['id']})")
    return a["id"]


def ensure_status_map(client: Client) -> None:
    mapping = {
        str(STAGE_CONTRACT_SIGNED): "start_project",
        str(STAGE_WORK_DONE):       "mark_done",
        str(STAGE_PAID_BY_CLIENT):  "mark_ready_for_payout",
        str(STAGE_CANCELLED):       "cancel",
    }
    client.request("PUT", "/api/v1/settings/amo_status_map",
                   json_body=mapping, expect=200)
    ok("amo_status_map записан")


# ---------- State checks -----------------------------------------------------


def find_project_by_deal(client: Client, deal_id: int) -> Optional[dict]:
    _, projects = client.request("GET", "/api/v1/projects", expect=200)
    for p in projects:
        if p.get("amo_deal_id") == deal_id:
            return p
    return None


def list_payments_for_analyst(client: Client, analyst_id: str) -> list[dict]:
    _, items = client.request("GET", f"/api/v1/payments?analyst_id={analyst_id}", expect=200)
    return items


def find_amo_task(client: Client, task_id: int) -> Optional[dict]:
    """Прямого CRUD-эндпоинта по amo_tasks у нас нет — проверяем через метрики."""
    return None  # checked indirectly via metrics


def wait_for(predicate, *, attempts: int = 20, delay: float = 0.2, label: str = "") -> bool:
    """Маленькая повторялка — реальная обработка идёт через RQ-воркер."""
    for _ in range(attempts):
        if predicate():
            return True
        time.sleep(delay)
    if label:
        warn(f"таймаут ожидания: {label}")
    return False


# ---------- Scenarios --------------------------------------------------------


def scenario_happy(client: Client, analyst_id: str) -> None:
    deal_id = random.randint(100_000, 999_999)
    step(f"Сценарий happy — сделка #{deal_id}")

    # 1) start_project
    client.request("POST", "/api/v1/amo/webhooks",
                   json_body=lead_payload("add", deal_id=deal_id,
                                          status_id=STAGE_CONTRACT_SIGNED,
                                          user_id=AMO_USER_ID,
                                          name=f"Sim deal {deal_id}"),
                   expect=200)
    if not wait_for(lambda: find_project_by_deal(client, deal_id) is not None,
                    label="создание проекта"):
        fail("проект так и не появился")
    project = find_project_by_deal(client, deal_id)
    assert project["status"] == "in_progress", project
    ok(f"проект создан, status=in_progress, payment_amount={project['payment_amount']}")

    # 2) mark_done → должна появиться выплата accrued
    client.request("POST", "/api/v1/amo/webhooks",
                   json_body=lead_payload("update", deal_id=deal_id,
                                          status_id=STAGE_WORK_DONE,
                                          user_id=AMO_USER_ID),
                   expect=200)
    if not wait_for(lambda: find_project_by_deal(client, deal_id)["status"] == "done",
                    label="перевод проекта в done"):
        fail("проект не перешёл в done")
    payments = list_payments_for_analyst(client, analyst_id)
    accrued = [p for p in payments if p.get("status") == "accrued"
               and p.get("project_id") == project["id"]]
    if not accrued:
        fail("выплата accrued не создана")
    ok(f"проект → done, выплата {accrued[0]['id']} accrued = {accrued[0]['amount']} ₽")

    # 3) повтор mark_done (с новым event_ts — Amo шлёт новое событие, не дубликат) —
    #    выплата всё равно не должна задвоиться, потому что процессор сам идемпотентен
    client.request("POST", "/api/v1/amo/webhooks",
                   json_body=lead_payload("update", deal_id=deal_id,
                                          status_id=STAGE_WORK_DONE,
                                          user_id=AMO_USER_ID),
                   expect=200)
    time.sleep(0.3)
    payments_after = [p for p in list_payments_for_analyst(client, analyst_id)
                      if p.get("project_id") == project["id"] and p["status"] != "cancelled"]
    if len(payments_after) != 1:
        fail(f"ожидалась 1 активная выплата, получено {len(payments_after)}")
    ok("повторный mark_done не задвоил выплату")

    # 4) mark_ready_for_payout
    client.request("POST", "/api/v1/amo/webhooks",
                   json_body=lead_payload("update", deal_id=deal_id,
                                          status_id=STAGE_PAID_BY_CLIENT,
                                          user_id=AMO_USER_ID),
                   expect=200)
    if not wait_for(lambda: any(p["status"] == "ready" and p["project_id"] == project["id"]
                                 for p in list_payments_for_analyst(client, analyst_id)),
                    label="перевод выплаты в ready"):
        fail("выплата не перешла в ready")
    ok("выплата → ready (готова к выплате аналитику)")

    # 5) accountant mark-paid через API (от админа — admin тоже может)
    pid = next(p["id"] for p in list_payments_for_analyst(client, analyst_id)
               if p["project_id"] == project["id"] and p["status"] == "ready")
    client.request("POST", f"/api/v1/payments/{pid}/mark-paid",
                   json_body={"comment": "перевод по платёжке #SIM"},
                   expect=200)
    ok("выплата → paid (бухгалтер отметил)")


def scenario_rollback(client: Client, analyst_id: str) -> None:
    deal_id = random.randint(100_000, 999_999)
    step(f"Сценарий rollback — сделка #{deal_id}")

    # доводим до paid
    for stage, label in (
        (STAGE_CONTRACT_SIGNED, "start"),
        (STAGE_WORK_DONE, "done"),
        (STAGE_PAID_BY_CLIENT, "ready"),
    ):
        client.request("POST", "/api/v1/amo/webhooks",
                       json_body=lead_payload("update", deal_id=deal_id,
                                              status_id=stage, user_id=AMO_USER_ID),
                       expect=200)
    if not wait_for(lambda: find_project_by_deal(client, deal_id) is not None,
                    label="ожидание создания"):
        fail("проект не появился")
    project = find_project_by_deal(client, deal_id)
    pid = next(p["id"] for p in list_payments_for_analyst(client, analyst_id)
               if p["project_id"] == project["id"] and p["status"] == "ready")
    client.request("POST", f"/api/v1/payments/{pid}/mark-paid",
                   json_body={}, expect=200)
    ok("довели сделку до paid")

    # пытаемся «откатить» в mark_done
    client.request("POST", "/api/v1/amo/webhooks",
                   json_body=lead_payload("update", deal_id=deal_id,
                                          status_id=STAGE_WORK_DONE, user_id=AMO_USER_ID),
                   expect=200)
    time.sleep(0.4)

    # выплата должна остаться paid, проект — paid
    pay = next(p for p in list_payments_for_analyst(client, analyst_id) if p["id"] == pid)
    if pay["status"] != "paid":
        fail(f"выплата сбилась в {pay['status']} — rollback не заблокирован")
    project_after = find_project_by_deal(client, deal_id)
    if project_after["status"] != "paid":
        fail(f"проект сбился в {project_after['status']}")
    ok("rollback заблокирован: проект и выплата остались в paid")


def scenario_tasks(client: Client, analyst_id: str) -> None:
    task_id = random.randint(100_000, 999_999)
    entity_id = random.randint(100_000, 999_999)
    initial_deadline = now_ts() + 3600 * 24            # завтра
    moved_deadline = now_ts() + 3600 * 24 * 5          # через 5 дней
    completion_ts = now_ts() + 3600 * 24 * 2           # послезавтра (после initial — просрочка)

    step(f"Сценарий tasks — задача #{task_id} (просрочка с переносом дедлайна)")

    # task add
    client.request("POST", "/api/v1/amo/webhooks",
                   json_body=task_payload("add", task_id=task_id, entity_id=entity_id,
                                          user_id=AMO_USER_ID, complete_till=initial_deadline),
                   expect=200)
    ok(f"задача добавлена, deadline_initial=через 24ч")

    # task update — двигаем дедлайн вперёд
    client.request("POST", "/api/v1/amo/webhooks",
                   json_body=task_payload("update", task_id=task_id, entity_id=entity_id,
                                          user_id=AMO_USER_ID, complete_till=moved_deadline),
                   expect=200)
    ok("дедлайн перенесён на +5 дней (deadline_initial не должен поменяться)")

    # task complete — после initial, но до moved → должна быть просрочка
    client.request("POST", "/api/v1/amo/webhooks",
                   json_body=task_payload("complete", task_id=task_id, entity_id=entity_id,
                                          user_id=AMO_USER_ID, complete_till=moved_deadline,
                                          is_completed=True,
                                          completed_at=completion_ts),
                   expect=200)
    ok("задача закрыта (после initial deadline, до moved)")

    # проверяем метрики
    time.sleep(0.4)
    # окно от 2 дней назад до 7 дней вперёд, чтобы попасть в период
    from urllib.parse import quote
    period_from = quote((datetime.now(timezone.utc) - timedelta(days=2)).isoformat())
    period_to = quote((datetime.now(timezone.utc) + timedelta(days=7)).isoformat())
    _, metrics = client.request("GET",
                                f"/api/v1/metrics/analyst/{analyst_id}?from={period_from}&to={period_to}",
                                expect=200)
    dim(f"метрики: {json.dumps(metrics, ensure_ascii=False)}")
    if metrics["closed_total"] < 1:
        fail("закрытая задача не попала в метрики")
    if metrics["closed_overdue"] < 1:
        fail("задача не помечена как просроченная относительно ПЕРВОНАЧАЛЬНОГО дедлайна")
    ok(f"задача учтена как просроченная: closed={metrics['closed_total']}, "
       f"overdue={metrics['closed_overdue']}, avg_delay={metrics['avg_overdue_seconds']}с")


def scenario_duplicate(client: Client, analyst_id: str) -> None:
    deal_id = random.randint(100_000, 999_999)
    step(f"Сценарий duplicate — сделка #{deal_id}")

    # подгоняем updated_at к фиксированному значению, чтобы оба запроса имели один idempotency-key
    fixed_ts = now_ts()
    payload = lead_payload("add", deal_id=deal_id,
                            status_id=STAGE_CONTRACT_SIGNED, user_id=AMO_USER_ID)
    # фиксируем поля, формирующие idempotency-key
    payload["leads"]["add"][0]["updated_at"] = str(fixed_ts)

    _, first = client.request("POST", "/api/v1/amo/webhooks",
                              json_body=payload, expect=200)
    if first.get("status") != "queued":
        fail(f"ожидали queued, получили {first}")
    ok("первый вебхук: queued")

    _, second = client.request("POST", "/api/v1/amo/webhooks",
                               json_body=payload, expect=200)
    if second.get("status") != "duplicate":
        fail(f"повтор не помечен как duplicate: {second}")
    ok("повторный вебхук: duplicate (идемпотентность работает)")


SCENARIOS = {
    "happy": scenario_happy,
    "rollback": scenario_rollback,
    "tasks": scenario_tasks,
    "duplicate": scenario_duplicate,
}


# ---------- Main -------------------------------------------------------------


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base", default=os.environ.get("BASE", "http://localhost:8000"))
    ap.add_argument("--email", default=os.environ.get("ADMIN_EMAIL", "admin@example.com"))
    ap.add_argument("--password", default=os.environ.get("ADMIN_PASSWORD", "change-me"))
    ap.add_argument("--scenario", choices=["all", *SCENARIOS.keys()], default="all")
    ap.add_argument("--no-setup", action="store_true",
                    help="не создавать аналитика и не записывать маппинг")
    args = ap.parse_args()

    print(f"{C.B}AmoCRM webhook simulator → {args.base}{C.R}")
    client = Client(base=args.base)
    login(client, args.email, args.password)

    if args.no_setup:
        _, analysts = client.request("GET", "/api/v1/analysts", expect=200)
        match = [a for a in analysts if a.get("amo_user_id") == AMO_USER_ID]
        if not match:
            fail("--no-setup: нет аналитика с amo_user_id=504141. Создайте его руками или уберите --no-setup.")
        analyst_id = match[0]["id"]
    else:
        step("Подготовка: аналитик и маппинг этапов")
        analyst_id = ensure_analyst(client)
        ensure_status_map(client)

    chosen = list(SCENARIOS.keys()) if args.scenario == "all" else [args.scenario]
    for name in chosen:
        SCENARIOS[name](client, analyst_id)

    print(f"\n{C.G}{C.B}=== готово ===\n{C.R}"
          "Откройте /webhook-log в SPA — увидите все обработанные события.")


if __name__ == "__main__":
    main()
