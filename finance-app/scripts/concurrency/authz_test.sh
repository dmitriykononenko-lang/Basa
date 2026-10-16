#!/usr/bin/env bash
# ============================================================================
# authz_test.sh — проверка авторизации SECURITY DEFINER функций.
# MODE=pre  — схема как в production сейчас;
# MODE=post — с миграциями 0086–0091.
# Проверяется: пользователь команды A не может ничего сделать с объектами
# команды B, посторонний (не участник) не может ничего, viewer не может писать.
# Ожидание: отказ И отсутствие изменений в данных.
# ============================================================================
set -u
BASE=${BASE:-/var/tmp/pgaudit}
MODE=${MODE:-post}
DB=${DB:-t_$MODE}
P="psql -h $BASE -p 5433 -U audit -d $DB -qtA"
pass=0; fail=0
q(){ $P -c "set test.uid='$2'; $1" 2>&1 | head -2; }
check(){ if [ "$2" = "$3" ]; then printf '  %-26s PASS  %s\n' "$1" "$4"; pass=$((pass+1));
         else printf '  %-26s FAIL  %s — ожидалось [%s], получено [%s]\n' "$1" "$4" "$2" "$3"; fail=$((fail+1)); fi; }
denied(){ case "$1" in *"Недостаточно прав"*|*"не найден"*|*"не найдены"*|*"другой команды"*|*"разных команд"*|*forbidden*|*"permission denied"*) echo denied;; *) echo "ALLOWED: $1";; esac; }

echo "=============== AUTHZ MODE=$MODE (db=$DB) ==============="

# Команда A (есть в сиде) и команда B (создаём)
TA=11111111-1111-1111-1111-111111111111
UA=aaaaaaaa-0000-0000-0000-000000000001      # owner команды A
UOUT=00000000-0000-0000-0000-0000000000ff    # не состоит ни в одной команде
TB=$($P -c "insert into teams(name) values('Команда B') returning id;")
UB=bbbbbbbb-0000-0000-0000-000000000001
$P -c "insert into team_members values('$TB','$UB','owner');" >/dev/null
$P -c "insert into team_members values('$TB','cccccccc-0000-0000-0000-000000000001','viewer');" >/dev/null
UV=cccccccc-0000-0000-0000-000000000001      # viewer команды B
ACC_B=$($P -c "insert into accounts(team_id,name,currency) values('$TB','Счёт B','RUB') returning id;")
CP_B=$($P -c "insert into counterparties(team_id,name,kind) values('$TB','Контрагент B','supplier') returning id;")
OBL_B=$($P -c "insert into obligations(team_id,counterparty_id,type,amount,currency,status) values('$TB','$CP_B','payable',100000,'RUB','open') returning id;")
TX_B=$($P -c "insert into transactions(team_id,type,amount,currency,account_id,occurred_on,note) values('$TB','expense',100000,'RUB','$ACC_B','2026-09-01','операция B') returning id;")
INV_B=$($P -c "insert into invoices(team_id,number,buyer_name,amount) values('$TB','B-1','Покупатель B',1000) returning id;")
PRJ_B=$($P -c "insert into projects(team_id,name,type,status,bonus_amount,bonus_currency,responsible_counterparty_id) values('$TB','[900] Поддержка B','support','active',50000,'RUB','$CP_B') returning id;")
$P -c "insert into project_periods(project_id,period_month,period_start,period_end) values('$PRJ_B',date_trunc('month',current_date)::date, current_date - 40, current_date - 10);" >/dev/null

