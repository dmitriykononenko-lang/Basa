# Basa — сервис учёта проектов и выплат

Бэкенд по ТЗ v1.0: FastAPI + PostgreSQL + Redis + интеграция с AmoCRM (OAuth, REST,
pull-синхронизация, приём вебхуков). Зеркало ответов на открытые вопросы из ТЗ — в
[`DECISIONS.md`](./DECISIONS.md).

> **Статус:** все 4 фазы по ТЗ v1.0 готовы.
>
> - **Фаза 1:** модели, миграции, JWT-роли, CRUD по аналитикам/проектам/выплатам,
>   OAuth-обмен с AmoCRM, ручной pull-сделок, приём вебхуков с идемпотентностью.
> - **Фаза 2:** воркер RQ для обработки `amo_webhook_log`, маппинг статусов в settings,
>   автосоздание проектов/выплат по статусам сделок (`start_project`, `mark_done`,
>   `mark_ready_for_payout`, `cancel`), журнал событий + ручная переобработка,
>   IP-whitelist на вебхуках. Pull и вебхуки используют общий процессор —
>   семантика одинакова, откаты статуса блокируются (Q6).
> - **Фаза 3:** обработка вебхуков задач (`tasks[add|update|complete]`) с фиксацией
>   первоначального дедлайна, pull-синхронизация задач, расчёт метрик
>   эффективности, фильтр типов задач, эндпоинты метрик со scope для аналитика.
> - **Фаза 4:** SPA на vanilla JS (логин + личный кабинет аналитика / админка /
>   кабинет бухгалтера) — отдаётся через `StaticFiles` корнем приложения;
>   XLSX-экспорт реестра выплат для банка/1С; алертинг по ошибкам обработки
>   через Redis sliding window (ТЗ §9.2); скрипты бэкапа и восстановления PG.

## Структура

```
service/
├── app/
│   ├── core/             # settings, JWT, password hashing, AES-фернетный шифратор
│   ├── db/               # SQLAlchemy declarative base, session
│   ├── models/           # users / analysts / projects / payments / amo_tasks / ...
│   ├── schemas/          # Pydantic-схемы запросов и ответов
│   ├── services/         # AmoClient, token store, sync_leads
│   └── api/v1/endpoints/ # auth, analysts, projects, payments, amo
├── migrations/           # Alembic (env.py + versions/)
├── tests/                # pytest, юнит-тесты крипты/JWT/идемпотентности/sync helpers
├── Dockerfile
├── docker-compose.yml    # db (PG15) + redis + app + worker
├── pyproject.toml
└── .env.example
```

## Быстрый старт

```bash
cd service
cp .env.example .env
# 1) Сгенерировать ключ шифрования токенов AmoCRM
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
# вставить в .env как TOKEN_ENCRYPTION_KEY
# 2) Сгенерировать JWT_SECRET
openssl rand -hex 32
# вставить в .env как JWT_SECRET

docker compose up --build
```

После запуска:

- API: `http://localhost:8000`
- OpenAPI / Swagger UI: `http://localhost:8000/docs`
- Healthcheck: `GET /healthz`
- Первичный админ создаётся автоматически из `INITIAL_ADMIN_EMAIL` / `INITIAL_ADMIN_PASSWORD`
  (пароль обязательно смените сразу после первого логина).

## Авторизация

JWT-bearer. Эндпоинты под `/api/v1/`.

```bash
# логин
curl -s http://localhost:8000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"change-me"}'
# → {"access_token": "...", "refresh_token": "...", "token_type": "bearer"}
```

Дальше во всех запросах: `Authorization: Bearer <access_token>`.

Роли:
- `admin` — полный доступ;
- `accountant` — видит выплаты, может пометить `mark-paid`, не редактирует суммы (Q5);
- `analyst` — видит только свои проекты и выплаты (фильтрация на уровне сервиса).

## Интеграция с AmoCRM

Подробный пошаговый гайд — [`AMOCRM_SETUP.md`](./AMOCRM_SETUP.md). Кратко:

1. **На стороне AmoCRM:** в *Настройки → Интеграции* создать приватную
   интеграцию, прописать redirect URI `https://<ваш-домен>/api/v1/amo/oauth/callback`
   и подписку на вебхуки `https://<ваш-домен>/api/v1/amo/webhooks` (сделки и задачи).
2. **На стороне Basa:** в `.env` заполнить `AMO_CLIENT_ID`, `AMO_CLIENT_SECRET`,
   `AMO_REDIRECT_URI`, `AMO_BASE_URL` (поддомен вашего аккаунта вида
   `https://acc.amocrm.ru`) и перезапустить контейнер.
