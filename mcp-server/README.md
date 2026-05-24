# AmoCRM MCP Server

Удалённый MCP-сервер, дающий Claude (Desktop, Code, claude.ai) доступ к данным
и операциям в AmoCRM через тот же OAuth-канал, что и виджет
«Распределение сделок».

## Архитектура

```
┌──────────────┐    OAuth handshake     ┌──────────────────┐
│   AmoCRM     │ ─────────────────────► │  PHP backend     │
│  (browser)   │                        │  /oauth/callback │
└──────────────┘                        └────────┬─────────┘
                                                 │ writes
                                                 ▼
                                       ┌───────────────────┐
                                       │  STORAGE_PATH/    │
                                       │   tokens/*.json   │
                                       └────────┬──────────┘
                                                │ reads + refreshes
                                                ▼
┌──────────────┐    HTTP + Bearer       ┌──────────────────┐
│ Claude (any) │ ─────────────────────► │  MCP server      │ ──► AmoCRM REST v4
│              │  /mcp                  │  (this project)  │
└──────────────┘                        └──────────────────┘
```

OAuth по-прежнему обрабатывает PHP-бэкенд (`/oauth/callback`) — он
записывает access/refresh-токены в `STORAGE_PATH/tokens/{accountId}.json`.
MCP-сервер читает эти же файлы и сам делает refresh при истечении.

## Установка

Требуется Node.js 18.17+ (для глобального `fetch`).

```bash
cd mcp-server
npm install
cp .env.example .env
# заполнить переменные (см. ниже)
npm run build
npm start
```

Для разработки: `npm run dev` (tsx watch).

### Переменные окружения

| Variable | Описание |
|---|---|
| `PORT` | Порт HTTP-сервера (по умолчанию `3001`) |
| `HOST` | Bind-адрес (по умолчанию `0.0.0.0`) |
| `STORAGE_PATH` | Тот же путь, что в `server/.env` PHP-бэкенда |
| `AMO_CLIENT_ID` / `AMO_CLIENT_SECRET` / `AMO_REDIRECT_URI` | Те же креды OAuth-интеграции AmoCRM |
| `DEFAULT_ACCOUNT_ID` | AmoCRM `account_id`, который подставляется, если в инструменте не передан `account_id` |
| `MCP_AUTH_TOKEN` | Bearer-токен для защиты `/mcp`. Сгенерировать: `openssl rand -hex 32` |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error` |

## Подключение к Claude

### Claude Desktop / Code

В `~/.config/claude/claude_desktop_config.json` (Linux/macOS) добавить:

```json
{
  "mcpServers": {
    "amocrm": {
      "url": "https://dist.koagency.me/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_AUTH_TOKEN>"
      }
    }
  }
}
```

Для Claude Desktop без поддержки нативного HTTP MCP — использовать `mcp-remote`:

```json
{
  "mcpServers": {
    "amocrm": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://dist.koagency.me/mcp",
        "--header",
        "Authorization: Bearer <MCP_AUTH_TOKEN>"
      ]
    }
  }
}
```

### nginx (рядом с PHP-бэкендом)

```nginx
location /mcp {
    proxy_pass http://127.0.0.1:3001/mcp;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 300s;
    proxy_buffering off;          # важно для streaming-ответов
}
```

### systemd

```ini
[Unit]
Description=AmoCRM MCP Server
After=network.target

[Service]
WorkingDirectory=/opt/amocrm-mcp
EnvironmentFile=/opt/amocrm-mcp/.env
ExecStart=/usr/bin/node dist/server.js
Restart=always
User=www-data

[Install]
WantedBy=multi-user.target
```

## Доступные инструменты

| Tool | Описание |
|---|---|
| `amocrm_account_info` | Информация об аккаунте |
| `amocrm_get_lead` | Получить сделку по id |
| `amocrm_list_leads` | Поиск/фильтрация сделок |
| `amocrm_create_lead` | Создать сделки |
| `amocrm_update_lead` | Обновить произвольные поля |
| `amocrm_update_lead_responsible` | Сменить ответственного |
| `amocrm_update_lead_status` | Перевести сделку на этап / в воронку |
| `amocrm_get_contact` / `amocrm_search_contacts` / `amocrm_create_contact` / `amocrm_update_contact` | Контакты |
| `amocrm_get_company` / `amocrm_list_companies` / `amocrm_create_company` / `amocrm_update_company` | Компании |
| `amocrm_list_users` / `amocrm_get_user` | Менеджеры |
| `amocrm_list_pipelines` / `amocrm_get_pipeline` / `amocrm_list_pipeline_statuses` | Воронки и этапы |
| `amocrm_add_note` / `amocrm_list_notes` | Заметки на сущностях |
| `amocrm_create_task` / `amocrm_list_tasks` / `amocrm_complete_task` | Задачи |

Каждый инструмент принимает опциональный `account_id`. Если не передан,
берётся `DEFAULT_ACCOUNT_ID`.

## Тесты

```bash
npm test
```

## Безопасность

- `/mcp` защищён Bearer-токеном; запросы без корректного `Authorization` получают 401.
- Сравнение токена — `timingSafeEqual`.
- Файлы токенов пишутся с `0600`, имена `accountId` санитизируются от `..`.
- Не используйте этот сервер на внутренней доверенной сети — всегда выставляйте через HTTPS.
