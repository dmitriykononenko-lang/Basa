#!/usr/bin/env bash
# ============================================================================
# regression.sh — T1..T9 + два кросс-импортных теста, один и тот же сценарий
# против схемы ДО ремедиации (MODE=pre) и ПОСЛЕ (MODE=post).
#   pre  — вызовы повторяют то, что делает приложение сегодня: набор отдельных
#          запросов в autocommit (у Supabase JS нет клиентских транзакций).
#   post — те же бизнес-команды через RPC из миграций 0086–0090.
# Каждая «сессия» — отдельное соединение psql. Production не используется.
# Выводит по строке на тест: PASS = проблема не воспроизводится.
# ============================================================================
set -u
BASE=${BASE:-/var/tmp/pgaudit}
MODE=${MODE:-post}
DB=${DB:-t_$MODE}
P="psql -h $BASE -p 5433 -U audit -d $DB -qtA"
T=11111111-1111-1111-1111-111111111111
U1=aaaaaaaa-0000-0000-0000-000000000001
U2=aaaaaaaa-0000-0000-0000-000000000002
ACC_A=a0000000-0000-0000-0000-000000000001
ACC_B=a0000000-0000-0000-0000-000000000002
CAT=c0000000-0000-0000-0000-000000000002
CP=22222222-2222-2222-2222-222222222222
PRJ=33333333-3333-3333-3333-333333333333

pass=0; fail=0
q(){ $P -c "set test.uid='${2:-$U1}'; $1" 2>&1; }
reset(){ $P -c "delete from obligation_payments; delete from transaction_splits; delete from attachments;
                delete from transactions; delete from obligations; delete from invoice_items; delete from invoices;
                delete from import_batches;" >/dev/null 2>&1
         # таблиц ниже нет в pre-схеме — отдельными вызовами, чтобы ошибка не
         # откатывала основную очистку (psql -c = одна транзакция)
         $P -c "delete from operation_requests;" >/dev/null 2>&1
         $P -c "delete from bank_reconciliation_conflicts;" >/dev/null 2>&1
         $P -c "truncate invoice_counters;" >/dev/null 2>&1
         true; }
check(){ # name, expected, actual
  if [ "$2" = "$3" ]; then printf '  %-4s PASS  %s\n' "$1" "$4"; pass=$((pass+1));
  else printf '  %-4s FAIL  %s — ожидалось [%s], получено [%s]\n' "$1" "$4" "$2" "$3"; fail=$((fail+1)); fi; }

echo "=============== MODE=$MODE (db=$DB) ==============="

# ---------------------------------------------------------------- T1
reset
if [ "$MODE" = pre ]; then
  ( q "select materialize_auto_accruals('$T', 700);" >/dev/null ) &
  sleep 0.15
  ( q "select materialize_auto_accruals('$T', 700);" >/dev/null ) &
  wait
else
  ( q "select materialize_auto_accruals('$T');" >/dev/null ) &
  ( q "select materialize_auto_accruals('$T');" >/dev/null ) &
  wait
  q "select materialize_auto_accruals('$T');" >/dev/null   # повторный явный вызов тоже идемпотентен
fi
n=$($P -c "select count(*) from obligations where coalesce(note,'') like '%(авто)%';")
check T1 1 "$n" "начисление ЗП: ровно одно при двух параллельных прогонах"

# ---------------------------------------------------------------- T2
reset
if [ "$MODE" = pre ]; then
  INV=$($P -c "insert into invoices(team_id,number,project_id,amount) values('$T','KO-126-INV-01','$PRJ',1000) returning id;")
  $P -c "insert into invoice_items(team_id,invoice_id,name,amount,sort) values('$T','$INV','old',1000,0);" >/dev/null
  ( $P -c "update invoices set amount=100000 where id='$INV';" >/dev/null
    $P -c "delete from invoice_items where invoice_id='$INV';" >/dev/null
    sleep 0.5
    $P -c "insert into invoice_items(team_id,invoice_id,name,amount,sort) values('$T','$INV','A',100000,0);" >/dev/null ) &
  sleep 0.2
  ( $P -c "update invoices set amount=200000 where id='$INV';" >/dev/null
    $P -c "delete from invoice_items where invoice_id='$INV';" >/dev/null
    $P -c "insert into invoice_items(team_id,invoice_id,name,amount,sort) values('$T','$INV','B',200000,0);" >/dev/null ) &
  wait
