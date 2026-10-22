# REMEDIATION_STEP0_5.md — реализация шагов 0–5 (STOP POINT)

> **Обновлено после pre-production review.** По его итогам 0090 переписана
> (collision analysis выявил сценарий silent drop), добавлена миграция 0091,
> тесты расширены до T1–T14 + авторизация + разнесение операции. Актуальные
> статусы, GO/NO-GO и остаточные риски — в **`PRE_PRODUCTION_REVIEW.md`**,
> порядок применения — в **`PRODUCTION_DEPLOY_RUNBOOK.md`**.

Дата 2026-09-22. Реализовано в коде и миграциях, протестировано на одноразовом
локальном Postgres 16. **К production не применялось ничего.** Исторические данные
production не изменялись; 252 строки FIN-03 не удалялись; `opening_balance` не менялся.

Как воспроизвести проверку целиком (production не используется):

```bash
cd finance-app && bash scripts/concurrency/run.sh
```

Скрипт поднимает локальный кластер, создаёт две БД — `t_pre` (схема как в
production сейчас) и `t_post` (та же схема + миграции 0086–0090) — и прогоняет
один и тот же набор тестов против обеих.

Результат прогона 2026-09-22:

```
MODE=pre : PASS=0  FAIL=11     ← все 11 сценариев воспроизводятся
MODE=post: PASS=11 FAIL=0      ← ни один не воспроизводится
```

`next build` — успешно, `tsc --noEmit` — без ошибок.

---

## 1. Finding | Before test | Fix | After test | DB guarantee | Remaining risk

