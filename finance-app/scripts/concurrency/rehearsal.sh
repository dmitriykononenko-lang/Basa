#!/usr/bin/env bash
# ============================================================================
# rehearsal.sh — репетиция применения миграций 0086–0091 на копии схемы с
# объёмом данных, повторяющим production (см. таблицу ниже). Production не
# используется: всё происходит в одноразовом локальном Postgres 16.
#
# Объёмы взяты из production на 2026-09-22 (read-only запрос):
#   transactions 7 938 (6 936 kB) · transaction_history 6 657 · import_batches 265
#   obligations 189 · counterparties 157 · obligation_payments 96 · invoices 25
#   accounts 24 · invoice_items 22 · transaction_splits 4 · project_periods 3
#
# Измеряется: время каждой миграции, время (= длительность блокировки) для
# ALTER'ов, перезапись таблицы, размер до/после, счётчики backfill'а,
# коллизии отпечатков, валидация ограничений, интеграционные проверки.
# ============================================================================
set -u
BASE=${BASE:-/var/tmp/pgaudit}
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
HERE="$(cd "$(dirname "$0")" && pwd)"
MIG="$HERE/../../supabase/migrations"
DB=t_reh
P="psql -h $BASE -p 5433 -U audit -d $DB -qtA"

if ! psql -h "$BASE" -p 5433 -U audit -d postgres -qc "select 1" >/dev/null 2>&1; then
  rm -rf "$BASE"; mkdir -p "$BASE"; chown postgres:postgres "$BASE" 2>/dev/null || true
  su postgres -c "$PGBIN/initdb -D $BASE/data -U audit --auth=trust" >"$BASE/initdb.log" 2>&1
  su postgres -c "$PGBIN/pg_ctl -D $BASE/data -o '-k $BASE -p 5433 -c listen_addresses=' -l $BASE/pg.log start" >/dev/null
  sleep 2
fi

psql -h "$BASE" -p 5433 -U audit -d postgres -qc "drop database if exists $DB;" >/dev/null
psql -h "$BASE" -p 5433 -U audit -d postgres -qc "create database $DB;" >/dev/null
$P -v ON_ERROR_STOP=1 -f "$HERE/schema_base.sql" 2>&1 | grep -v NOTICE

echo "=== 1. Генерация данных в объёме production ==="
$P -v ON_ERROR_STOP=1 <<'SQL'
-- счета (24), контрагенты (157), батчи (265)
insert into accounts (team_id, name, currency)
select '11111111-1111-1111-1111-111111111111', 'Счёт '||g, case when g%12=0 then 'USDT' else 'RUB' end
  from generate_series(3,24) g;
insert into counterparties (team_id, name, inn, kind)
select '11111111-1111-1111-1111-111111111111', 'Контрагент '||g, lpad(g::text,10,'7'),
       (array['client','supplier','partner','other'])[1+g%4]::counterparty_kind
  from generate_series(2,157) g;
insert into import_batches (team_id, file_name, bank, row_count, status)
select '11111111-1111-1111-1111-111111111111', 'batch '||g,
       case when g%3=0 then 'Сводная выписка' else 'tochka' end, 30, 'imported'
  from generate_series(1,265) g;

-- 7 938 операций с реалистичным распределением: 60% из банка (есть external_id),
-- 20% из CSV (нет external_id, есть батч), 20% ручных; суммы и даты намеренно
-- повторяются, чтобы воспроизвести коллизии отпечатков как в проде.
insert into transactions (team_id, type, amount, currency, account_id, transfer_account_id,
                          counterparty_id, occurred_on, note, status, source, external_id, import_batch_id)
