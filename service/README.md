# Basa — сервис учёта проектов и выплат

Бэкенд по ТЗ v1.0: FastAPI + PostgreSQL + Redis + интеграция с AmoCRM (OAuth, REST,
pull-синхронизация, приём вебхуков). Зеркало ответов на открытые вопросы из ТЗ — в
[`DECISIONS.md`](./DECISIONS.md).

> **Статус:** Фазы 1–2 готовы.
>
> - **Фаза 1:** модели, миграции, JWT-роли, CRUD по аналитикам/проектам/выплатам,
>   OAuth-обмен с AmoCRM, ручной pull-сделок, приём вебхуков с идемпотентностью.
> - **Фаза 2:** воркер RQ для обработки `amo_webhook_log`, маппинг статусов в settings,
>   автосоздание проектов/выплат по статусам сделок (`start_project`, `mark_done`,
>   `mark_ready_for_payout`, `cancel`), журнал событий + ручная переобработка,
>   IP-whitelist на вебхуках. Pull и вебхуки используют общий процессор —
>   семантика одинакова, откаты статуса блокируются (Q6).
> - **Фаза 3 (задачи и метрики)** и **Фаза 4 (UI, экспорты)** — впереди.

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

1. В `.env` заполнить `AMO_CLIENT_ID`, `AMO_CLIENT_SECRET`, `AMO_REDIRECT_URI`, `AMO_BASE_URL`.
2. Под админом дёрнуть `GET /api/v1/amo/oauth/start` — браузер уйдёт в AmoCRM на согласие.
3. Amo вернётся в `GET /api/v1/amo/oauth/callback?code=...`, токены сохранятся
   зашифрованными в `settings.amo_oauth_tokens`.
4. Ручной запуск синхронизации сделок:
   ```bash
   curl -X POST http://localhost:8000/api/v1/amo/sync/run \
     -H "Authorization: Bearer $TOKEN"
   ```
   По умолчанию подтягиваются изменения за последние 24 часа.
5. Вебхуки настраиваются в AmoCRM на `POST /api/v1/amo/webhooks`. В этой версии
   вебхуки только пишутся в `amo_webhook_log` с ключом идемпотентности. Реальная
   обработка через очередь RQ — следующая фаза.

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

Тесты на DB-стороне (CRUD) рекомендуется гонять против реального PostgreSQL — поднимите
`docker compose up -d db` и поставьте `DATABASE_URL=postgresql+psycopg://basa:...@localhost:5432/basa`.

## Что ещё не сделано (по фазам ТЗ)

- **Фаза 3:** модель `amo_tasks` уже есть; нужны вебхуки задач, расчёт метрик
  (закрыто за период, % просрочек, среднее время просрочки), экраны эффективности.
- **Фаза 4:** SPA-фронтенд (личный кабинет аналитика, админка, кабинет бухгалтера),
  XLSX-экспорт, алерты при > 10 ошибок обработки за час, регламент бэкапов.
- **NFR:** rate limit на `POST /api/v1/amo/webhooks` (ТЗ 9.1) — отложен;
  при текущей предполагаемой нагрузке (~50 вебхуков/час пиково) не критично,
  заложить можно через redis-based sliding window.

## Маппинг на ТЗ

| Раздел ТЗ | Где в коде |
|---|---|
| 3.1 analysts          | `app/models/analyst.py`, миграция `202605120001` |
| 3.2 projects          | `app/models/project.py` |
| 3.3 payments          | `app/models/payment.py`, аудит в `payment_audit` |
| 3.4 amo_tasks         | `app/models/amo_task.py` (Фаза 3) |
| 3.5 amo_webhook_log   | `app/models/amo_webhook_log.py` |
| 3.6 settings          | `app/models/setting.py` |
| 4.1 OAuth + crypto    | `app/services/amo_client.py`, `app/core/crypto.py` |
| 4.2 webhooks          | `app/api/v1/endpoints/amo.py::amo_webhook` + IP-whitelist |
| 4.2 идемпотентность + очередь | `amo_webhook_log.idempotency_key` + `app/services/queue.py` + воркер `app/worker.py` |
| 4.3 pull-sync         | `app/services/sync.py`, `POST /api/v1/amo/sync/run` |
| 4.4 маппинг статусов  | `app/services/webhook_processor.py::apply_action`, ключ `amo_status_map` |
| Журнал + переобработка | `app/api/v1/endpoints/webhook_log.py` |
| Настройки админки     | `app/api/v1/endpoints/settings.py` |
| 7. REST API           | `app/api/v1/router.py` (всё под `/api/v1/`) |
| 9.1 шифрование        | Fernet, `TOKEN_ENCRYPTION_KEY` |
| 9.1 аудит выплат      | `payment_audit` + запись в `payments.py::update_payment` |

Открытые вопросы из раздела 11 ТЗ закрыты в [`DECISIONS.md`](./DECISIONS.md).
