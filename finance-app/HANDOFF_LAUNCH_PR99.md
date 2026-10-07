# Задача: довести запуск PR #99 (Basa Finance) до рабочего состояния в production

Ты получаешь работу на последнем этапе. Код готов и проверен, не хватает запуска.
Работай строго по шагам, на каждой СТОП-точке отчитывайся пользователю и жди
подтверждения. Не расширяй задачу.

## Контекст

| Что | Значение |
|---|---|
| Репозиторий | `github.com/dmitriykononenko-lang/Basa`, приложение в `finance-app/` (Next.js + Supabase) |
| PR | **#99**, ветка `claude/intelligent-ramanujan-Jdbbu`, HEAD **`3e74f3e`**, база `main` (`c5d75d9`) |
| Production | Vercel `basa-16bf` (`prj_zTKK4bugvnR8HQYmMt1xjTLirv9g`, team `team_gnmhQvHvDRJ7eLwsBWtW66yV`), домен **https://basefinance.pro** |
| Текущий прод-деплой | `dpl_GSoPbNicTYUKDAoMdzALdw1pMCRp` из ветки `maintenance-lock` (`67e9a79`) = `main` + замок импорта |
| База | Supabase `basa-finance`, ref **`kmvsjozxjosmkhvphzdz`**, PostgreSQL 17.6, **Free plan — бэкапов и PITR нет** |
| Документы | `finance-app/REMEDIATION_PLAN.md`, `PRE_PRODUCTION_REVIEW.md`, `PRODUCTION_DEPLOY_RUNBOOK.md`, `DEPLOY_FINAL_GATE_2026-09-23.md`, `MAINTENANCE_LOCK_DEPLOYED_2026-09-24.md`, `BACKUP_RUNBOOK_MACOS.md` |