else
  INV=$(q "select (invoice_save(jsonb_build_object('team_id','$T','buyer_name','X','items',jsonb_build_array(jsonb_build_object('name','old','quantity',1,'price',1000)))))->>'id';")
  ( q "select invoice_save(jsonb_build_object('id','$INV','team_id','$T','buyer_name','X','items',jsonb_build_array(jsonb_build_object('name','A','quantity',1,'price',100000))));" >/dev/null ) &
  ( q "select invoice_save(jsonb_build_object('id','$INV','team_id','$T','buyer_name','X','items',jsonb_build_array(jsonb_build_object('name','B','quantity',1,'price',200000))));" >/dev/null ) &
  wait
fi
d=$($P -c "select case when i.amount = coalesce((select sum(amount) from invoice_items it where it.invoice_id=i.id),0) then 'match' else i.amount||'<>'||coalesce((select sum(amount) from invoice_items it where it.invoice_id=i.id),0) end from invoices i where i.id='$INV';")
check T2 match "$d" "инвойс: amount = Σ позиций при двух параллельных сохранениях"

# ---------------------------------------------------------------- T3
reset
if [ "$MODE" = pre ]; then
  INV=$($P -c "insert into invoices(team_id,number,amount) values('$T','KO-126-INV-09',555000) returning id;")
  $P -c "insert into invoice_items(team_id,invoice_id,name,amount,sort) values('$T','$INV','поз',555000,0);" >/dev/null
  $P -c "update invoices set amount=777000 where id='$INV';" >/dev/null
  $P -c "delete from invoice_items where invoice_id='$INV';" >/dev/null
  $P -c "insert into invoice_items(team_id,invoice_id,name,amount,sort,vat_rate) values('$T','$INV','поз',777000,0,'18');" >/dev/null 2>&1
else
  INV=$(q "select (invoice_save(jsonb_build_object('team_id','$T','buyer_name','X','items',jsonb_build_array(jsonb_build_object('name','поз','quantity',1,'price',555000)))))->>'id';")
  q "select invoice_save(jsonb_build_object('id','$INV','team_id','$T','buyer_name','X','items',jsonb_build_array(jsonb_build_object('name','поз','quantity',1,'price',777000,'vat_rate','18'))));" >/dev/null 2>&1
fi
d=$($P -c "select amount||'/'||(select count(*) from invoice_items it where it.invoice_id=i.id) from invoices i where i.id='$INV';")
check T3 "555000/1" "$d" "сбой на позициях: полный откат, инвойс не осиротел"

# ---------------------------------------------------------------- T4
reset
OBL=$($P -c "insert into obligations(team_id,counterparty_id,type,amount,currency,status) values('$T','$CP','payable',100000,'RUB','open') returning id;")
TX1=$($P -c "insert into transactions(team_id,type,amount,currency,account_id,occurred_on) values('$T','expense',100000,'RUB','$ACC_A','2026-09-01') returning id;")
TX2=$($P -c "insert into transactions(team_id,type,amount,currency,account_id,occurred_on) values('$T','expense',100000,'RUB','$ACC_A','2026-09-01') returning id;")
if [ "$MODE" = pre ]; then
  ( A=$($P -c "select outstanding from obligation_balances where id='$OBL';"); sleep 0.4
    $P -c "insert into obligation_payments(obligation_id,amount,paid_on,transaction_id) values('$OBL',$A,'2026-09-01','$TX1');" >/dev/null 2>&1 ) &
  ( B=$($P -c "select outstanding from obligation_balances where id='$OBL';"); sleep 0.4
    $P -c "insert into obligation_payments(obligation_id,amount,paid_on,transaction_id) values('$OBL',$B,'2026-09-01','$TX2');" >/dev/null 2>&1 ) &
  wait
else
  ( q "select obligation_allocate('$OBL','$TX1',100000);" >/dev/null 2>&1 ) &
  ( q "select obligation_allocate('$OBL','$TX2',100000);" >/dev/null 2>&1 ) &
  wait
fi
d=$($P -c "select case when paid <= amount then 'ok' else 'overpaid '||paid||'>'||amount end from obligation_balances where id='$OBL';")
check T4 ok "$d" "обязательство: переплата невозможна при двух параллельных разнесениях"