3. **OAuth-консент:** SPA → вкладка **AmoCRM** → «Подключить». После согласия
   AmoCRM перенаправит на наш callback, токены сохранятся зашифрованно
   (Fernet/AES-256-эквивалент), CSRF проверится одноразовым `state`.
4. **Проверка:** SPA → AmoCRM → «Проверить связь». Сервис дёрнет
   `GET /api/v4/users` и покажет число видимых пользователей. Снаружи —
   `./scripts/amo-check.sh`.
5. **Маппинги:** `amo_user_id` у аналитика (`PATCH /api/v1/analysts/{id}`) и
   `amo_status_map` в settings (через SPA → Настройки) — без них вебхуки не
   создадут проекты.
6. **Pull-сверка (страховка от потерянных вебхуков, ТЗ §2.3):**
   ```bash
   curl -X POST .../api/v1/amo/sync/run    -H "Authorization: Bearer $TOKEN"
   curl -X POST .../api/v1/amo/sync/tasks  -H "Authorization: Bearer $TOKEN"
   ```
   Эти эндпоинты безопасно дёргать по cron каждый час.

OAuth-эндпоинты:

| Путь | Что делает |
|---|---|
| `GET  /api/v1/amo/oauth/start`      | Сохраняет одноразовый `state` в settings, возвращает `{url}` — SPA редиректит на AmoCRM |
| `GET  /api/v1/amo/oauth/callback`   | Принимает `code` + `state` от AmoCRM, сверяет CSRF, меняет код на токены |
| `GET  /api/v1/amo/oauth/status`     | Текущее состояние: env настроен, есть ли токены, когда истекают |
| `POST /api/v1/amo/oauth/ping`       | `GET /api/v4/users` — проверка живости интеграции |
| `POST /api/v1/amo/oauth/disconnect` | Стирает сохранённые токены (для перезаключения интеграции) |

### Маппинг статусов воронки

Хранится в таблице `settings` под ключом `amo_status_map`. Значение — действие,
которое процессор применяет к проекту/выплате при попадании сделки в этот этап:

```json
{
  "12345": "start_project",
  "12346": "mark_done",
  "12347": "mark_ready_for_payout",
  "12348": "cancel"
}
```

| Значение | Что делает |
|---|---|
| `start_project`         | Создаёт проект, если ещё нет; ставит `in_progress` |
| `mark_done`             | Проект → `done`, создаёт `payment(accrued)` если не было |
| `mark_ready_for_payout` | `payment(accrued)` → `ready` (готово к выплате аналитику) |
| `cancel`                | Проект → `cancelled`, все его не-`paid` выплаты → `cancelled` |
| `none`                  | Игнорировать |

Все операции идемпотентны. Откат на «более ранний» статус (например, обратно из
`paid` в `done`) **блокируется** — фиксируется в журнале (`rollback_blocked=true`),
дальше администратор разбирает руками (см. `DECISIONS.md`, Q6).

Поставить маппинг можно через API:

```bash
curl -X PUT http://localhost:8000/api/v1/settings/amo_status_map \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"12345":"start_project","12346":"mark_done","12347":"mark_ready_for_payout","12348":"cancel"}'
```

### IP-whitelist на вебхуках

Хранится в `settings.amo_webhook_allowed_ips`. Поддерживает одиночные IP и CIDR.
Если список пуст или ключ отсутствует — принимаем всех (для отладки). Включается
постепенно:

```bash
curl -X PUT http://localhost:8000/api/v1/settings/amo_webhook_allowed_ips \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"ips":["185.39.196.0/24","185.39.197.0/24"]}'
```

Источник IP читается из `X-Forwarded-For` (первый в цепочке) — Amo должен идти
через ваш reverse proxy с HTTPS.

### Метрики эффективности (Фаза 3)

Считаются на лету по таблице `amo_tasks`, которая заполняется вебхуками задач
(`tasks[add|update|complete]`) и pull-синхронизацией. Правила — из ТЗ §5.2:

- **Первоначальный дедлайн фиксируется один раз.** Если аналитик перенёс срок в
  AmoCRM, `deadline_initial` не меняется — `is_overdue` всегда считается
  относительно него.
- Задачи без дедлайна **не входят** в расчёт % просрочек, но отображаются
  отдельной строкой «без срока».
- Учитываемые типы задач настраиваются ключом `settings.tracked_task_types`
  (`{"types": [1, 2]}` — массив `task_type_id`). По умолчанию — все типы.

```bash
# по конкретному аналитику
GET  /api/v1/metrics/analyst/{id}?from=2026-04-12T00:00:00Z&to=2026-05-12T00:00:00Z

# сводный дашборд по всем активным аналитикам (для роли analyst — только своя строка)
GET  /api/v1/metrics/dashboard?from=...&to=...

# ручной запуск pull-задач (страховка от потерянных вебхуков, ТЗ §2.3)
POST /api/v1/amo/sync/tasks                # за последние 24 часа
POST /api/v1/amo/sync/tasks?since=2026-04-12T00:00:00Z
```

