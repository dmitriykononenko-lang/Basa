#!/usr/bin/env bash
# Concurrency tests for Basa financial write-flows.
# Runs against a LOCAL throwaway Postgres 16 (READ COMMITTED, same as Supabase default).
# Each "session" = one psql connection in autocommit, mirroring the app, which issues
# every statement as a separate PostgREST round-trip with no enclosing transaction.
BASE=/var/tmp/pgaudit
P="psql -h $BASE -p 5433 -U audit -d basa -v ON_ERROR_STOP=0 -qtA"

hdr(){ echo; echo "=================== $1 ==================="; }

$P -c "truncate invoices, invoice_items, obligations, obligation_payments, transactions, bank_connections cascade;" >/dev/null

TEAM=11111111-1111-1111-1111-111111111111
CP=22222222-2222-2222-2222-222222222222
PRJ=33333333-3333-3333-3333-333333333333

# ---------------------------------------------------------------- T1
hdr "T1 materialize_auto_accruals: check-then-insert without unique index"
$P -c "
create or replace function materialize_auto_accruals_sim(p_team uuid, p_window_ms int) returns int as \$\$
declare m date := '2026-09-01'; amt bigint; begin
  -- guard copied 1:1 from prod materialize_auto_accruals()
  if exists (select 1 from obligations o where o.counterparty_id='$CP'
             and o.type='payable' and o.pay_part='fixed' and o.period_month=m) then
    return 0;
  end if;
  perform pg_sleep(p_window_ms/1000.0);  -- real function loops over employees*months between check and insert
  select s.amount into amt from employee_salaries s where s.counterparty_id='$CP' limit 1;
  insert into obligations(team_id,counterparty_id,type,pay_part,period_month,amount,currency,due_date,note)
  values (p_team,'$CP','payable','fixed',m,amt,'RUB',m,'Начисление ЗП (авто)');
  return 1;
end \$\$ language plpgsql;" >/dev/null
( $P -c "select materialize_auto_accruals_sim('$TEAM',700);" >/dev/null ) &
sleep 0.15
( $P -c "select materialize_auto_accruals_sim('$TEAM',700);" >/dev/null ) &
wait
echo -n "obligations for 2026-09 (expected 1): "; $P -c "select count(*) from obligations where period_month='2026-09-01';"
echo -n "sum accrued (expected 2500000): ";       $P -c "select coalesce(sum(amount),0) from obligations where period_month='2026-09-01';"

# ---------------------------------------------------------------- T2
hdr "T2 invoice save (POST /api/invoices): update + delete + insert, no transaction"
INV=$($P -c "insert into invoices(team_id,number,project_id,amount) values('$TEAM','KO-126-INV-01','$PRJ',1000) returning id;")
$P -c "insert into invoice_items(team_id,invoice_id,name,amount,sort) values('$TEAM','$INV','старая',1000,0);" >/dev/null
(  $P -c "update invoices set amount=100000 where id='$INV';" >/dev/null
   $P -c "delete from invoice_items where invoice_id='$INV';" >/dev/null
   sleep 0.5
   $P -c "insert into invoice_items(team_id,invoice_id,name,amount,sort) values('$TEAM','$INV','A',100000,0);" >/dev/null ) &
sleep 0.2
(  $P -c "update invoices set amount=200000 where id='$INV';" >/dev/null
   $P -c "delete from invoice_items where invoice_id='$INV';" >/dev/null
   $P -c "insert into invoice_items(team_id,invoice_id,name,amount,sort) values('$TEAM','$INV','B',200000,0);" >/dev/null ) &
wait
echo -n "invoices.amount vs sum(items) : "
$P -c "select i.amount||' vs '||coalesce((select sum(amount) from invoice_items it where it.invoice_id=i.id),0)||'  items='||(select count(*) from invoice_items it where it.invoice_id=i.id) from invoices i where i.id='$INV';"

# ---------------------------------------------------------------- T3
hdr "T3 invoice save: failure between DELETE items and INSERT items (no rollback)"
INV2=$($P -c "insert into invoices(team_id,number,amount) values('$TEAM','KO-126-INV-09',555000) returning id;")
$P -c "insert into invoice_items(team_id,invoice_id,name,amount,sort) values('$TEAM','$INV2','поз',555000,0);" >/dev/null
$P -c "update invoices set amount=777000 where id='$INV2';" >/dev/null
$P -c "delete from invoice_items where invoice_id='$INV2';" >/dev/null
# вставка позиций падает (в бою: отказ RLS, обрыв сети, таймаут, невалидная ставка НДС)
$P -c "insert into invoice_items(team_id,invoice_id,name,amount,sort,vat_rate) values('$TEAM','$INV2','поз',777000,0,'18');" 2>&1 | head -1
echo -n "invoice after failed item insert (amount / items): "
$P -c "select amount||' / '||(select count(*) from invoice_items it where it.invoice_id=i.id) from invoices i where i.id='$INV2';"

# ---------------------------------------------------------------- T4
hdr "T4 obligation allocation (AllocatePaymentButton): two clients, same obligation"
OBL=$($P -c "insert into obligations(team_id,counterparty_id,type,amount,currency,status) values('$TEAM','$CP','payable',100000,'RUB','open') returning id;")
T1X=$($P -c "insert into transactions(team_id,amount,currency,occurred_on) values('$TEAM',100000,'RUB','2026-09-01') returning id;")
T2X=$($P -c "insert into transactions(team_id,amount,currency,occurred_on) values('$TEAM',100000,'RUB','2026-09-01') returning id;")
(  A=$($P -c "select outstanding from obligation_balances where id='$OBL';"); sleep 0.4
   $P -c "insert into obligation_payments(obligation_id,amount,paid_on,transaction_id) values('$OBL',$A,'2026-09-01','$T1X');" >/dev/null ) &