| Finding | Before test | Fix | After test | DB guarantee | Remaining risk |
|---|---|---|---|---|---|
| **T1** начисление ЗП при GET-рендере `/payroll` (CRITICAL) | 2 начисления по 25 000,00 ₽ вместо одного при двух параллельных рендерах | Запись убрана из рендера: страница read-only, начисление — явная команда `POST /api/payroll/materialize` (кнопка «Обновить начисления»). В `materialize_auto_accruals` добавлены `pg_advisory_xact_lock` на команду и `on conflict do nothing`; появился дискриминатор `obligations.origin` | **1 начисление** при двух параллельных прогонах и при повторном явном вызове | `obligations_auto_accrual_uniq (counterparty_id, type, pay_part, period_month, due_date) where origin='auto'` + advisory-lock на прогон | Ручное начисление за тот же месяц по-прежнему возможно (так и было задумано: правило «за месяц уже есть fixed-начисление» сохранено). `materialize_support_cycles` защищён только локом: у `project_periods` нет уникального ключа по периоду |
| **T2** инвойс: `amount ≠ Σ позиций` (HIGH) | `amount=2000,00` при позициях на `3000,00` | `POST /api/invoices` больше не делает три запроса: одна RPC `invoice_save` (upsert инвойса + `for update` + перезапись позиций). Итоги считает БД из позиций | `amount = Σ позиций` при двух параллельных сохранениях | триггер `invoice_items_recalc` (пересчёт `amount`/`vat_amount` из позиций) + deferrable `invoice_items_total_ck` и `invoices_total_ck` | Содержимое позиций при встречном сохранении — «победил последний» (данные консистентны, но правка второго пользователя не сохранится). Оптимистичной блокировки на инвойсе пока нет: `invoices.version` добавлена, но `invoice_save` её не требует |
| **T3** инвойс без позиций после сбоя (MEDIUM) | инвойс `7 770,00` с 0 позиций, отката нет | та же RPC: delete+insert позиций внутри одной транзакции | инвойс и позиции остались в исходном состоянии (`555000/1`) | атомарность транзакции RPC | 10 исторических инвойсов без позиций остаются (созданы пакетно/засеяны, не следствие этой ошибки) |
| **T4** переплата обязательства (HIGH) | `paid=2000,00` при `amount=1000,00`, `outstanding=−1000,00` | RPC `obligation_allocate`: `select ... for update` на обязательстве, пересчёт разнесённого, отказ при переплате, idempotency key | `paid ≤ amount`, второе разнесение отклонено | deferrable `obligation_payments_cap_ck`: `Σ payments ≤ obligations.amount` | Инвариант «Σ разнесений ≤ суммы операции» не проверяется: в `obligation_payments` нет валюты (FIN-02, шаг 7). Кросс-валютные разнесения сравниваются в валюте обязательства |
| **T5** дубль номера инвойса (MEDIUM) | два инвойса `KO-126-INV-10` | номер выдаёт `next_invoice_number`: атомарный upsert счётчика + пропуск занятых номеров, внутри `invoice_save` | три инвойса — три разных номера | `invoices_team_number_uniq (team_id, number) where number <> ''` + таблица `invoice_counters` | Ручной ввод произвольного номера по-прежнему возможен — уникальность его тоже покрывает (вернётся ошибка 23505, текст для UI не локализован) |
| **T6** параллельный импорт валит весь батч (MEDIUM) | импортированы `e1,e2`, событие `e3` потеряно до следующего прогона | RPC `bank_import_commit`: батч, контрагенты и операции в одной транзакции; пересечение пропускается (`on conflict do nothing` + правило кратности), а не роняет батч | импортированы **все** `e1,e2,e3` | `transactions_bank_event_id_uidx (team_id, bank_event_id)`; батч удаляется в той же транзакции, если вставок не было | Импорт большого CSV идёт одним вызовом (дробить нельзя — иначе законные одинаковые операции одного дня потерялись бы): для очень больших файлов это долгая транзакция |
| **T7** TOCTOU в тротлинге синка (LOW) | тротлинг прошли обе сессии | RPC `bank_sync_claim`: один `UPDATE ... where last_synced_at < now() - interval` с `returning` (compare-and-swap) | импорт запускает **ровно одна** сессия | атомарность одного оператора `UPDATE` | При падении процесса после захвата метка уже сдвинута — следующая попытка будет не раньше окна тротлинга (2 часа) |
| **T8** lost update при правке операции (HIGH) | правка первого пользователя молча затёрта | RPC `transaction_save` с `p_expected_version`; при расхождении версии ничего не пишется и возвращается `conflict`; UI показывает «Операцию изменил другой пользователь» и кнопку «Перечитать актуальную запись» | правка первого сохранена, второй получил `conflict` | `transactions.version` + триггер `transactions_bump_version` | CAS работает там, где страница отдаёт `version` (операции, карточка операции). Массовые правки (`RulesManager`, `PlannedReview`, `AgentPayouts`) по-прежнему пишут напрямую — для них CAS не применяется |
| **T9** split/склейка: деньги учтены дважды (CRITICAL) | 2 000,00 ₽ в 3 строках вместо 1 000,00 ₽ | RPC `transaction_split`, `transactions_merge_transfer`, `transaction_match_planned`: `for update`, проверка суммы частей, перенос вложений, удаление исходных строк — одна транзакция; `get diagnostics`/`if not found` не дают «потерять» удаление молча; idempotency key | 1 000,00 ₽ в 2 строках | атомарность RPC + deferrable `transaction_splits_total_ck` | Реконсиляция встречных операций в `ImportWizard` (превращение существующей строки в перевод) осталась отдельным `UPDATE` вне общей транзакции |
| **FIN-03** одно банковское событие записывалось дважды (HIGH) | CSV→Точка и Точка→CSV: **3 строки, оборот 300 000** вместо одной | Каноническая модель идентичности: `transactions.origin` (bank / bank_csv / manual / manual_adjustment / system), `bank_event_id` (`'<provider>:<id>'`) и **вычисляемый в БД** `bank_event_fp` (счёт, дата, сумма, валюта, направление). Оба импортёра идут через `bank_import_commit`, который дедупит по идентификатору провайдера и по отпечатку с учётом кратности, а строку, пришедшую раньше из CSV, при появлении банковского id **повышает** до канонической вместо создания второй. `StatementImportWizard` теперь сводит внутренний перевод к ОДНОЙ строке `transfer` — как импорт Точки | **1 строка, оборот 100 000** в обоих порядках импорта | `bank_event_fp` — generated column (обойти нельзя); `transactions_bank_event_id_uidx`; правило кратности в RPC | Отпечаток не включает назначение платежа — два **разных** платежа одного дня на одну сумму по одному счёту неотличимы; правило кратности разрешает их как «излишек», но при импорте частями они потерялись бы. Существующие 126 дублей остаются до отдельного согласования |

---

## 2. Что именно предлагается применить к production

### 2.1 Миграции (в этом порядке)