select '11111111-1111-1111-1111-111111111111',
       (array['income','expense','expense','transfer'])[1+g%4]::tx_type,
       (1 + (g % 40)) * 1000,
       case when g%12=0 then 'USDT' else 'RUB' end,
       (select id from accounts where team_id='11111111-1111-1111-1111-111111111111' offset (g % 24) limit 1),
       case when g%4=3 then (select id from accounts where team_id='11111111-1111-1111-1111-111111111111' offset ((g+1) % 24) limit 1) end,
       case when g%5=0 then null else (select id from counterparties where team_id='11111111-1111-1111-1111-111111111111' offset (g % 157) limit 1) end,
       date '2025-01-01' + (g % 600),
       case when g%7=0 then 'Отчисление в фонд '||(g%9)||' с операции на сумму '||(g%40)||' 000 RUB · Платежное поручение №'||g
            else 'Операция '||(g%50) end,
       'actual',
       case when g%5 < 3 then 'tochka' end,
       case when g%5 < 3 then 'cbs-'||g end,
       case when g%5 >= 3 and g%5 < 4 then (select id from import_batches where team_id='11111111-1111-1111-1111-111111111111' offset (g % 265) limit 1) end
  from generate_series(1,7938) g;

-- обязательства (189), разнесения (96), инвойсы (25) + позиции (22), части (4)
insert into obligations (team_id, counterparty_id, type, amount, currency, status, pay_part, period_month, note)
select '11111111-1111-1111-1111-111111111111',
       (select id from counterparties where team_id='11111111-1111-1111-1111-111111111111' offset (g % 157) limit 1),
       (array['payable','receivable'])[1+g%2]::obligation_type,
       (10 + g) * 1000, 'RUB', 'open',
       case when g%3=0 then 'fixed' end::accrual_kind,
       case when g%3=0 then (date '2025-01-01' + (g % 500))::date end,
       case when g%3=0 then 'Начисление ЗП' else 'Прочее' end
  from generate_series(1,189) g;
insert into obligation_payments (obligation_id, amount, paid_on)
select o.id, least(o.amount, 1000), current_date
  from (select id, amount, row_number() over () rn from obligations) o where o.rn <= 96;
insert into invoices (team_id, number, buyer_name, amount, vat_amount, status)
select '11111111-1111-1111-1111-111111111111', 'KO-126-INV-'||lpad(g::text,2,'0'), 'Покупатель '||g, 0, 0, 'payment_waiting'
  from generate_series(1,25) g;
insert into invoice_items (invoice_id, team_id, name, quantity, unit, price, vat_rate, amount, sort)
select i.id, i.team_id, 'Позиция', 1, 'шт', 1000, 'none', 1000, 0
  from (select id, team_id, row_number() over () rn from invoices) i where i.rn <= 22;
update invoices i set amount = 1000
 where exists (select 1 from invoice_items it where it.invoice_id = i.id);
insert into transaction_splits (team_id, transaction_id, amount)
select t.team_id, t.id, t.amount from (select * from transactions limit 4) t;
insert into project_periods (project_id, period_month, period_start, period_end)
select '33333333-3333-3333-3333-333333333333', (date_trunc('month', current_date) - (g||' month')::interval)::date,
       (date_trunc('month', current_date) - (g||' month')::interval)::date,
       (date_trunc('month', current_date) - ((g-1)||' month')::interval - interval '1 day')::date
  from generate_series(1,3) g;
SQL

echo -n "строк в transactions: "; $P -c "select count(*) from transactions;"
echo -n "размер transactions ДО: "; $P -c "select pg_size_pretty(pg_total_relation_size('transactions'));"
REL_BEFORE=$($P -c "select relfilenode from pg_class where relname='transactions';")

echo
echo "=== 2. Применение миграций: время каждой ==="
for m in 0086_guard_constraints 0087_accrual_idempotency 0088_financial_rpcs 0089_optimistic_concurrency 0090_bank_event_identity 0091_write_paths_and_authz; do
  S=$(date +%s.%N)
  OUT=$(psql -h "$BASE" -p 5433 -U audit -d $DB -q -v ON_ERROR_STOP=1 -f "$MIG/$m.sql" 2>&1 | grep -viE "does not exist, skipping|^NOTICE|отсутствует — пропущено")
  E=$(date +%s.%N)
  printf '  %-34s %6.2f s  %s\n' "$m" "$(echo "$E - $S" | bc)" "${OUT:+ОШИБКИ: $OUT}"
done

