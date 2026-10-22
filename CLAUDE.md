# Basa Finance — правила проекта

Сервис учёта финансов команды. Код — `finance-app/` (Next.js 14 App Router + TypeScript +
Tailwind, Supabase Postgres/Auth/RLS, хостинг Vercel). Папка `server/` — **другой продукт**
(PHP), её не трогать. Язык общения с владельцем — русский, простыми словами.

Команда агентов: `/basa-lead` (оркестратор) и специалисты в `.claude/agents/basa-*.md`.

## База знаний (основное место правил и знаний)

Локальное хранилище KO: `~/Documents/KO-Agency-Knowledge` (свои правила —
`00_system/assistant_rules.md`, стандарт — `00_system/knowledge_standard.md`).
Раздел Basa — `01_company/tech/basa_finance/`: правила разработки `dev_rules.md` (STD-BASA-001,
**основное место правил; этот CLAUDE.md — рабочая копия, при расхождении верна база**),
устройство `system.md`, решения `decision_log.md`, состояние `current_state.md`, вопросы
`open_questions.md`. Читать в начале задачи; записывать итог через агента `basa-knowledge-keeper`.
Правки данных Basa, которые делает помощник хранилища (исключение EX-01, партии разнесения
операций), — журнал `00_system/integrations/basa_sync_log.md`: смотреть его первым, когда в
production появились «необъяснимые» изменения.

## Окружения

| Что | Значение |
|---|---|
| Production БД | Supabase `basa-finance`, ref `kmvsjozxjosmkhvphzdz`, Postgres 17, **Free: нет бэкапов и PITR** |
| Пулер для pg_dump/psql | `aws-1-eu-central-1.pooler.supabase.com:5432` (Session pooler; не aws-0, не 6543) |
| Production сайт | Vercel `basa-16bf` (`prj_zTKK4bugvnR8HQYmMt1xjTLirv9g`, team `team_gnmhQvHvDRJ7eLwsBWtW66yV`), https://basefinance.pro |
| Деплой | push в `main` → автодеплой Vercel. Логи рантайма на Hobby хранятся 1 час |
| Сеть владельца | через VPN, соединения к пулеру рвутся — скрипты обязаны повторять запросы |

## Жёсткие правила (нарушение = остановиться и спросить)

1. **Любое изменение production — только после явного «да» владельца в чате на это конкретное
   действие**: DDL/DML в БД, `apply_migration`, merge/push в `main`, деплой, pg_cron, Vault,
   переменные Vercel. Разрешение на одно действие не распространяется на следующее.
   Чтение (`SELECT`) — можно без спроса.
2. **Секреты.** Не читать и не выводить содержимое Vault, `cron.job.command`, `CRON_SECRET`,
   токены, пароли. Не вводить пароли и ключи ни в какие поля. Пароль БД вводит владелец сам —
   во вкладке терминала (`read -rs`), не в строке чата: строка чата не интерактивна.
3. **Любое необъяснимое изменение финансовых показателей = STOP**, сначала объяснить
   конкретными строками (`created_at`, `created_by`, источник).
4. Не трогать без решения владельца: `opening_balance`, FX, историю миграций, архивные
   таблицы `fin03_*`, `recon0095_*`.
5. Не удалять файлы бэкапов/ключей (`*.dump.age`, `~/basa-backup-age-key.txt`) без явной просьбы;
   никогда не удалять единственную проверенную копию.

## Данные и деньги

- Суммы — `bigint` в минорных единицах (копейки/центы). Валюта у каждого счёта своя.
- Перевод между своими счетами — **одна** строка `type='transfer'`: `account_id` — списание,
  `transfer_account_id` — зачисление (`coalesce(transfer_amount, amount)`).
- Остаток счёта = `opening_balance` + actual income − expense − transfer-out + transfer-in.
- Банковские строки: `origin='bank'`, `bank_event_id` = provider:account:tx_id (уникален в команде).
  Банковские строки **не удалять** — следующий синк вернёт их. Дубли снимаются с CSV/ручной стороны.
- Весь банковский/CSV-импорт идёт через RPC `bank_import_commit`; Bybit — `bybit_ingest`
  (идентичность проставляет триггер `transactions_bank_identity`).
- Управленческая аналитика — представление `transaction_lines` (части операции вместо операции).

## Миграции (supabase/migrations)

- Файл `NNNN_snake_name.sql` + откат `rollback/NNNN_down.sql`. Следующий номер — после последнего.
- **pg_safeupdate**: роль `authenticator` грузит safeupdate — каждый `UPDATE`/`DELETE` (и внутри
  функций, и по временным таблицам) обязан иметь `WHERE`. Локальный Postgres этого не ловит.
- Новые функции в `public` по умолчанию получают EXECUTE у `anon`/`PUBLIC`. Всегда:
  `revoke all ... from public, anon`, затем явный `grant execute ... to authenticated, service_role`
  (внутренние — только `service_role`). SECURITY DEFINER: `set search_path = public` и проверка
  прав через `coalesce(public.can_edit_finance(team), false)`.
- Новые таблицы: `enable row level security` + политики; служебные/архивные — RLS без политик
  и `revoke all from anon, authenticated, public`.
- Порядок применения в production: (1) свежий зашифрованный бэкап; (2) **репетиция на production**:
  весь скрипт + проверки в одном запросе, который заканчивается `raise exception 'REHEARSAL OK …'`
  (всё откатывается), затем проверить, что откат чистый; (3) «да» владельца; (4) `apply_migration`
  с `name` = имя файла без `.sql`; (5) md5 текста в `supabase_migrations.schema_migrations`
  = `md5 -q` файла; (6) сверка показателей и integrity audit.
- Финансовые показатели для сверки до/после и integrity audit: `finance-app/scripts/backup/backup_and_verify.sh`
  (`EXPECT_SQL`) и `finance-app/scripts/db_integrity_audit.sql`. Известный FAIL: `dup auto accrual = 1`.

## Бэкапы

- `bash finance-app/scripts/backup/backup_and_verify.sh` — полный бэкап + restore-проверка (нужен
  PostgreSQL 17 клиент, пароль вводит владелец). Дамп сразу шифровать: `age -r <pubkey из
  ~/basa-backup-age-key.txt>`; открытые дампы и `verifydb/` после проверки удалять.
- Локальный Postgres на macOS запускать с `LC_ALL=en_US.UTF-8`.

## Разработка и проверка

- Ветка на задачу, PR в `main`. Коммиты с атрибуцией из системных напоминаний.
- Перед «готово»: `cd finance-app && npm test && npx tsc --noEmit && npm run build`; UI — проверить
  в браузере; данные — SELECT-сверка. Никогда не отмечать задачу выполненной без доказательства.
- Уроки прошлых ошибок — `finance-app/tasks/lessons.md` (читать перед работой, дополнять после
  каждой правки от владельца). План текущей задачи — `finance-app/tasks/todo.md`.
- Ключевые документы: `finance-app/ARCHITECTURE_MAP.md`, `ROLE_PERMISSION_MATRIX.md`,
  `REMEDIATION_PLAN.md`, `FIN03_FORENSICS.md`, `PRODUCTION_DEPLOY_RUNBOOK.md`, `BACKUP_RUNBOOK_MACOS.md`.
