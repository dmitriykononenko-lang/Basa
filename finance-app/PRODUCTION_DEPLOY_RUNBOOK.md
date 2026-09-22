# PRODUCTION_DEPLOY_RUNBOOK.md — применение PR #99 к production

Дата 2026-09-22. **Ничего из этого ещё не выполнялось.** Runbook применяется
только после отдельного подтверждения владельца. Обоснование каждого шага и
результаты проверок — в `PRE_PRODUCTION_REVIEW.md`.

* Проект: Supabase `kmvsjozxjosmkhvphzdz`, приложение Vercel `basa-16bf` → basefinance.pro
* Миграции: `0086_guard_constraints` → `0087_accrual_idempotency` →
  `0088_financial_rpcs` → `0089_optimistic_concurrency` →
  `0090_bank_event_identity` → `0091_write_paths_and_authz`
* **Порядок обязателен: сначала БД, потом код.** Новый код вызывает RPC из
  0088–0091 и читает `transactions.version`.

## Ожидаемое окно обслуживания

| Этап | Оценка | Пользователи |
|---|---|---|
| PRECHECK | 10–15 мин | работают |
| Отключение cron/синка | 2 мин | работают |
| Бэкап / PITR-точка | 2–5 мин | работают |
| **Миграции 0086–0091** | **< 1 мин** (репетиция: 0,7 с на объёме прода) | **запись недоступна ~10–20 с** на время перезаписи `transactions` |
| Верификация БД | 5 мин | работают (старый код) |
| Деплой приложения | 3–6 мин (сборка Vercel) | короткая смена версии |
| Smoke-тесты | 10–15 мин | работают |
| Включение cron + пост-аудит | 10 мин | работают |
| **Итого** | **45–60 мин**, из них недоступность записи — **менее минуты** | |

Рекомендуемое время: вне рабочих часов команды, **не** в 05:00–08:00 UTC
(окна Vercel-cron) и не ближе 10 минут к очередному запуску pg_cron
`tochka-autosync` (каждые 3 часа).

---

## 1. PRECHECK (без изменений в production)

- [ ] `git log --oneline origin/main..claude/intelligent-ramanujan-Jdbbu` — в ветке ровно ожидаемые коммиты; PR #99 одобрен.
- [ ] `cd finance-app && bash scripts/concurrency/run.sh` → `MODE=post: PASS=14 FAIL=0`.
- [ ] `MODE=post bash scripts/concurrency/authz_test.sh` → `PASS=21 FAIL=0`.
- [ ] `MODE=post bash scripts/concurrency/split_test.sh` → `PASS=23 FAIL=0`.
- [ ] `bash scripts/concurrency/rehearsal.sh` → все миграции применились, регрессия и авторизация зелёные.
- [ ] `npx tsc --noEmit` и `npx next build` — без ошибок.
- [ ] **Базовая линия целостности:** прогнать `scripts/db_integrity_audit.sql` на проде, сохранить вывод. Ожидается 24 PASS + 2 известных FAIL (FIN-03 = 126, дубль авто-начисления = 1, объяснён в `FIN03_FORENSICS.md`).
- [ ] Сохранить контрольные цифры «до»:
  ```sql
  select count(*) from transactions;                                      -- ожидается ~7 940
  select sum(balance) from account_balances;                              -- под сессией участника команды
  select count(*) from obligations; select count(*) from invoices;
  ```
- [ ] **Обязательно для откатa 0087** — сохранить прежние тела функций:
  ```sql
  select pg_get_functiondef('public.materialize_auto_accruals(uuid)'::regprocedure);
  select pg_get_functiondef('public.materialize_support_cycles(uuid)'::regprocedure);
  ```
  Положить вывод рядом с `supabase/migrations/rollback/`.
- [ ] Зафиксировать текущие значения `accounts.opening_balance` (они участвуют в теме FIN-03 и в этом деплое **не меняются**):
  ```sql
  select id, name, opening_balance from accounts order by name;
  ```
- [ ] Проверить, что никто не запускает импорт вручную (предупредить команду).

## 2. Отключить cron и синхронизацию

- [ ] pg_cron: `select cron.unschedule('tochka-autosync');` (или `update cron.job set active=false where jobname='tochka-autosync';`) — зафиксировать прежнее расписание.
- [ ] Vercel: снять расписания из `vercel.json` **или** временно убрать переменную `CRON_SECRET` (при её отсутствии cron-роуты возвращают no-op). Второй способ быстрее и обратим.
- [ ] Убедиться, что активных импортов нет:
  ```sql
  select team_id, provider, last_synced_at from bank_connections;
  select max(created_at) from import_batches;
  ```