snapshot(){ $P -c "select (select count(*) from transactions where team_id='$TB')||'/'||
                          (select count(*) from obligation_payments p join obligations o on o.id=p.obligation_id where o.team_id='$TB')||'/'||
                          (select count(*) from invoice_items it where it.team_id='$TB')||'/'||
                          (select coalesce(sum(amount),0) from transactions where team_id='$TB')||'/'||
                          (select count(*) from project_periods where project_id='$PRJ_B');"; }
S0=$(snapshot)

if [ "$MODE" = post ]; then
  # ── новые финансовые RPC: владелец команды A против объектов команды B ──
  r=$(q "select public.invoice_save(jsonb_build_object('id','$INV_B','team_id','$TB','buyer_name','X','items',jsonb_build_array(jsonb_build_object('name','a','quantity',1,'price',999))));" "$UA")
  check "invoice_save (A→B)" denied "$(denied "$r")" "чужой инвойс не сохраняется"
  r=$(q "select public.obligation_allocate('$OBL_B','$TX_B',1000);" "$UA")
  check "obligation_allocate (A→B)" denied "$(denied "$r")" "чужое обязательство не разносится"
  r=$(q "select public.transaction_split('$TX_B', jsonb_build_array(jsonb_build_object('amount',60000),jsonb_build_object('amount',40000)));" "$UA")
  check "transaction_split (A→B)" denied "$(denied "$r")" "чужая операция не разбивается"
  r=$(q "select public.transaction_save('$TX_B', jsonb_build_object('note','взломано'), null);" "$UA")
  check "transaction_save (A→B)" denied "$(denied "$r")" "чужая операция не правится"
  r=$(q "select public.transaction_delete('$TX_B');" "$UA")
  check "transaction_delete (A→B)" denied "$(denied "$r")" "чужая операция не удаляется"
  r=$(q "select public.transactions_bulk_patch(array['$TX_B']::uuid[], jsonb_build_object('note','взломано'));" "$UA")
  check "bulk_patch (A→B)" denied "$(denied "$r")" "чужие операции не правятся массово"
  r=$(q "select public.transactions_convert_to_transfer(array['$TX_B']::uuid[], '$ACC_B');" "$UA")
  check "convert_to_transfer (A→B)" denied "$(denied "$r")" "чужая операция не превращается в перевод"
  r=$(q "select public.transaction_insert(jsonb_build_object('team_id','$TB','type','expense','amount',1,'occurred_on','2026-09-01'));" "$UA")
  check "transaction_insert (A→B)" denied "$(denied "$r")" "нельзя создать операцию в чужой команде"
  r=$(q "select public.bank_import_commit('$TB'::uuid,'{\"file_name\":\"x\"}'::jsonb,'[]'::jsonb);" "$UA")
  check "bank_import_commit (A→B)" denied "$(denied "$r")" "нельзя импортировать в чужую команду"
  r=$(q "select public.bank_sync_claim('$TB','tochka');" "$UA")
  check "bank_sync_claim (A→B)" "f" "$r" "нельзя захватить синк чужой команды"

  # ── посторонний (не участник ни одной команды) ──
  r=$(q "select public.transaction_save('$TX_B', jsonb_build_object('note','взломано'), null);" "$UOUT")
  check "transaction_save (аноним)" denied "$(denied "$r")" "не участник не правит операцию"
  r=$(q "select public.transaction_insert(jsonb_build_object('team_id','$TB','type','expense','amount',1,'occurred_on','2026-09-01'));" "$UOUT")
  check "transaction_insert (аноним)" denied "$(denied "$r")" "не участник не создаёт операцию"
  r=$(q "select public.is_service_role();" "$UOUT")
  check "is_service_role (аноним)" "f" "$r" "клиент не может притвориться service_role"

  # ── viewer своей же команды B: читать можно, писать нельзя ──
  r=$(q "select public.transaction_save('$TX_B', jsonb_build_object('note','viewer'), null);" "$UV")
  check "transaction_save (viewer B)" denied "$(denied "$r")" "viewer не правит операции"
  r=$(q "select public.obligation_allocate('$OBL_B','$TX_B',1000);" "$UV")
  check "obligation_allocate (viewer)" denied "$(denied "$r")" "viewer не разносит выплаты"
  r=$(q "select public.transactions_bulk_patch(array['$TX_B']::uuid[], jsonb_build_object('note','viewer'));" "$UV")
  check "bulk_patch (viewer B)" denied "$(denied "$r")" "viewer не правит массово"

  # ── can_modify_tx ──
  r=$(q "select public.can_modify_tx('$TX_B');" "$UA")
  check "can_modify_tx (A→B)" "f" "$r" "нет права на чужую операцию"
  r=$(q "select public.can_modify_tx('$TX_B');" "$UB")
  check "can_modify_tx (владелец B)" "t" "$r" "владелец команды может править свою операцию"

  # ── op_begin: нельзя занять ключ идемпотентности в чужой команде ──
  r=$(q "select public.op_begin('dddddddd-0000-0000-0000-000000000001','$TB','x');" "$UA")
  check "op_begin напрямую" "" "$(echo "$r" | grep -o 'permission denied' || echo '')" "op_begin не выдан клиенту (revoke)"
fi

# ── SEC-008: NULL-prone guard в существующих функциях production ──
r=$(q "select public.support_open_period('$PRJ_B');" "$UOUT")
case "$MODE" in
  pre)  check "SEC-008 support_open_period" "ALLOWED" "$(echo "$(denied "$r")" | cut -c1-7)" "до 0091: посторонний ПРОХОДИТ защиту (баг)";;
  post) check "SEC-008 support_open_period" denied "$(denied "$r")" "после 0091: посторонний получает отказ";;
esac

S1=$(snapshot)
check "данные команды B не изменились" "$S0" "$S1" "tx/разнесений/позиций/оборот/периодов"

echo "---------------------------------------------------"
echo "AUTHZ MODE=$MODE: PASS=$pass FAIL=$fail"
[ "$fail" = 0 ]