| # | Файл | Что делает | Блокировки / данные |
|---|---|---|---|
| 1 | `supabase/migrations/0086_guard_constraints.sql` | уникальный индекс `invoices(team_id, number)`; триггер пересчёта итогов инвойса; 3 deferrable constraint-триггера (позиции инвойса, части операции, переплата обязательства) | только DDL. Текущих нарушений в проде 0 по всем четырём (проверено `db_integrity_audit.sql`) |
| 2 | `supabase/migrations/0087_accrual_idempotency.sql` | `obligations.origin` + partial unique index; переписаны `materialize_auto_accruals` и `materialize_support_cycles` | **содержит backfill данных** — см. 2.3 |
| 3 | `supabase/migrations/0088_financial_rpcs.sql` | таблицы `operation_requests`, `invoice_counters`; функции `op_begin`, `op_finish`, `can_modify_tx`, `next_invoice_number`, `invoice_save`, `obligation_allocate`, `transaction_split`, `transactions_merge_transfer`, `transaction_match_planned` | только DDL |
| 4 | `supabase/migrations/0089_optimistic_concurrency.sql` | `transactions.version`, `invoices.version` + триггеры bump; функция `transaction_save` | `ADD COLUMN ... NOT NULL DEFAULT 1` — в PG 16 без перезаписи таблицы |
| 5 | `supabase/migrations/0090_bank_event_identity.sql` | `transactions.origin`, `bank_event_id`, **generated** `bank_event_fp`; 2 индекса; функции `is_service_role`, `bank_sync_claim`, `bank_import_commit` | **содержит backfill данных** (2.3) и **перезапись таблицы** `transactions` (2.4) |

### 2.2 Новые и изменённые функции БД (RPC)

**Новые:** `invoice_recalc_totals`, `trg_invoice_items_recalc`, `assert_invoice_items_total`,
`assert_invoice_total_matches_items`, `assert_splits_total`, `assert_obligation_not_overpaid`,
`op_begin`, `op_finish`, `can_modify_tx`, `next_invoice_number`, `invoice_save`,
`obligation_allocate`, `transaction_split`, `transactions_merge_transfer`,
`transaction_match_planned`, `trg_bump_version`, `transaction_save`, `is_service_role`,
`bank_sync_claim`, `bank_import_commit`.

**Изменённые:** `materialize_auto_accruals`, `materialize_support_cycles`.
**Удаляемая перегрузка:** `materialize_auto_accruals(uuid, int)` — в production её нет, `drop if exists` для чистоты.

Все функции — `SECURITY DEFINER` с `set search_path = public`. Поскольку SECURITY DEFINER
обходит RLS, каждая функция **сама** проверяет права (`can_edit_finance` / `can_modify_tx` /
`is_service_role`) и принадлежность каждой переданной сущности команде вызывающего.
`execute` выдан только роли `authenticated` (+ `service_role` для `is_service_role`).

> **Найдено при тестировании и исправлено до отправки:** `can_edit_finance()` в production
> возвращает **NULL** для не-участника команды (`role in (...)` при `role IS NULL`). Для RLS
> это отказ, но в plpgsql `if not f() then raise` при NULL **не срабатывает** — первая версия
> RPC пускала посторонних. Все проверки обёрнуты в `coalesce(..., false)`; тест
> «не-участник команды вызывает `invoice_save`» возвращает «Недостаточно прав».

### 2.3 Внимание: миграции 0087 и 0090 содержат backfill по существующим строкам

Это **не** изменение финансовых данных: ни одна сумма, дата, счёт, тип или связь не меняются.
Но это записи в production-таблицы, поэтому их надо согласовать отдельно:

| Миграция | Что пишет | Сколько строк (по текущему проду) |
|---|---|---|
| 0087 | `obligations.origin` = `'system'` (есть `source_transaction_id`/`source_project_id`), `'auto'` (в `note` есть «(авто)»), иначе остаётся `'manual'` | 189 строк: 134 system, 2 auto, 53 manual |
| 0090 | `transactions.origin` = `bank` / `bank_csv` / `system` / `manual`; `bank_event_id` = `'<source>:<external_id>'` для банковских строк | ~7 940 строк, из них с `bank_event_id` — те, у которых есть `external_id` |

Если такой backfill сейчас не согласован — миграции можно применять без него
(блоки `update` отделены комментариями), но тогда дедуп по отпечатку не будет видеть
исторические строки, и защита FIN-03 начнёт действовать только для новых импортов.

### 2.4 Эксплуатационные замечания к применению

1. **Порядок обязателен: сначала БД, потом код.** Новый код вызывает `invoice_save`,
   `transaction_save`, `bank_import_commit`, `bank_sync_claim` и читает колонку
   `transactions.version`. Если задеплоить код раньше миграций — сохранение операций,
   инвойсов и импорт перестанут работать.