Ответ метрик:

```json
{
  "analyst_id": "...",
  "analyst_name": "Иван Петров",
  "period_from": "2026-04-12T00:00:00+00:00",
  "period_to":   "2026-05-12T00:00:00+00:00",
  "closed_total": 47,
  "closed_overdue": 6,
  "overdue_pct": 12.77,
  "avg_overdue_seconds": 21600.0,
  "open_overdue": 2,
  "open_no_deadline": 5
}
```

Дашборд сортирует аналитиков по возрастанию `overdue_pct` (при равенстве — по
убыванию `closed_total`).

### Журнал вебхуков

```bash
# последние записи с фильтрами
GET  /api/v1/webhook-log?processed=false&has_error=true&limit=50

# отдельная запись с полным payload
GET  /api/v1/webhook-log/{id}

# переобработать одну (sync=true — в текущем запросе вместо очереди)
POST /api/v1/webhook-log/{id}/reprocess
POST /api/v1/webhook-log/{id}/reprocess?sync=true

# заново поставить в очередь всех необработанных
POST /api/v1/webhook-log/reprocess-unprocessed?limit=200
```

## Тесты

```bash
pip install -e ".[dev]"
pytest -q
```

**32 теста**, включая end-to-end сценарий Фазы 2 (`tests/test_e2e_phase2.py`): полный
поток от вебхука AmoCRM до выставленной выплаты через FastAPI TestClient + SQLite
in-memory, c шунтом RQ-очереди на синхронный вызов процессора (тот же код, что в
воркере). Покрывает:

- старт проекта по вебхуку → проверка `projects`;
- идемпотентность (дубликат вебхука не создаёт дубль);
- mark_done → накопление выплаты, повтор не задваивает;
- mark_ready_for_payout → перевод выплаты в `ready`;
- бухгалтерская `mark-paid` → проект → `paid`;
- «откатный» вебхук после оплаты → блокируется (Q6);
- IP-whitelist → 403 для не-listed адресов;
- роль `analyst` → видит только свои проекты.

### Прогон Фазы 2 против поднятой инфраструктуры

После `docker compose up -d --build` можно прогнать живой сценарий вебхуков:

```bash
./scripts/run-phase2.sh
```

Скрипт логинится под админом, создаёт аналитика и маппинг этапов, шлёт серию
вебхуков (старт → done → ready → paid → попытка отката), проверяет идемпотентность
и IP-whitelist. Каждый шаг выводит ✓/✗ — на любой не-OK ответ прерывается.

Чтобы прогнать целиком включая бухгалтерскую часть, заранее заведите пользователя
с ролью `accountant` (CRUD юзеров пока через БД) и экспортируйте
`ACC_EMAIL` / `ACC_PASS`; без них шаг "платим" отрабатывает от админа.

## Веб-интерфейс (SPA)

Открывается по корню — `http://localhost:8000/`. Vanilla-JS, без сборки, всё в `web/`:
- `web/index.html` — единая точка входа с экраном логина и шеллом приложения;
- `web/app.js` — hash-роутер, fetch с JWT, авто-refresh токена, рендеринг таблиц/форм;
- `web/styles.css` — стили, адаптив от 360px (ТЗ §6 + DECISIONS Q8).

Вкладки и доступ по ролям:

| Вкладка        | admin | accountant | analyst        |
|----------------|:-----:|:----------:|:--------------:|
| Проекты        |  ✓    |    ✓       | свои           |
| Выплаты + XLSX |  ✓    |    ✓       | свои (без XLSX) |
| Эффективность  |  ✓    |    ✓       | своя строка    |
| Аналитики      |  ✓    |    —       | —              |
| Журнал AmoCRM  |  ✓    |    —       | —              |
| Настройки      |  ✓    |    —       | —              |

В FastAPI SPA смонтирован последним, чтобы не перекрывать `/api/v1/*`, `/docs`,
`/healthz`.

## Экспорт реестра выплат

```bash
GET /api/v1/payments/export.xlsx?status=ready&from=2026-05-01T00:00:00Z&analyst_id=<uuid>
# доступно admin и accountant
```

Колонки: Дата начисления | Аналитик | Проект | Сумма | Статус | Реквизиты |
Комментарий. Реквизиты собираются из `analysts.payment_details` (jsonb) в строку
вида `bank: Sber; bik: 044525225; account: 408...`. Файл — стандартный xlsx,
без правок открывается в Excel/LibreOffice/1С.

