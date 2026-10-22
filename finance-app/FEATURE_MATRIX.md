# FEATURE_MATRIX.md — Basa (finance-app)

Дата 2026-09-19. Составлено из исходников (`src/app/**`, `src/components/**`), живой схемы БД и read-only запросов к production (`kmvsjozxjosmkhvphzdz`).

**Как читать статус.** Статус относится только к тому, что реально проверено:
- **CODE** — путь данных прочитан в коде (UI → запрос → таблица). Это *не* доказательство работоспособности.
- **DATA** — подтверждено запросом к production (строки есть, инварианты держатся).
- **TEST** — подтверждено исполняемым тестом (локальный Postgres 16, `scripts/concurrency_test.sh`).
- **NOT TESTED** — не проверялось (нет UI-сессии / нет доступа к внешнему API).

**Браузерного E2E не проводилось**: у аудита нет учётных данных пользователя приложения, а активное тестирование на production запрещено условиями аудита. Всё «работает» ниже означает «путь данных прослежен и данные в БД консистентны», а не «нажато в интерфейсе».

## 1. Разделы приложения (57 страниц)

| Раздел | Страницы | Пишет в | Статус | Чем подтверждено |
|---|---|---|---|---|
| Дашборд | `(app)/dashboard` | — (чтение) | CODE+DATA | агрегаты из `transactions`, `account_balances` |
| Операции | `transactions`, `/sort`, `/categorize`, `/import` | `transactions`, `transaction_splits`, `import_batches`, `attachments` | CODE+DATA | 7 930 строк; инварианты сумм 0 нарушений |
| Счета | `accounts` | `accounts` | CODE+DATA | 24 счёта; баланс = `opening_balance + Σ actual` (пересчитан вручную) |
| Статьи | `categories` | `categories` | CODE+DATA | дубликатов (team,name,kind) = 0 |
| Контрагенты | `counterparties`, `counterparties/[id]` | `counterparties` | CODE+DATA | дубликатов по (team,name) и (team,ИНН) = 0; merge через RPC `merge_counterparties` |
| Проекты | `projects`, `projects/[id]` | `projects`, `project_periods`, `project_bonus_tiers` | CODE+DATA | бонусы считает триггер `trg_project_bonus` → `accrue_project_bonus` |
| Счета на оплату (инвойсы) | `invoices` | `invoices`, `invoice_items`, `invoice_documents` | **PARTIAL** | 25 инвойсов; `amount = Σ items` для всех, у кого есть позиции; **10 инвойсов без позиций**; запись не атомарна (CONC-01) |
| Обязательства / Долги | `debts` | `obligations`, `obligation_payments` | **PARTIAL** | переплат 0, `outstanding = amount − paid` — 0 нарушений; но разнесение платежей не защищено от гонок (CONC-03) |
| Зарплата | `payroll` | `obligations` (через RPC `materialize_auto_accruals`, `materialize_support_cycles`) | **PARTIAL** | RPC **пишет при GET-рендере страницы** и не защищён уникальным индексом (CONC-05) |
| Сотрудники | `employees`, `employees/[id]` | `counterparties`, `employee_salaries`, `employee_positions` | CODE+DATA | — |
| Агенты | `agents`, `agents/[id]/report` | `agent_commission_rules` → триггер `accrue_agent_commission` | CODE+DATA | комиссия считается в БД атомарным upsert (`on conflict (source_transaction_id)`) — безопасно |
| Бюджеты | `budgets` | `budgets` | CODE | — |
| Регулярные операции | `recurring` | `recurring_rules` → cron `/api/cron/recurring` | CODE | фактических прогонов в логе не проверено |
| Календарь | `calendar` | чтение `transactions`/`obligations` | CODE | — |
| Лицензии | `licenses` | `license_deals/items/purchases/payments` | CODE | — |
| Отчёты | `reports`, `/cashflow`, `/pnl`, `/team`, `/academy` | — (чтение) | **PARTIAL** | считаются на лету; курс валют берётся **последний известный, а не на дату операции** (FIN-02) |
| Метрики (KPI) | `metrics`, `metrics/[id]`, `/dynamics` | `metrics`, `metric_values` | CODE | — |
| База знаний | `knowledge-base/**`, `/departments` | `kb_articles`, `kb_departments`, `kb_quiz*` | CODE | медиа в **публичном** бакете `kb-media` (SEC-002) |
| Академия | `academy/**`, `reports/academy` | `academy_courses/items/assignments/progress` | CODE | прохождение через RPC `academy_complete_item` |
| Оценки (ассессмент) | `assess`, `assess/[id]`, `t/[token]` | `assessments`, `assess_scores/answers` | CODE | публичная ссылка по неугадываемому `share_token` |
| Сейф паролей | `vault` | `vault_entries`, `vault_grants`, `vault_access_log` | CODE+DATA | AES-256-GCM, раскрытие через `vault_can_reveal` + аудит-лог |
| Команда | `team`, `team/[userId]`, `join` | `team_members`, `invites` | CODE+DATA | приём инвайта — атомарный RPC `accept_invite` (upsert) — безопасно |
| Уведомления | `notifications` | `notifications`, `notification_prefs` ← cron | CODE | — |
| Профиль | `profile` | `profiles`, `telegram_codes` | CODE | — |
| Настройки | `settings`, `/bank`, `/company`, `/motivation`, `/obsidian`, `/rules`, `/visibility` | `bank_connections`, `teams`, `scope_templates`, `member_visibility`, `obsidian_connection` | CODE | токен Точки шифруется `TOCHKA_TOKEN_KEY` |
| ОС / Оргструктура | `os` | `kb_departments` | CODE | — |
| Telegram Mini App | `tg/learning` + `/api/tg/**` | академия/прогресс | CODE | подпись `initData` проверяется по HMAC |

## 2. Интеграции

| Интеграция | Направление | Статус | Замечание |
|---|---|---|---|
| Точка Банк (выписка) | pull: cron 05:00, pg_cron /3ч, авто-синк при открытии | **PARTIAL** | дедуп по уникальному индексу работает; но параллельный запуск двух импортов **аварийно завершает весь батч** (CONC-04, доказано тестом) |
| Bybit | импорт CSV | CODE+DATA | API нет; дублей по `external_id` 0 |
| ЦБ РФ (курсы) | pull | CODE | курс в `fx_rates` **один на валюту, без истории** (FIN-02) |
| Telegram | Mini App + бот-ссылка | CODE | HMAC + одноразовый код (TTL 15 мин) |
| Obsidian | pull/push по bearer-токену | CODE | токен без срока и без rate-limit |
| Email (Resend / Supabase) | out | NOT TESTED | отправка не проверялась |
| Loom | видео в БЗ | CODE | — |

## 3. Мёртвый и дублирующийся код

| Что | Где | Замечание |
|---|---|---|
| `ArchiveAccountButton`, `ArchiveCategoryButton`, `DashboardCharts`, `EditAccountForm`, `TrendChart`, `Placeholder`, `ui/typography` | `src/components/**` | не импортируются ни одной страницей |
| Два мастера импорта | `StatementImportWizard.tsx` и `ImportWizard.tsx` | сосуществуют; расходятся в логике сверки |
| `missingRates()` | `src/lib/fx.ts:30` | экспортируется, **не вызывается нигде** — предупреждение о неизвестном курсе никогда не показывается (см. FIN-01) |

## 4. Автотесты

**В репозитории нет ни одного автотеста** (`*.test.ts*` — 0 файлов, тест-раннер в `package.json` отсутствует). Единственный исполняемый тест, появившийся в ходе аудита, — `scripts/concurrency_test.sh` (локальный, не трогает production).