2. **`ADD COLUMN ... GENERATED ALWAYS AS ... STORED` перезаписывает таблицу** `transactions`
   и берёт `ACCESS EXCLUSIVE` лок. На 7 940 строках это доли секунды, но на время
   применения стоит выключить cron-импорты (`tochka-autosync` в pg_cron и Vercel-cron).
3. **Порядок применения не совпадает с порядком в `REMEDIATION_PLAN`:** там шаг 2 (T1) идёт
   перед шагом 3 (RPC), здесь миграция 0087 тоже вторая — совпадает.
4. **Историческая чистка FIN-03 (шаг 6) не входит** в этот PR и по-прежнему требует
   отдельного согласования (и решения по `opening_balance`).

### 2.5 Изменения в коде приложения

| Файл | Что изменилось |
|---|---|
| `src/app/(app)/payroll/page.tsx` | убраны `materialize_auto_accruals`/`materialize_support_cycles` из рендера; добавлена кнопка |
| `src/app/api/payroll/materialize/route.ts` | **новый** — явная POST-команда начисления |
| `src/components/MaterializeAccrualsButton.tsx` | **новый** |
| `src/app/api/invoices/route.ts` | POST → `invoice_save` (вместо трёх запросов); принимает `request_id` |
| `src/components/AllocatePaymentButton.tsx` | → `obligation_allocate` |
| `src/components/SplitTransactionModal.tsx` | → `transaction_split` |
| `src/components/OperationsTable.tsx` | склейки → `transactions_merge_transfer`, `transaction_match_planned` |
| `src/components/OperationCard.tsx` | → `transaction_save` с версией; обработка `conflict` в UI |
| `src/components/TransactionPartsEditor.tsx` | контракт `commit()` (писал сам) → `collect()` (только валидация и payload) |
| `src/components/EditableTransactionRow.tsx` + 4 страницы | в `TxData` и в `select` добавлена `version` |
| `src/lib/tochka-import.ts` | полностью на `bank_import_commit`; убраны ручная компенсация и клиентский дедуп |
| `src/app/api/tochka/auto-sync/route.ts` | тротлинг → `bank_sync_claim` (CAS) |
| `src/components/StatementImportWizard.tsx` | канонизация внутренних переводов (2 строки → 1 `transfer`) + `bank_import_commit`, `origin='bank_csv'` |
| `src/components/ImportWizard.tsx` | → `bank_import_commit`, `origin='bank_csv'` |
| `scripts/concurrency/{schema_base,regression,run}.{sql,sh}` | регрессионный набор: 11 тестов × 2 режима |

---

## 3. Forensic detector после исправления первопричины

Прогон на production (только чтение, 2026-09-22):

| Проверка | Значение |
|---|---|
| `double-counted transfers (FIN-03)` | **126** — как и было; старые события не чистились (ожидаемо) |
| из них с датой после 2025-03-16 | **0** — новых не появилось |
| новых строк из батча `svodnaya_vypiska_2025.csv` после начала аудита | **0** |
| всего операций | 7 940 |

Важная оговорка: миграции к production **не применены**, поэтому «новые дубли не создаются»
сейчас означает лишь «с момента аудита CSV-импорт не запускали». Проверка того, что защита
работает, сделана тестами T10/T11 на `t_post`, а не на production.

---

## 4. Остаточные риски (сводно)

1. **Шаги 6–9 не выполнялись:** историческая чистка FIN-03, валюта (FIN-01/FIN-02),
   SEC-001/SEC-002, CI-гейты.
2. **Массовые правки операций** (`RulesManager`, `PlannedReview`, `AgentPayouts`,
   `OperationCard.remove`) по-прежнему пишут напрямую и не используют CAS.
3. **Инвойс:** CAS не включён (колонка есть, RPC её не требует) — встречная правка позиций
   «победил последний», но данные остаются консистентными.
4. **Отпечаток банковского события** не учитывает назначение платежа: устойчив к повторному
   импорту, но не различает два разных платежа одного дня на одинаковую сумму по одному счёту.
5. **Реконсиляция в `ImportWizard`** осталась отдельным `UPDATE` вне общей транзакции.
6. **Автотестов в проекте по-прежнему нет**, кроме `scripts/concurrency/` и
   `scripts/db_integrity_audit.sql`; в CI они не подключены.
7. **Тесты идут на копии схемы**, а не на боевой БД: они доказывают наличие/отсутствие
   защиты, а не поведение конкретного production-инстанса.