# ---------------------------------------------------------------- T5
reset
if [ "$MODE" = pre ]; then
  $P -c "insert into invoices(team_id,number,project_id,amount) values('$T','KO-126-INV-01','$PRJ',1000);" >/dev/null
  gen(){ N=$($P -c "select coalesce(max((regexp_match(number,'^KO-126-INV-(\d+)$'))[1]::int),0)+1 from invoices where team_id='$T' and number like 'KO-126-INV-%';")
         sleep 0.4
         $P -c "insert into invoices(team_id,number,project_id,amount) values('$T','KO-126-INV-'||lpad('$N',2,'0'),'$PRJ',$1);" >/dev/null 2>&1; }
  gen 500 & gen 900 & wait
else
  mk(){ q "select invoice_save(jsonb_build_object('team_id','$T','project_id','$PRJ','buyer_name','X','items',jsonb_build_array(jsonb_build_object('name','a','quantity',1,'price',$1))));" >/dev/null 2>&1; }
  mk 1000; mk 500 & mk 900 & wait
fi
d=$($P -c "select count(distinct number)||'/'||count(*) from invoices where project_id='$PRJ';")
check T5 "3/3" "$d" "номер инвойса: у трёх инвойсов три разных номера"

# ---------------------------------------------------------------- T6
reset
if [ "$MODE" = pre ]; then
  imp(){ $P -c "select count(*) from transactions where team_id='$T' and source='tochka' and external_id in ($1);" >/dev/null
         sleep 0.4
         V=$(echo "$1" | tr -d "'" | tr ',' '\n' | awk -v t=$T -v a=$ACC_A '{printf "(\047%s\047,\047expense\047,1000,\047RUB\047,\047%s\047,\0472026-09-01\047,\047tochka\047,\047%s\047),",t,a,$0}' | sed 's/,$//')
         $P -c "insert into transactions(team_id,type,amount,currency,account_id,occurred_on,source,external_id) values $V;" >/dev/null 2>&1; }
  imp "'e1','e2'" & imp "'e2','e3'" & wait
else
  imp(){ q "select bank_import_commit('$T'::uuid,'{\"file_name\":\"Точка\",\"bank\":\"tochka\"}'::jsonb,'$1'::jsonb);" >/dev/null 2>&1; }
  R1="[{\"type\":\"expense\",\"amount\":1000,\"currency\":\"RUB\",\"account_id\":\"$ACC_A\",\"occurred_on\":\"2026-09-01\",\"external_id\":\"e1\",\"provider\":\"tochka\",\"origin\":\"bank\"},{\"type\":\"expense\",\"amount\":1000,\"currency\":\"RUB\",\"account_id\":\"$ACC_A\",\"occurred_on\":\"2026-09-02\",\"external_id\":\"e2\",\"provider\":\"tochka\",\"origin\":\"bank\"}]"
  R2="[{\"type\":\"expense\",\"amount\":1000,\"currency\":\"RUB\",\"account_id\":\"$ACC_A\",\"occurred_on\":\"2026-09-02\",\"external_id\":\"e2\",\"provider\":\"tochka\",\"origin\":\"bank\"},{\"type\":\"expense\",\"amount\":1000,\"currency\":\"RUB\",\"account_id\":\"$ACC_A\",\"occurred_on\":\"2026-09-03\",\"external_id\":\"e3\",\"provider\":\"tochka\",\"origin\":\"bank\"}]"
  imp "$R1" & imp "$R2" & wait
fi
d=$($P -c "select coalesce(string_agg(distinct external_id,',' order by external_id),'(нет)') from transactions;")
check T6 "e1,e2,e3" "$d" "импорт: конфликт по одному событию не теряет остальные"

# ---------------------------------------------------------------- T7
$P -c "update bank_connections set last_synced_at = now() - interval '5 hours';" >/dev/null
if [ "$MODE" = pre ]; then
  sync(){ AGE=$($P -c "select extract(epoch from (now()-last_synced_at))/60 from bank_connections where team_id='$T' and provider='tochka';")
          FRESH=$($P -c "select case when $AGE < 120 then 'fresh' else 'stale' end;")
          sleep 0.3
          if [ "$FRESH" = "stale" ]; then
            $P -c "update bank_connections set last_synced_at=now() where team_id='$T' and provider='tochka';" >/dev/null; echo run
          fi; }
  R=$( { sync & sync & wait; } | grep -c run )
else
  R=$( { ( q "select bank_sync_claim('$T','tochka');" ) & ( q "select bank_sync_claim('$T','tochka');" ) & wait; } | grep -c '^t$' )
fi
check T7 1 "$R" "тротлинг синка: импорт запускает ровно одна сессия"