(  B=$($P -c "select outstanding from obligation_balances where id='$OBL';"); sleep 0.4
   $P -c "insert into obligation_payments(obligation_id,amount,paid_on,transaction_id) values('$OBL',$B,'2026-09-01','$T2X');" >/dev/null ) &
wait
echo -n "obligation amount / paid / outstanding: "
$P -c "select amount||' / '||paid||' / '||outstanding from obligation_balances where id='$OBL';"

# ---------------------------------------------------------------- T5
hdr "T5 invoice number generation (nextInvoiceNumberForProject): read max -> +1 -> insert"
$P -c "delete from invoices where project_id='$PRJ';" >/dev/null
$P -c "insert into invoices(team_id,number,project_id,amount) values('$TEAM','KO-126-INV-01','$PRJ',1000);" >/dev/null
gen(){ N=$($P -c "select coalesce(max((regexp_match(number,'^KO-126-INV-(\d+)$'))[1]::int),0)+1 from invoices where team_id='$TEAM' and number like 'KO-126-INV-%';")
       sleep 0.4
       $P -c "insert into invoices(team_id,number,project_id,amount) values('$TEAM','KO-126-INV-'||lpad('$N',2,'0'),'$PRJ',$1);" >/dev/null; }
gen 500 & gen 900 & wait
echo "numbers now:"; $P -c "select number||' amount='||amount from invoices where project_id='$PRJ' order by number, amount;"
echo -n "distinct numbers / rows: "; $P -c "select count(distinct number)||' / '||count(*) from invoices where project_id='$PRJ';"

# ---------------------------------------------------------------- T6
hdr "T6 Tochka import: concurrent cron + auto-sync over the same window"
$P -c "delete from transactions;" >/dev/null
imp(){ # $1 = ids csv ; mirrors tochka-import.ts: select existing -> filter -> ONE multi-row insert
  EX=$($P -c "select count(*) from transactions where team_id='$TEAM' and source='tochka' and external_id in ($1);")
  sleep 0.4
  VALS=$(echo "$1" | tr -d "'" | tr ',' '\n' | awk -v t=$TEAM '{printf "(\047%s\047,1000,\047RUB\047,\047tochka\047,\047%s\047,\0472026-09-01\047),",t,$0}' | sed 's/,$//')
  OUT=$($P -c "insert into transactions(team_id,amount,currency,source,external_id,occurred_on) values $VALS;" 2>&1)
  echo "  session[$1] pre-existing=$EX result: ${OUT:-INSERT ok}"; }
imp "'e1','e2'" & imp "'e2','e3'" & wait
echo -n "transactions imported (external_ids): "; $P -c "select coalesce(string_agg(external_id,','order by external_id),'(none)') from transactions;"

# ---------------------------------------------------------------- T7
hdr "T7 auto-sync throttle (last_synced_at optimistic lock)"
$P -c "insert into bank_connections(team_id,provider,last_synced_at) values('$TEAM','tochka', now()-interval '5 hours');" >/dev/null
sync(){ AGE=$($P -c "select extract(epoch from (now()-last_synced_at))/60 from bank_connections where team_id='$TEAM' and provider='tochka';")
        FRESH=$($P -c "select case when $AGE < 120 then 'fresh' else 'stale' end;")
        sleep 0.3
        if [ "$FRESH" = "stale" ]; then
          $P -c "update bank_connections set last_synced_at=now() where team_id='$TEAM' and provider='tochka';" >/dev/null
          echo "  session $1: passed throttle -> RUNS IMPORT"
        else echo "  session $1: skipped (fresh)"; fi; }
sync one & sync two & wait

# ---------------------------------------------------------------- T8
hdr "T8 lost update: two users edit the same operation (OperationCard sends the whole row)"
$P -c "delete from transactions;" >/dev/null
TX=$($P -c "insert into transactions(team_id,amount,currency,occurred_on) values('$TEAM',100000,'RUB','2026-09-01') returning id;")
CAT=$($P -c "select gen_random_uuid();")
( sleep 0.1; $P -c "update transactions set amount=100000, note='комментарий Пети', category_id=null where id='$TX';" >/dev/null ) &
( sleep 0.4; $P -c "update transactions set amount=100000, note=null, category_id='$CAT' where id='$TX';" >/dev/null ) &
wait
echo -n "  -> note / category after both saves: "
$P -c "select coalesce(note,'(null)')||' / '||coalesce(category_id::text,'(null)') from transactions where id='$TX';"

# ---------------------------------------------------------------- T9
hdr "T9 split: parts INSERT succeeds, original DELETE does not -> money counted twice"
$P -c "delete from transactions;" >/dev/null
SRC=$($P -c "insert into transactions(team_id,amount,currency,occurred_on) values('$TEAM',100000,'RUB','2026-09-01') returning id;")
$P -c "insert into transactions(team_id,amount,currency,occurred_on) values('$TEAM',60000,'RUB','2026-09-01'),('$TEAM',40000,'RUB','2026-09-01');" >/dev/null
$P -c "delete from transactions where id='$SRC' and 1=0;" >/dev/null  # delete lost (RLS deny / dropped request): 0 rows, no error shown to the user
echo -n "  -> total recorded for one 1000,00 RUB operation: "
$P -c "select sum(amount)||' minor ('||count(*)||' rows)' from transactions;"

echo; echo "=== done ==="