## 3. Бэкап / точка восстановления

- [ ] Создать PITR-точку Supabase (или дождаться завершения штатного бэкапа) и **записать метку времени**.
- [ ] Выгрузить страховочные срезы:
  ```sql
  \copy (select * from public.transactions)  to 'pre_deploy_transactions.csv' csv header
  \copy (select * from public.obligations)   to 'pre_deploy_obligations.csv'  csv header
  ```
- [ ] Убедиться, что файлы непустые и сохранены вне контейнера деплоя.

## 4. Применить миграции

Применять по одной, проверяя результат. Каждая миграция идемпотентна
(`if not exists` / `exception when duplicate_*`), повторный запуск безопасен.

- [ ] `0086_guard_constraints` — ожидание: без ошибок. Проверка: индекс и триггеры на месте
  ```sql
  select indexname from pg_indexes where indexname='invoices_team_number_uniq';
  select tgname from pg_trigger where tgname in
    ('invoice_items_recalc','invoice_items_total_ck','invoices_total_ck',
     'transaction_splits_total_ck','obligation_payments_cap_ck');
  ```
- [ ] `0087_accrual_idempotency` — проверка backfill:
  ```sql
  select origin, count(*) from obligations group by origin;   -- ожидается system≈134, manual≈53, auto≈2
  select indexname from pg_indexes where indexname='obligations_auto_accrual_uniq';
  ```
- [ ] `0088_financial_rpcs` — проверка:
  ```sql
  select proname from pg_proc where proname in
   ('invoice_save','obligation_allocate','transaction_split','transactions_merge_transfer',
    'transaction_match_planned','next_invoice_number','can_modify_tx','op_begin','op_finish');
  select has_function_privilege('authenticated','public.op_begin(uuid,uuid,text)','execute'); -- ожидается false
  ```
- [ ] `0089_optimistic_concurrency` — проверка: `select count(*) from transactions where version is null;` → 0.
- [ ] `0090_bank_event_identity` — **здесь перезапись `transactions`**. Ожидание: < 20 с на текущем объёме.
  ```sql
  select count(*) from transactions where bank_event_id is not null;   -- ожидается ~4 700
  select origin, count(*) from transactions group by origin;
  select count(*) from transactions;                                   -- должно совпасть с «до»
  ```
- [ ] `0091_write_paths_and_authz` — проверка исправления SEC-008:
  ```sql
  select public.can_edit_finance('00000000-0000-0000-0000-000000000000') is not null;  -- true (больше не NULL)
  select has_function_privilege('anon','public.support_open_period(uuid,bigint,uuid,uuid)','execute'); -- false
  select indexname from pg_indexes where indexname in
    ('transactions_recurring_slot_uniq','project_periods_project_month_uniq');
  ```

## 5. Верификация БД (до деплоя кода)

- [ ] `scripts/db_integrity_audit.sql` — сравнить с базовой линией: **новых FAIL быть не должно**; FIN-03 по-прежнему 126.
- [ ] Число операций и суммы совпадают с «до»:
  ```sql
  select count(*) from transactions;   -- как в §1
  select count(*) from obligations; select count(*) from invoices;
  ```
- [ ] `select * from bank_reconciliation_conflicts;` — пусто (импортов ещё не было).
- [ ] Старый код (текущий деплой) продолжает работать: открыть `/transactions`, `/payroll`, `/invoices` — страницы отдаются, ошибок в Vercel-логах нет. Это подтверждает обратную совместимость схемы.

## 6. Деплой приложения

- [ ] Смерджить PR #99 в `main` → Vercel собирает и публикует.
- [ ] Дождаться `Ready`, проверить, что деплой действительно новый (хеш коммита).
- [ ] Логи Vercel: нет `function ... does not exist`, нет `column ... does not exist`.

## 7. Smoke-тесты (production, минимально инвазивно)

Выполнять под учётной записью с ролью owner/admin. Все создаваемые объекты —
тестовые, с пометкой «SMOKE», удаляются в конце.