### Что уже сделано в production
- **Замок импорта**: `src/lib/maintenance.ts`, `LOCK_DEFAULT = true` (и в `maintenance-lock`, и в ветке PR #99). `/api/tochka/auto-sync`, `/api/tochka/cron`, `/api/tochka/import` отвечают **503 `locked`**. Переменную `FINANCIAL_IMPORTS_DISABLED` выставить нельзя (у интеграции Vercel 403 на production env) — замок держит код.
- **pg_cron**: `1 bybit-sync-daily` и `2 tochka-autosync` — обе `active=false` с 2026-09-23 07:24 UTC.
- **Security-hotfix'ы** применены обычным SQL (в `schema_migrations` их нет, нормализовать не нужно):
  SEC-009 — `revoke execute on public.bybit_sync_logged(integer) from anon, authenticated, public`;
  SEC-008/010 — тела `can_edit_finance/can_write_tx/can_manage_team` = ЧАСТЬ A миграции 0091, `revoke … support_open_period/support_delete_period from anon, public`.
  Файлы: `supabase/migrations/hotfix/`, откат — `supabase/migrations/rollback/SEC*_before.sql`. 0091 к ним идемпотентна (проверено).
- **Импорт банков заморожен с 2026-09-23 16:56 UTC.** Ручные правки пользователей продолжаются.

### Последний принятый baseline (2026-09-24 13:28:53 UTC)
transactions 7 970 · actual/planned 7 962/8 · import_batches 275 · obligations 190 · allocations 97 · invoices 25 · invoice_items 22 · splits 4 · FIN-03 126 · duplicate auto-accrual 1 · RUB flow −11 398 192 · USDT flow 305 451 · Σ opening_balance 61 904 483 · accounts 24 · counterparties 159.
Формулы — `scripts/backup/backup_and_verify.sh` (`EXPECT_SQL`) и `scripts/db_integrity_audit.sql`.

### Не трогать
FIN-03 cleanup (126 дублей), `opening_balance`, FX, SEC-011, нормализацию истории миграций, миграцию 0085, PHPUnit в `server/` (другой продукт).

### Жёсткие правила
- Никаких DDL/DML в production вне шагов 3 и 6. На остальных шагах — только SELECT.
- Не выводить пароли, токены, `CRON_SECRET`, содержимое `vault`, поле `cron.job.command`.
- Не вызывать `bybit_sync_logged()` / импорт Точки до шага 6.
- Не деплоить код PR #99, пока в production не применены 0086–0092: код вызывает RPC, которых без миграций нет.
- Любое необъяснимое изменение финансовых показателей = STOP.

---

## Шаг 0. Предполётная проверка (только чтение)
1. Прод-деплой всё ещё `dpl_GSoPbNicTYUKDAoMdzALdw1pMCRp` / `67e9a79`; `GET https://basefinance.pro/api/tochka/cron` → 503 `locked`; `/login` → 200.
2. pg_cron: обе задачи `active=false`, прогонов после 2026-09-23 07:24 — 0.
3. Активных backend'ов (не idle) — 0.
4. Снять **новый baseline** по 15 показателям и сравнить с принятым. Расхождения объяснить конкретными строками (`created_at`, кто/что):
   - ручная работа (контрагенты, разнесения, ручные операции) — допустима;
   - рост `import_batches` возможен только от **CSV-импорта** через мастер (`ImportWizard`/`StatementImportWizard` замком не закрыты) — показать эти батчи;
   - любые строки с `source in ('tochka','bybit')` после 2026-09-23 16:56 = инцидент, STOP.
5. Проверить ACL: `bybit_sync_logged(integer)` = `{postgres, service_role}`; `support_*` и `can_*` — без `anon`/`PUBLIC`; `can_edit_finance('00000000-0000-0000-0000-000000000001')` = `false` (не NULL).

## Шаг 1. Backup + restore verification
Запустить `finance-app/scripts/backup/backup_and_verify.sh` там, где есть клиент **PostgreSQL 17** и сетевой доступ к БД (Session pooler, порт 5432; не Transaction pooler 6543). Инструкция — `BACKUP_RUNBOOK_MACOS.md`.
```bash
export DB_URL='postgresql://postgres.kmvsjozxjosmkhvphzdz@<POOLER_HOST>:5432/postgres?sslmode=require'
read -rsp 'Пароль БД: ' PGPASSWORD && export PGPASSWORD && echo
bash scripts/backup/backup_and_verify.sh 2>&1 | tee ~/basa-verify-log.txt
```
PASS = все строки: `ошибок restore: 0`; `[restore] … расхождений: 0`; 7 миграций `ok`; `[postmig] финансовых расхождений: 0`; 8 шагов отката `ok`; `ОТКАТ ЧИСТЫЙ`; `ВСЁ ПРОШЛО УСПЕШНО`.
Зашифровать дамп (`age`), хранить вне Git, записать `sha256` и время снятия.

**⛔ СТОП G1.** Отчёт: метаданные бэкапа, итоги сверок, тайминги миграций на копии. Ждать **Разрешения №2B**.

## Шаг 2. Окно обслуживания
Сотрудники не работают в `basefinance.pro`. Непосредственно перед 0086: повторить шаг 0 (п.3–4) — новых записей с момента бэкапа быть не должно. Если появились — бэкап снять заново.

## Шаг 3. Миграции 0086–0092 в production
Строго по порядку, каждую отдельно (через Supabase `apply_migration` с именем файла без `.sql`, чтобы попала в историю):
`0086_guard_constraints` → `0087_accrual_idempotency` → `0088_financial_rpcs` → `0089_optimistic_concurrency` → `0090_bank_event_identity` → `0091_write_paths_and_authz` → `0092_transaction_lines`.
После **каждой**: 15 финансовых показателей не изменились; ACL из шага 0 п.5 не изменился; записать время. 0090 перезаписывает `transactions` (ACCESS EXCLUSIVE, на репетиции ~0,1 с).
После всех: `scripts/db_integrity_audit.sql` — 24 PASS + ровно 2 известных FAIL (FIN-03 = 126, dup auto-accrual = 1).
Откат при сбое: `supabase/migrations/rollback/` в обратном порядке `0092_down … 0086_down`, перед `0087_down` — `0087_functions_before.sql`. Если откат не возвращает baseline — восстановление из дампа шага 1.

**⛔ СТОП G2.** Отчёт: тайминги, сверки после каждой миграции, integrity audit. Ждать подтверждения на деплой.

## Шаг 4. Деплой PR #99
1. Убедиться, что в ветке `src/lib/maintenance.ts` содержит `const LOCK_DEFAULT = true;`.
2. Merge PR #99 в `main` (обычный merge, без squash истории не требуется).
3. Дождаться production-деплоя Vercel из `main`; проверить, что alias `basefinance.pro` указывает на новый деплой с SHA merge-коммита.
4. `/login` → 200, `/api/tochka/cron` → **503 locked** (замок обязан пережить деплой).
Откат: Vercel → instant rollback на `dpl_GSoPbNicTYUKDAoMdzALdw1pMCRp` (код старый, но миграции обратно совместимы на чтение; при проблемах записи — откат миграций по шагу 3).

## Шаг 5. Smoke и integrity после деплоя
Под учётной записью с правами finance (получить у пользователя; изменения делать в тестовой команде либо обратимо):
- вход, дашборд, список операций;
- правка операции (оптимистичная блокировка: две вкладки → вторая получает конфликт, а не затирает);
- разнесение операции на 2 части (сумма не удваивается; проект/сотрудник видят свою часть);
- сохранение инвойса (amount = Σ позиций), разнесение оплаты по обязательству (без переплаты);
- `/payroll` — открытие страницы ничего не начисляет, кнопка «начислить» идемпотентна;
- отчёты P&L / ДДС / карточки проекта и сотрудника (SPLIT-01);
- Vercel runtime errors за час после деплоя — 0 новых;
- integrity audit и 15 показателей — без необъяснимых изменений.

## Шаг 6. Первый контролируемый синк и снятие замка
**⛔ СТОП G3** перед началом — подтверждение пользователя.
Пауза импорта длится с 23.09, а окна у авто-заданий короче: авто-синк Точки — 10 дней, задача Bybit — 7. Поэтому первый прогон — с расширенным окном:
1. Коммит в `main`: `LOCK_DEFAULT = false` → деплой → `/api/tochka/cron` больше не 503.
2. **Точка**: ручной импорт в UI («Настройки → Банк») за период **2026-09-23 → сегодня** по каждому счёту, либо дождаться Vercel cron 05:00 UTC (окно 45 дней).
3. **Bybit**: один раз от `postgres`: `select public.bybit_sync_logged(30);` → проверить `bybit_sync_log` (ok) и новые строки `source='bybit'`.
4. Проверки после синка: дублей по `(team_id, source, external_id)` = 0; **FIN-03 остаётся 126** (новые переводы схлопываются по `bank_event_id`); разобрать `bank_reconciliation_conflicts`; рост `transactions`/`import_batches` объясняется только банковскими операциями периода.
5. Включить `cron.alter_job(job_id := 1, active := true)` (Bybit).
   `tochka-autosync` (job 2) **не включать**: в `command` лежит устаревший `CRON_SECRET` открытым текстом (OPS-01); Точку покрывает Vercel cron. Включать только после ротации секрета и переноса в vault.

## Шаг 7. Наблюдение 24 часа
Vercel runtime errors, рост `import_batches`, `bybit_sync_log`, `bank_reconciliation_conflicts`, integrity audit через 24 ч. Нет новых HIGH/CRITICAL → PR #99 закрыт.

## Итоговый отчёт
- что сделано на каждом шаге и где были стоп-точки;
- baseline до/после миграций, после деплоя, после синка — с объяснением каждой дельты;
- адрес сервиса, SHA прод-деплоя, статус замка и pg_cron;
- что осталось (FX, FIN-03 cleanup, SEC-011, OPS-01/02, PHPUnit в `server/`).