# ---------------------------------------------------------------- T8
reset
TX=$($P -c "insert into transactions(team_id,type,amount,currency,account_id,occurred_on,note) values('$T','expense',100000,'RUB','$ACC_A','2026-09-01','исходная') returning id;")
if [ "$MODE" = pre ]; then
  ( sleep 0.1; $P -c "update transactions set amount=100000, note='комментарий Пети', category_id=null where id='$TX';" >/dev/null ) &
  ( sleep 0.4; $P -c "update transactions set amount=100000, note=null, category_id='$CAT' where id='$TX';" >/dev/null ) &
  wait
  CONF=0
else
  V=$($P -c "select version from transactions where id='$TX';")
  ( sleep 0.1; q "select transaction_save('$TX', jsonb_build_object('note','комментарий Пети'), $V);" >/dev/null ) &
  sleep 0.25
  R2=$(q "select (transaction_save('$TX', jsonb_build_object('note',null,'category_id','$CAT'), $V))->>'conflict';")
  wait
  CONF=$([ "$R2" = "true" ] && echo 1 || echo 0)
fi
d=$($P -c "select coalesce(note,'(null)') from transactions where id='$TX';")
if [ "$MODE" = pre ]; then
  check T8 "комментарий Пети" "$d" "правка операции: первая правка не затёрта молча"
else
  check T8 "комментарий Пети|1" "$d|$CONF" "правка операции: вторая получила conflict, первая сохранена"
fi

# ---------------------------------------------------------------- T9
reset
SRC=$($P -c "insert into transactions(team_id,type,amount,currency,account_id,occurred_on) values('$T','expense',100000,'RUB','$ACC_A','2026-09-01') returning id;")
if [ "$MODE" = pre ]; then
  $P -c "insert into transactions(team_id,type,amount,currency,account_id,occurred_on) values('$T','expense',60000,'RUB','$ACC_A','2026-09-01'),('$T','expense',40000,'RUB','$ACC_A','2026-09-01');" >/dev/null
  $P -c "delete from transactions where id='$SRC' and 1=0;" >/dev/null   # удаление «потерялось»
else
  q "select transaction_split('$SRC', jsonb_build_array(jsonb_build_object('amount',60000), jsonb_build_object('amount',40000)));" >/dev/null 2>&1
fi
d=$($P -c "select sum(amount)||'/'||count(*) from transactions;")
check T9 "100000/2" "$d" "разбиение операции: сумма не задвоилась"

# ---------------------------------------------------------------- T10 (FIN-03)
reset
CSV_ROW="[{\"type\":\"transfer\",\"amount\":100000,\"currency\":\"RUB\",\"account_id\":\"$ACC_A\",\"transfer_account_id\":\"$ACC_B\",\"occurred_on\":\"2025-01-14\",\"note\":\"Отчисление в фонд Развитие с операции на сумму 20 000 RUB\",\"origin\":\"bank_csv\"}]"
# note у банка длиннее: добавлен служебный хвост через '·' — нормализация обязана
# привести оба варианта к одному отпечатку (замер на проде: 130/130 пар)
BANK_ROW="[{\"type\":\"transfer\",\"amount\":100000,\"currency\":\"RUB\",\"account_id\":\"$ACC_A\",\"transfer_account_id\":\"$ACC_B\",\"occurred_on\":\"2025-01-14\",\"note\":\"Отчисление в фонд Развитие с операции на сумму 20 000 RUB · Платежное поручение №868534\",\"external_id\":\"cbs-1\",\"provider\":\"tochka\",\"provider_account\":\"40802810520000183872\",\"origin\":\"bank\"}]"
if [ "$MODE" = pre ]; then
  # как было: CSV писал перевод двумя строками, Точка — третьей
  $P -c "insert into transactions(team_id,type,amount,currency,account_id,occurred_on,note) values
          ('$T','expense',100000,'RUB','$ACC_A','2025-01-14','Отчисление в фонд'),
          ('$T','income',100000,'RUB','$ACC_B','2025-01-14','Отчисление в фонд');" >/dev/null
  $P -c "insert into transactions(team_id,type,amount,currency,account_id,transfer_account_id,occurred_on,note,source,external_id)
         values('$T','transfer',100000,'RUB','$ACC_A','$ACC_B','2025-01-14','Отчисление в фонд','tochka','cbs-1');" >/dev/null