echo
echo "=== 3. Перезапись таблицы и размеры ==="
REL_AFTER=$($P -c "select relfilenode from pg_class where relname='transactions';")
echo -n "  relfilenode до/после: $REL_BEFORE / $REL_AFTER — "
[ "$REL_BEFORE" = "$REL_AFTER" ] && echo "перезаписи НЕ было" || echo "таблица ПЕРЕЗАПИСАНА (ACCESS EXCLUSIVE)"
echo -n "  размер transactions ПОСЛЕ: "; $P -c "select pg_size_pretty(pg_total_relation_size('transactions'));"
$P -c "select '  индекс '||indexname||' = '||pg_size_pretty(pg_relation_size(indexname::regclass)) from pg_indexes where tablename='transactions' and indexname like '%bank_event%' order by 1;"

echo
echo "=== 4. Длительность отдельных ALTER'ов (= длительность блокировки) ==="
$P -c "drop table if exists _lock_probe;" >/dev/null
$P -c "create table _lock_probe as select * from transactions;" >/dev/null
for stmt in \
  "alter table _lock_probe add column probe_plain text" \
  "alter table _lock_probe add column probe_default text not null default 'x'" \
  "alter table _lock_probe add column probe_generated text generated always as (team_id::text||'|'||amount::text) stored" ; do
  S=$(date +%s.%N); $P -c "$stmt;" >/dev/null 2>&1; E=$(date +%s.%N)
  printf '  %6.3f s  %s\n' "$(echo "$E - $S" | bc)" "$stmt"
done
$P -c "drop table _lock_probe;" >/dev/null

echo
echo "=== 5. Результаты backfill'а ==="
$P -c "select '  transactions.origin: '||origin||' = '||count(*) from transactions group by origin order by count(*) desc;"
$P -c "select '  bank_event_id заполнен: '||count(*) from transactions where bank_event_id is not null;"
$P -c "select '  obligations.origin: '||origin||' = '||count(*) from obligations group by origin order by count(*) desc;"

echo
echo "=== 6. Коллизии отпечатков на этом наборе ==="
$P -c "select '  слабый fp: групп '||count(*)||', коллизий '||count(*) filter (where c>1)||', лишних строк '||coalesce(sum(c-1) filter (where c>1),0)
       from (select bank_event_fp, count(*) c from transactions where bank_event_fp is not null group by 1) z;"
$P -c "select '  сильный fp: групп '||count(*)||', коллизий '||count(*) filter (where c>1)||', из них с 2+ provider id '||count(*) filter (where c>1 and ids>1)
       from (select bank_event_fp_strong, count(*) c, count(distinct bank_event_id) ids from transactions where bank_event_fp_strong is not null group by 1) z;"

echo
echo "=== 7. Валидация ограничений и целостность ==="
$P -c "select '  '||conname||' = '||convalidated from pg_constraint where conrelid='transactions'::regclass and contype='c';"
$P -c "select '  инвойсы: amount <> Σ позиций: '||count(*) from (select i.id from invoices i join invoice_items it on it.invoice_id=i.id group by i.id, i.amount having i.amount<>sum(it.amount)) z;"
$P -c "select '  обязательства переплачены: '||count(*) from (select o.id from obligations o join obligation_payments p on p.obligation_id=o.id group by o.id,o.amount having sum(p.amount)>o.amount) z;"
$P -c "select '  дубли номеров инвойсов: '||coalesce(sum(c-1),0) from (select count(*) c from invoices where number<>'' group by team_id, number having count(*)>1) z;"
$P -c "select '  Σ частей <> сумме операции: '||count(*) from (select s.transaction_id from transaction_splits s join transactions t on t.id=s.transaction_id group by s.transaction_id having sum(s.amount)<>max(t.amount)) z;"
echo -n "  строк в transactions после миграций: "; $P -c "select count(*) from transactions;"

echo
echo "=== 8. Регрессия на этой же БД (T1–T14) ==="
BASE="$BASE" MODE=post DB=$DB bash "$HERE/regression.sh" | tail -4
echo "=== 9. Авторизация на этой же БД ==="
BASE="$BASE" MODE=post DB=$DB bash "$HERE/authz_test.sh" | tail -3