- [ ] **T1:** открыть `/payroll` дважды в двух вкладках → в БД не появилось новых начислений (`select count(*) from obligations where origin='auto'` не изменился). Нажать «Обновить начисления» → счёт увеличивается один раз, повторное нажатие — «Всё уже начислено».
- [ ] **T2/T3/T5:** создать инвойс с двумя позициями → `amount` = Σ позиций, номер выдан по порядку. Сохранить ещё раз — номер не дублируется.
- [ ] **T8:** открыть одну операцию в двух вкладках, сохранить в первой, затем во второй → вторая показывает «Операцию изменил другой пользователь» и кнопку «Перечитать актуальную запись».
- [ ] **Split (бизнес-требование):** взять тестовую операцию, разнести 60/40 на два проекта → ОПиУ и ДДС показывают исходную сумму один раз, разбивка по проектам верна; поменять на 25/75 → старые значения исчезли.
- [ ] **T4:** попытаться разнести на обязательство больше остатка → отказ «Переплата».
- [ ] **T9:** разбить тестовую операцию на две части → исходная исчезла, сумма сохранилась.
- [ ] **T6/T7/FIN-03:** запустить импорт Точки вручную (`/settings/bank`) → в результате видно `imported/skipped`; запустить второй раз сразу → `imported = 0`, новых строк нет. Проверить `select count(*) from bank_reconciliation_conflicts;` — записи (если есть) осмысленны.
- [ ] Удалить тестовые объекты SMOKE.

## 8. Включить cron

- [ ] Вернуть `CRON_SECRET` / расписания `vercel.json`.
- [ ] pg_cron: вернуть `tochka-autosync` с прежним расписанием.
- [ ] Дождаться первого автоматического прогона и проверить:
  ```sql
  select created_at, detail from tochka_sync_log order by created_at desc limit 3;
  select count(*) from bank_reconciliation_conflicts where resolved_at is null;
  ```

## 9. Пост-деплойный аудит целостности

- [ ] `scripts/db_integrity_audit.sql` — сравнить с базовой линией §1.
- [ ] `scripts/fin03/forensics.sql` (только чтение) — FIN-03 по-прежнему **126**, новых пар нет.
- [ ] Контрольные суммы: число операций, сумма остатков, выручка ОПиУ за прошлый месяц — совпадают со значениями «до» (миграции финансовых полей не меняли).

## 10. Мониторинг (первые 48 часов)

| Что смотреть | Где | Норма |
|---|---|---|
| Ошибки RPC (`invoice_save`, `transaction_save`, `bank_import_commit`) | Vercel Runtime Logs | нет |
| `23505` / `23514` из новых ограничений | Vercel Logs, Supabase Logs | единичные и объяснимые (реальная попытка нарушить инвариант) |
| Конфликты версий (`conflict: true`) | поведение UI, жалобы пользователей | редкие; всплеск = проблема с передачей `version` |
| Незакрытые конфликты сверки | `select count(*) from bank_reconciliation_conflicts where resolved_at is null` | не растёт бесконтрольно |
| Результаты импорта | `tochka_sync_log` | `imported` > 0 при новых операциях, `skipped` при повторах |
| Осиротевшие батчи | `select count(*) from import_batches b where not exists(select 1 from transactions t where t.import_batch_id=b.id)` | не растёт (было 32, новых быть не должно) |
| Дубли авто-начислений | `db_integrity_audit.sql` | не растёт |
| Задвоенные переводы (FIN-03) | детектор в `db_integrity_audit.sql` | ровно 126, не растёт |

## 11. Критерии откатa

Откатывать, если выполнено **любое**:

1. `db_integrity_audit.sql` показал **новый** FAIL, которого не было в базовой линии.
2. Число операций или сумма остатков изменились не из-за действий пользователей.
3. Импорт перестал импортировать (`imported = 0` при заведомо новых операциях в банке) или создаёт дубли.
4. Сохранение операции/инвойса массово падает (не единичные конфликты версий, а отказ функции).
5. Обнаружен доступ к данным чужой команды.
6. Миграция не применилась и оставила схему в промежуточном состоянии.

### Порядок откатa

1. **Сначала приложение:** Vercel → Instant Rollback на предыдущий деплой.
   Схема 0086–0091 совместима со старым кодом, поэтому в большинстве случаев этого достаточно.
2. Проверить, что старый код работает и целостность в норме.
3. **Только если проблема в самой схеме** — откатывать миграции в обратном порядке
   `0091 → 0090 → 0089 → 0088 → 0087 → 0086` скриптами из
   `supabase/migrations/rollback/` (см. README там же; для 0087 нужен текст функций,
   сохранённый в §1).
4. Крайняя мера — PITR на метку из §3. Теряются все пользовательские изменения
   после этой метки, поэтому только если шаги 1–3 не помогли.

### Чего откат не делает

* Не восстанавливает `origin` / `bank_provider*` (они удаляются вместе с колонками) — финансовые поля при этом не затрагиваются.
* Откат 0091 возвращает SEC-008 (дыру в правах) — допустимо только как временная мера.
* Откат 0088 удаляет ключи идемпотентности: повторные отправки форм снова смогут создать дубли.
