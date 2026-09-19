# Concurrency tests for Basa financial write-flows

Исполняемое доказательство к разделу «Конкурентность» в `E2E_AUDIT.md`.
Тест **никогда не подключается к production** — он поднимает одноразовый локальный
Postgres 16 (уровень изоляции READ COMMITTED, как в Supabase по умолчанию) с минимальной
копией схемы: набор таблиц, CHECK-ограничений и уникальных индексов скопирован 1:1 с боевой
схемы (`pg_indexes` / `pg_constraint`), включая **отсутствующие** ограничения — именно их
отсутствие и проверяется.

Каждая «сессия» теста = отдельное соединение `psql` в autocommit. Это точная модель
приложения: у Supabase JS нет клиентских транзакций, каждый `.insert()/.update()/.delete()`
уходит отдельным HTTP-запросом PostgREST и коммитится сам по себе.

## Запуск

```bash
BASE=/var/tmp/pgaudit
mkdir -p $BASE && chown postgres:postgres $BASE
su postgres -c "/usr/lib/postgresql/16/bin/initdb -D $BASE/data -U audit --auth=trust"
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D $BASE/data -o '-k $BASE -p 5433 -c listen_addresses=' -l $BASE/pg.log start"
psql -h $BASE -p 5433 -U audit -d postgres -c 'create database basa'
psql -h $BASE -p 5433 -U audit -d basa -f scripts/concurrency/schema.sql
bash scripts/concurrency/conc_test.sh
```

## Что проверяется

| Тест | Поток в приложении | Ожидание |
|---|---|---|
| T1 | `materialize_auto_accruals()` — начисление ЗП при рендере `/payroll` | дублирующее начисление |
| T2 | `POST /api/invoices` — update + delete + insert позиций | `amount ≠ Σ позиций` |
| T3 | `POST /api/invoices` — ошибка на вставке позиций | инвойс с суммой и без позиций |
| T4 | `AllocatePaymentButton` — разнесение выплаты | переплата обязательства |
| T5 | `nextInvoiceNumberForProject()` | одинаковый номер у двух инвойсов |
| T6 | Точка: cron и авто-синк одновременно | весь батч импорта падает |
| T7 | `/api/tochka/auto-sync` — тротлинг по `last_synced_at` | обе сессии проходят тротлинг |
| T8 | `OperationCard` — правка операции двумя пользователями | lost update |
| T9 | `SplitTransactionModal` — вставка частей прошла, удаление исходной нет | сумма учтена дважды |

Результаты прогона от 2026-09-19 — в `E2E_AUDIT.md`, раздел 3.
