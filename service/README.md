# Basa — сервис учёта проектов и выплат

Бэкенд по ТЗ v1.0: FastAPI + PostgreSQL + Redis + интеграция с AmoCRM (OAuth, REST,
pull-синхронизация, приём вебхуков). Зеркало ответов на открытые вопросы из ТЗ — в
[`DECISIONS.md`](./DECISIONS.md).

> **Статус:** Фаза 1 (MVP) — модели, миграции, JWT-роли, CRUD по аналитикам/проектам/
> выплатам, OAuth-обмен токенами с AmoCRM, ручной запуск pull-синхронизации сделок,
> приём и логирование вебхуков с идемпотентностью. Воркер-обработка вебхуков и метрики
> по задачам — Фаза 2/3.

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

Хранится в таблице `settings` под ключом `amo_status_map`:

```json
{
  "12345": "in_progress",
  "12346": "done",
  "12347": "paid",
  "12348": "cancelled"
}
```

Ключи — `amo_status_id` из воронки, значения — допустимые статусы проекта.
В админке (Фаза 2) появится UI для редактирования.

## Тесты

```bash
pip install -e ".[dev]"
pytest -q
```

Тесты на DB-стороне (CRUD) рекомендуется гонять против реального PostgreSQL — поднимите
`docker compose up -d db` и поставьте `DATABASE_URL=postgresql+psycopg://basa:...@localhost:5432/basa`.

## Что ещё не сделано (по фазам ТЗ)

- **Фаза 2:** воркер RQ для обработки `amo_webhook_log`, автосоздание проектов/выплат
  по статусам сделок, журнал в админке с переобработкой, проверка подписи/IP-листа
  AmoCRM на вебхуках.
- **Фаза 3:** модель `amo_tasks` уже есть; нужны вебхуки задач, расчёт метрик и
  экраны эффективности.
- **Фаза 4:** SPA-фронтенд (личный кабинет аналитика, админка, кабинет бухгалтера),
  XLSX-экспорт, алерты, бэкапы.

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
| 4.2 webhooks          | `app/api/v1/endpoints/amo.py::amo_webhook` |
| 4.3 pull-sync         | `app/services/sync.py`, `POST /api/v1/amo/sync/run` |
| 7. REST API           | `app/api/v1/router.py` (всё под `/api/v1/`) |
| 9.1 шифрование        | Fernet, `TOKEN_ENCRYPTION_KEY` |
| 9.1 аудит выплат      | `payment_audit` + запись в `payments.py::update_payment` |

Открытые вопросы из раздела 11 ТЗ закрыты в [`DECISIONS.md`](./DECISIONS.md).