else
  q "select bank_import_commit('$T'::uuid,'{\"file_name\":\"svodnaya.csv\",\"bank\":\"Сводная выписка\"}'::jsonb,'$CSV_ROW'::jsonb);" >/dev/null
  q "select bank_import_commit('$T'::uuid,'{\"file_name\":\"Точка\",\"bank\":\"tochka\"}'::jsonb,'$BANK_ROW'::jsonb);" >/dev/null
fi
d=$($P -c "select count(*)||' строк, оборот '||sum(amount) from transactions;")
check T10 "1 строк, оборот 100000" "$d" "CSV → синк Точки того же периода: событие ровно один раз"

# ---------------------------------------------------------------- T11 (FIN-03 обратный порядок)
reset
if [ "$MODE" = pre ]; then
  $P -c "insert into transactions(team_id,type,amount,currency,account_id,transfer_account_id,occurred_on,note,source,external_id)
         values('$T','transfer',100000,'RUB','$ACC_A','$ACC_B','2025-01-14','Отчисление в фонд','tochka','cbs-2');" >/dev/null
  $P -c "insert into transactions(team_id,type,amount,currency,account_id,occurred_on,note) values
          ('$T','expense',100000,'RUB','$ACC_A','2025-01-14','Отчисление в фонд'),
          ('$T','income',100000,'RUB','$ACC_B','2025-01-14','Отчисление в фонд');" >/dev/null
else
  q "select bank_import_commit('$T'::uuid,'{\"file_name\":\"Точка\",\"bank\":\"tochka\"}'::jsonb,'${BANK_ROW//cbs-1/cbs-2}'::jsonb);" >/dev/null
  q "select bank_import_commit('$T'::uuid,'{\"file_name\":\"svodnaya.csv\",\"bank\":\"Сводная выписка\"}'::jsonb,'$CSV_ROW'::jsonb);" >/dev/null
fi
d=$($P -c "select count(*)||' строк, оборот '||sum(amount) from transactions;")
check T11 "1 строк, оборот 100000" "$d" "синк Точки → CSV того же периода: событие ровно один раз"

# ---------------------------------------------------------------- T12
# Две РАЗНЫЕ реальные операции: тот же счёт/дата/сумма, но разные назначение и
# контрагент. Отпечаток обязан их различить, а при неоднозначности — не дропать.
# Замер на проде: 537 групп слабого отпечатка коллизируют, 446 из них содержат
# 2+ разных provider id, то есть это заведомо разные события.
reset
CP2=$($P -c "insert into counterparties(team_id,name,kind) values('$T','Другой контрагент','supplier') returning id;")
if [ "$MODE" = pre ]; then
  $P -c "insert into transactions(team_id,type,amount,currency,account_id,occurred_on,note,counterparty_id,source,external_id) values
          ('$T','expense',5000,'RUB','$ACC_A','2026-09-10','Оплата А','$CP','tochka','x1');" >/dev/null
  $P -c "insert into transactions(team_id,type,amount,currency,account_id,occurred_on,note,counterparty_id,source,external_id) values
          ('$T','expense',5000,'RUB','$ACC_A','2026-09-10','Оплата Б','$CP2','tochka','x2');" >/dev/null
else
  R="[{\"type\":\"expense\",\"amount\":5000,\"currency\":\"RUB\",\"account_id\":\"$ACC_A\",\"occurred_on\":\"2026-09-10\",\"note\":\"Оплата А\",\"counterparty_id\":\"$CP\",\"external_id\":\"x1\",\"provider\":\"tochka\",\"origin\":\"bank\"}]"
  q "select bank_import_commit('$T'::uuid,'{\"file_name\":\"Точка\"}'::jsonb,'$R'::jsonb);" >/dev/null
  R2="[{\"type\":\"expense\",\"amount\":5000,\"currency\":\"RUB\",\"account_id\":\"$ACC_A\",\"occurred_on\":\"2026-09-10\",\"note\":\"Оплата Б\",\"counterparty_id\":\"$CP2\",\"external_id\":\"x2\",\"provider\":\"tochka\",\"origin\":\"bank\"}]"
  q "select bank_import_commit('$T'::uuid,'{\"file_name\":\"Точка\"}'::jsonb,'$R2'::jsonb);" >/dev/null
fi
d=$($P -c "select count(*)||' строк, оборот '||sum(amount) from transactions;")
check T12 "2 строк, оборот 10000" "$d" "две разные операции (разные назначение/контрагент) сохранены обе"