## Алерты по ошибкам обработки

ТЗ §9.2 — алерт при > 10 ошибок обработки вебхуков за час. Реализовано через
Redis sorted-set (sliding window):

```bash
GET /api/v1/alerts/status?threshold=10
# → {"errors_last_hour": 3, "threshold": 10, "triggered": false, "window_seconds": 3600}

GET /api/v1/alerts/recent?limit=50
# последние сообщения об ошибках процессора, по убыванию времени
```

Каждое исключение в `process_webhook_log` автоматически попадает в окно через
`alerts.record_error`. Redis-недоступность не валит процессор — просто пишется
warning в лог.

## Бэкапы PG (ТЗ §2.2)

`scripts/backup-db.sh` делает `pg_dump | gzip` в `$BACKUP_DIR` (по умолчанию
`/var/backups/basa`), хранит 14 дней (`$RETENTION_DAYS`). Работает через
`docker compose exec db pg_dump` если контейнер запущен, иначе через локальный
`pg_dump`.

```bash
BACKUP_DIR=/var/backups/basa ./scripts/backup-db.sh
```

`scripts/cron-backup.example` — заготовка для `/etc/cron.d/basa-backup`,
запускающая бэкап ежедневно в 03:15 UTC.

`scripts/restore-db.sh basa-20260512T100000Z.sql.gz` — восстановление: дропает
БД, создаёт заново, накатывает дамп. Заранее останавливает `app` и `worker`,
запускает обратно после успеха.

## Что ещё не сделано (опционально / NFR)

- **Расписания pull-синков (cron внутри воркера):** сейчас `/sync/run` и
  `/sync/tasks` запускаются вручную или через внешний cron. ТЗ §2.3 предполагает
  hourly за 24ч + daily за 30 дней — можно подключить RQ-Scheduler или systemd-таймер.
- **Rate limit** на `POST /api/v1/amo/webhooks` (ТЗ §9.1) — отложен; при предполагаемой
  нагрузке (~50 вебхуков/час пиково) не критично, заложить можно через redis sliding window.
- **Email/Slack-доставка алертов** — сейчас только REST-эндпоинт; интеграция с
  каналами уведомлений идёт отдельным шагом.

## Маппинг на ТЗ

| Раздел ТЗ | Где в коде |
|---|---|
| 3.1 analysts          | `app/models/analyst.py`, миграция `202605120001` |
| 3.2 projects          | `app/models/project.py` |
| 3.3 payments          | `app/models/payment.py`, аудит в `payment_audit` |
| 3.4 amo_tasks         | `app/models/amo_task.py`, заполнение — `app/services/task_processor.py` |
| 3.5 amo_webhook_log   | `app/models/amo_webhook_log.py` |
| 3.6 settings          | `app/models/setting.py` |
| 4.1 OAuth + crypto    | `app/services/amo_client.py`, `app/core/crypto.py` |
| 4.2 webhooks          | `app/api/v1/endpoints/amo.py::amo_webhook` + IP-whitelist |
| 4.2 идемпотентность + очередь | `amo_webhook_log.idempotency_key` + `app/services/queue.py` + воркер `app/worker.py` |
| 4.3 pull-sync         | `app/services/sync.py`, `POST /api/v1/amo/sync/run` |
| 4.4 маппинг статусов  | `app/services/webhook_processor.py::apply_action`, ключ `amo_status_map` |
| 5. метрики эффективности | `app/services/metrics.py`, эндпоинты `/api/v1/metrics/*` |
| 5.2 первоначальный дедлайн | `app/services/task_processor.py::apply_task_fact` |
| 5.2 tracked_task_types | ключ `settings.tracked_task_types` |
| 6. UI (3 кабинета)    | `web/` (vanilla JS SPA, mount в `app/main.py`) |
| 6.3 XLSX-экспорт      | `app/services/exports.py`, `GET /api/v1/payments/export.xlsx` |
| 9.2 алерты            | `app/services/alerts.py`, `GET /api/v1/alerts/*` |
| 2.2 бэкапы            | `scripts/backup-db.sh`, `scripts/restore-db.sh`, `scripts/cron-backup.example` |
| Журнал + переобработка | `app/api/v1/endpoints/webhook_log.py` |
| Настройки админки     | `app/api/v1/endpoints/settings.py` |
| 7. REST API           | `app/api/v1/router.py` (всё под `/api/v1/`) |
| 9.1 шифрование        | Fernet, `TOKEN_ENCRYPTION_KEY` |
| 9.1 аудит выплат      | `payment_audit` + запись в `payments.py::update_payment` |

Открытые вопросы из раздела 11 ТЗ закрыты в [`DECISIONS.md`](./DECISIONS.md).