# ---------------------------------------------------------------- T13
# То же событие из CSV и из Точки, но описание различается служебным хвостом
# («· Платежное поручение №…»). Нормализация обязана свести их к одной операции.
reset
if [ "$MODE" = pre ]; then
  $P -c "insert into transactions(team_id,type,amount,currency,account_id,occurred_on,note) values
          ('$T','expense',7700,'RUB','$ACC_A','2026-09-11','Оплата услуг связи');" >/dev/null
  $P -c "insert into transactions(team_id,type,amount,currency,account_id,occurred_on,note,source,external_id) values
          ('$T','expense',7700,'RUB','$ACC_A','2026-09-11','Оплата услуг связи · Платежное поручение №12345','tochka','y1');" >/dev/null
else
  CSV2="[{\"type\":\"expense\",\"amount\":7700,\"currency\":\"RUB\",\"account_id\":\"$ACC_A\",\"occurred_on\":\"2026-09-11\",\"note\":\"Оплата услуг связи\",\"origin\":\"bank_csv\"}]"
  BNK2="[{\"type\":\"expense\",\"amount\":7700,\"currency\":\"RUB\",\"account_id\":\"$ACC_A\",\"occurred_on\":\"2026-09-11\",\"note\":\"Оплата услуг связи · Платежное поручение №12345\",\"external_id\":\"y1\",\"provider\":\"tochka\",\"origin\":\"bank\"}]"
  q "select bank_import_commit('$T'::uuid,'{\"file_name\":\"svodnaya.csv\"}'::jsonb,'$CSV2'::jsonb);" >/dev/null
  q "select bank_import_commit('$T'::uuid,'{\"file_name\":\"Точка\"}'::jsonb,'$BNK2'::jsonb);" >/dev/null
fi
d=$($P -c "select count(*)||' строк, оборот '||sum(amount) from transactions;")
check T13 "1 строк, оборот 7700" "$d" "описание с разным служебным хвостом: событие схлопнулось в одно"

# ---------------------------------------------------------------- T14
# КРИТИЧЕСКИЙ тест против silent drop. Две РАЗНЫЕ операции провайдера с
# ПОЛНОСТЬЮ совпадающим отпечатком (тот же счёт/дата/сумма/валюта/направление,
# тот же контрагент, то же описание) — на проде такие есть: два вывода Bybit
# одного дня, bybit-wd-226074267 и bybit-wd-226100544. Приходят двумя разными
# вызовами импорта. Обе обязаны сохраниться; неоднозначность — в журнал сверки.
reset
if [ "$MODE" = pre ]; then
  $P -c "insert into transactions(team_id,type,amount,currency,account_id,occurred_on,note,source,external_id) values
          ('$T','expense',1000,'USDT','$ACC_A','2026-05-13','Bybit вывод USDT','bybit','wd-1');" >/dev/null
  $P -c "insert into transactions(team_id,type,amount,currency,account_id,occurred_on,note,source,external_id) values
          ('$T','expense',1000,'USDT','$ACC_A','2026-05-13','Bybit вывод USDT','bybit','wd-2');" >/dev/null
else
  mk(){ echo "[{\"type\":\"expense\",\"amount\":1000,\"currency\":\"USDT\",\"account_id\":\"$ACC_A\",\"occurred_on\":\"2026-05-13\",\"note\":\"Bybit вывод USDT\",\"external_id\":\"$1\",\"provider\":\"bybit\",\"origin\":\"bank\"}]"; }
  q "select bank_import_commit('$T'::uuid,'{\"file_name\":\"Bybit\"}'::jsonb,'$(mk wd-1)'::jsonb);" >/dev/null
  q "select bank_import_commit('$T'::uuid,'{\"file_name\":\"Bybit\"}'::jsonb,'$(mk wd-2)'::jsonb);" >/dev/null
fi
n=$($P -c "select count(*) from transactions;")
c=$($P -c "select count(*) from bank_reconciliation_conflicts;" 2>/dev/null || echo 0)
if [ "$MODE" = pre ]; then
  check T14 "2" "$n" "два разных события провайдера с одинаковым отпечатком сохранены оба"
else
  check T14 "2|1" "$n|$c" "два разных события провайдера с одинаковым отпечатком сохранены оба + conflict заведён"
fi

echo "---------------------------------------------------"
echo "MODE=$MODE: PASS=$pass FAIL=$fail"
[ "$fail" = 0 ]
