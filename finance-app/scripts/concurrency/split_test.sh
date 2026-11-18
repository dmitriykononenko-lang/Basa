#!/usr/bin/env bash
# ============================================================================
# split_test.sh — бизнес-сценарий «одна банковская операция разнесена на
# несколько проектов / сотрудников / статей».
#
# ВАЖНО о терминологии: в приложении два РАЗНЫХ механизма.
#   (1) «Части операции» — transaction_splits. Операция остаётся ОДНОЙ строкой,
#       части лежат отдельной таблицей и несут свои project_id/counterparty_id/
#       category_id. Это и есть механизм из бизнес-требования.
#   (2) «Разбить операцию» — SplitTransactionModal: исходная операция
#       ЗАМЕНЯЕТСЯ на N отдельных операций (это тест T9, другая функция).
# Здесь проверяется механизм (1).
#
# Сценарий: 100 000 → 60/40 (разные проекты, контрагенты, статьи)
#           → изменение на 25/75 → повторный синк банка → параллельная правка.
# MODE=pre — как в production сейчас; MODE=post — с миграциями 0086–0091.
# ============================================================================
set -u
BASE=${BASE:-/var/tmp/pgaudit}
MODE=${MODE:-post}
DB=${DB:-t_$MODE}
P="psql -h $BASE -p 5433 -U audit -d $DB -qtA"
T=11111111-1111-1111-1111-111111111111
U1=aaaaaaaa-0000-0000-0000-000000000001
U2=aaaaaaaa-0000-0000-0000-000000000002
ACC=a0000000-0000-0000-0000-000000000001
pass=0; fail=0
q(){ $P -c "set test.uid='${2:-$U1}'; $1" 2>&1; }
check(){ if [ "$2" = "$3" ]; then printf '  %-5s PASS  %s\n' "$1" "$4"; pass=$((pass+1));
         else printf '  %-5s FAIL  %s — ожидалось [%s], получено [%s]\n' "$1" "$4" "$2" "$3"; fail=$((fail+1)); fi; }

echo "=============== SPLIT MODE=$MODE (db=$DB) ==============="
$P -c "delete from transaction_splits; delete from transactions;" >/dev/null 2>&1
$P -c "delete from bank_reconciliation_conflicts;" >/dev/null 2>&1
$P -c "delete from operation_requests;" >/dev/null 2>&1

# справочники: два проекта, два контрагента, две статьи
PA=$($P -c "insert into projects(team_id,name) values('$T','Проект A') returning id;")
PB=$($P -c "insert into projects(team_id,name) values('$T','Проект B') returning id;")
CA=$($P -c "insert into counterparties(team_id,name,kind) values('$T','Исполнитель A','employee') returning id;")
CB=$($P -c "insert into counterparties(team_id,name,kind) values('$T','Исполнитель B','employee') returning id;")
KA=$($P -c "insert into categories(team_id,name,kind,cf_activity) values('$T','Статья A','expense','operating') returning id;")
KB=$($P -c "insert into categories(team_id,name,kind,cf_activity) values('$T','Статья B','expense','operating') returning id;")

# остаток счёта ДО появления операции — база для проверки «деньги учтены один раз»
BAL0=$($P -c "select balance from account_balances where account_id='$ACC';")

# исходная банковская операция 100 000,00
TX=$($P -c "insert into transactions(team_id,type,amount,currency,account_id,occurred_on,note,source,external_id,status)
            values('$T','expense',10000000,'RUB','$ACC','2026-09-15','Оплата подрядчикам','tochka','split-1','actual') returning id;")
$P -c "update transactions set bank_provider='tochka', bank_provider_tx_id='split-1' where id='$TX';" >/dev/null 2>&1

parts(){ # $1,$2 = суммы частей
  echo "[{\"amount\":$1,\"project_id\":\"$PA\",\"counterparty_id\":\"$CA\",\"category_id\":\"$KA\"},
        {\"amount\":$2,\"project_id\":\"$PB\",\"counterparty_id\":\"$CB\",\"category_id\":\"$KB\"}]"
}
save_parts(){ # $1,$2 суммы; $3 версия; $4 пользователь
  if [ "$MODE" = pre ]; then
    $P -c "delete from transaction_splits where transaction_id='$TX';" >/dev/null
    $P -c "insert into transaction_splits(team_id,transaction_id,amount,project_id,counterparty_id,category_id)
           values('$T','$TX',$1,'$PA','$CA','$KA'),('$T','$TX',$2,'$PB','$CB','$KB');" 2>&1 | head -1
  else
    q "select transaction_save('$TX', '{}'::jsonb, ${3:-null}, '$(parts "$1" "$2")'::jsonb, gen_random_uuid());" "${4:-$U1}" | head -1
  fi
}

# ── S1. разнесение 60/40 ────────────────────────────────────────────────────
save_parts 6000000 4000000 >/dev/null
d=$($P -c "select count(*)||'/'||sum(amount) from transaction_splits where transaction_id='$TX';")
check S1 "2/10000000" "$d" "100 000 разнесено на две части, сумма частей = сумме операции"

d=$($P -c "select count(*) from transactions where id='$TX';")
check S1b "1" "$d" "для пользователя это по-прежнему ОДНА исходная операция"

# ── S2. аналитика по проектам / исполнителям / статьям ─────────────────────
# Правило агрегации в отчётах: если у операции есть части — берутся ЧАСТИ
# вместо строки целиком (reports/pnl/page.tsx:158-176, cashflow:139-147).
# В post-режиме спрашиваем САМО каноническое представление transaction_lines —
# то, что реально читают страницы. В pre-режиме представления в схеме нет,
# поэтому правило выписано вручную.
agg(){
  if [ "$MODE" = post ]; then
    $P -c "select coalesce(sum(amount),0) from transaction_lines
            where status='actual' and ($(echo "$1" | sed 's/\bprj\b/project_id/g; s/\bcp\b/counterparty_id/g; s/\bcat\b/category_id/g'));"
  else
    $P -c "with lines as (
                select coalesce(s.project_id, t.project_id) prj, coalesce(s.counterparty_id, t.counterparty_id) cp,
                       coalesce(s.category_id, t.category_id) cat, coalesce(s.amount, t.amount) amt
                  from transactions t
                  left join transaction_splits s on s.transaction_id = t.id
                 where t.status='actual')
              select coalesce(sum(amt),0) from lines where $1;"
  fi
}
check S2a "6000000" "$(agg "prj='$PA'")" "Проект A получил 60 000"
check S2b "4000000" "$(agg "prj='$PB'")" "Проект B получил 40 000"
check S2c "6000000" "$(agg "cp='$CA'")"  "Исполнитель A получил 60 000"
check S2d "4000000" "$(agg "cp='$CB'")"  "Исполнитель B получил 40 000"
check S2e "6000000" "$(agg "cat='$KA'")" "Статья A получила 60 000"
check S2f "4000000" "$(agg "cat='$KB'")" "Статья B получила 40 000"
check S2g "10000000" "$(agg "true")"     "ОПиУ/ДДС видят 100 000, а не 200 000"

# ── S3. движение денег учтено ровно один раз ───────────────────────────────
BAL1=$($P -c "select balance from account_balances where account_id='$ACC';")
check S3 "-10000000" "$((BAL1 - BAL0))" "остаток счёта изменился ровно на 100 000 один раз"

# ── S4. связь каждой части с исходной операцией ────────────────────────────
d=$($P -c "select count(*) from transaction_splits s where s.transaction_id='$TX' and exists(select 1 from transactions t where t.id=s.transaction_id);")
check S4 "2" "$d" "каждая часть связана с исходной банковской операцией"

# ── S5. изменение 60/40 → 25/75 ────────────────────────────────────────────
V=$($P -c "select coalesce(version,1) from transactions where id='$TX';" 2>/dev/null || echo "null")
save_parts 2500000 7500000 "$V" >/dev/null
d=$($P -c "select count(*)||'/'||sum(amount) from transaction_splits where transaction_id='$TX';")
check S5 "2/10000000" "$d" "после правки — две части, сумма по-прежнему 100 000"
d=$($P -c "select count(*) from transaction_splits where transaction_id='$TX' and amount in (6000000,4000000);")
check S5b "0" "$d" "старые значения 60/40 не остались"
check S5c "2500000" "$(agg "prj='$PA'")" "Проект A пересчитан в 25 000"
check S5d "7500000" "$(agg "prj='$PB'")" "Проект B пересчитан в 75 000"
check S5e "10000000" "$(agg "true")" "итог по-прежнему 100 000 (нет double counting)"
BAL2=$($P -c "select balance from account_balances where account_id='$ACC';")
check S5f "-10000000" "$((BAL2 - BAL0))" "остаток счёта не изменился от правки разнесения"

# ── S6. повторный синк банка не уничтожает ручное разнесение ───────────────
ROW="[{\"type\":\"expense\",\"amount\":10000000,\"currency\":\"RUB\",\"account_id\":\"$ACC\",\"occurred_on\":\"2026-09-15\",\"note\":\"Оплата подрядчикам\",\"external_id\":\"split-1\",\"provider\":\"tochka\",\"origin\":\"bank\"}]"
if [ "$MODE" = pre ]; then
  # как было: клиентский дедуп по (source, external_id) — строка не вставится,
  # но никакой гарантии в схеме нет; проверяем фактический результат
  EX=$($P -c "select count(*) from transactions where team_id='$T' and source='tochka' and external_id='split-1';")
  [ "$EX" = "0" ] && $P -c "insert into transactions(team_id,type,amount,currency,account_id,occurred_on,note,source,external_id,status) values('$T','expense',10000000,'RUB','$ACC','2026-09-15','Оплата подрядчикам','tochka','split-1','actual');" >/dev/null
else
  q "select bank_import_commit('$T'::uuid,'{\"file_name\":\"Точка\"}'::jsonb,'$ROW'::jsonb);" >/dev/null
fi
d=$($P -c "select (select count(*) from transactions where external_id='split-1')||'/'||
                  (select count(*) from transaction_splits where transaction_id='$TX')||'/'||
                  (select coalesce(sum(amount),0) from transaction_splits where transaction_id='$TX');")
check S6 "1/2/10000000" "$d" "повторный синк: операция одна, разнесение 25/75 на месте"
check S6b "2500000" "$(agg "prj='$PA'")" "после синка аналитика проекта A не потерялась"

# ── S7. параллельная правка разнесения двумя пользователями ────────────────
if [ "$MODE" = post ]; then
  V=$($P -c "select version from transactions where id='$TX';")
  ( q "select transaction_save('$TX','{}'::jsonb,$V,'[{\"amount\":1000000,\"project_id\":\"$PA\"},{\"amount\":9000000,\"project_id\":\"$PB\"}]'::jsonb, gen_random_uuid());" "$U1" >/dev/null ) &
  sleep 0.3
  R=$(q "select (transaction_save('$TX','{}'::jsonb,$V,'[{\"amount\":5000000,\"project_id\":\"$PA\"},{\"amount\":5000000,\"project_id\":\"$PB\"}]'::jsonb, gen_random_uuid()))->>'conflict';" "$U2")
  wait
  check S7 "true" "$(echo "$R" | tail -1)" "второй редактор получил conflict, а не тихую перезапись"
  d=$($P -c "select count(*)||'/'||sum(amount) from transaction_splits where transaction_id='$TX';")
  check S7b "2/10000000" "$d" "разнесение осталось консистентным (сумма = операции)"
  d=$($P -c "select count(*) from transaction_splits where transaction_id='$TX' and amount=5000000;")
  check S7c "0" "$d" "правка проигравшего не применилась частично"
else
  ( $P -c "delete from transaction_splits where transaction_id='$TX';" >/dev/null
    sleep 0.4
    $P -c "insert into transaction_splits(team_id,transaction_id,amount,project_id) values('$T','$TX',1000000,'$PA'),('$T','$TX',9000000,'$PB');" >/dev/null 2>&1 ) &
  sleep 0.2
  ( $P -c "delete from transaction_splits where transaction_id='$TX';" >/dev/null
    $P -c "insert into transaction_splits(team_id,transaction_id,amount,project_id) values('$T','$TX',5000000,'$PA'),('$T','$TX',5000000,'$PB');" >/dev/null 2>&1 ) &
  wait
  d=$($P -c "select count(*)||'/'||coalesce(sum(amount),0) from transaction_splits where transaction_id='$TX';")
  check S7 "2/10000000" "$d" "параллельная правка не сломала сумму частей"
fi

# ── S8. попытка сохранить части, не равные сумме операции ──────────────────
if [ "$MODE" = post ]; then
  r=$(q "select transaction_save('$TX','{}'::jsonb,null,'[{\"amount\":1000000},{\"amount\":1000000}]'::jsonb, gen_random_uuid());" | head -1)
  case "$r" in *"не равна"*|*"23514"*|*"ERROR"*) o=rejected;; *) o="ALLOWED: $r";; esac
else
  $P -c "delete from transaction_splits where transaction_id='$TX';" >/dev/null
  r=$($P -c "insert into transaction_splits(team_id,transaction_id,amount) values('$T','$TX',1000000),('$T','$TX',1000000);" 2>&1)
  case "$r" in *ERROR*) o=rejected;; *) o="ALLOWED";; esac
  $P -c "delete from transaction_splits where transaction_id='$TX';" >/dev/null
  $P -c "insert into transaction_splits(team_id,transaction_id,amount,project_id) values('$T','$TX',2500000,'$PA'),('$T','$TX',7500000,'$PB');" >/dev/null
fi
check S8 rejected "$o" "части, не равные сумме операции, не сохраняются"

# ── S9. потребители аналитики: те же запросы, что делают страницы ──────────
# Восстанавливаем состояние 25/75 со всеми измерениями: предыдущие тесты
# (параллельная правка) намеренно оставили части без контрагента и статьи.
if [ "$MODE" = post ]; then
  V=$($P -c "select version from transactions where id='$TX';")
  save_parts 2500000 7500000 "$V" >/dev/null
fi
if [ "$MODE" = post ]; then
  # projects/[id]: выручка/затраты проекта
  d=$($P -c "select coalesce(sum(amount),0) from transaction_lines where status='actual' and project_id='$PA' and type='expense';")
  check S9a "2500000" "$d" "страница проекта A: затраты 25 000"
  # employees/[id] и counterparties/[id]: фактические выплаты по контрагенту
  d=$($P -c "select coalesce(sum(amount),0) from transaction_lines where status='actual' and counterparty_id='$CB' and type='expense';")
  check S9b "7500000" "$d" "карточка исполнителя B: выплаты 75 000"
  # budgets и dashboard: расходы по статье
  d=$($P -c "select coalesce(sum(amount),0) from transaction_lines where status='actual' and type='expense' and category_id='$KA';")
  check S9c "2500000" "$d" "бюджеты/дашборд: статья A = 25 000"
  # reports: итог периода
  d=$($P -c "select coalesce(sum(amount),0) from transaction_lines where status='actual' and type='expense';")
  check S9d "10000000" "$d" "отчёты: итог расходов 100 000 (не 200 000)"
  # реестр операций проекта/контрагента: одна исходная операция
  d=$($P -c "select count(distinct transaction_id) from transaction_lines where status='actual' and project_id='$PA';")
  check S9e "1" "$d" "в реестре проекта A — одна исходная операция"
  # инвариант представления: сумма строк каждой операции = её сумме
  d=$($P -c "select count(*) from (select transaction_id, sum(amount) s, max(transaction_amount) a from transaction_lines group by transaction_id having sum(amount) <> max(transaction_amount)) z;")
  check S9f "0" "$d" "Σ строк = сумме операции для КАЖДОЙ операции"
fi

# ── S11. разнесение НЕ создаёт второго начисления/обязательства ───────────
# Разнесение фактической оплаты и начисление обязательства — разные
# экономические события. Части операции живут в transaction_splits и на
# obligations/obligation_payments не влияют вообще.
OBLN=$($P -c "select count(*) from obligations;")
PAYN=$($P -c "select count(*) from obligation_payments;")
if [ "$MODE" = post ]; then
  V=$($P -c "select version from transactions where id='$TX';")
  save_parts 3000000 7000000 "$V" >/dev/null
else
  save_parts 3000000 7000000 >/dev/null
fi
d=$($P -c "select (select count(*) from obligations)||'/'||(select count(*) from obligation_payments);")
check S11 "$OBLN/$PAYN" "$d" "правка разнесения не создала начислений и разнесений по обязательствам"
if [ "$MODE" = post ]; then
  V=$($P -c "select version from transactions where id='$TX';")
  save_parts 2500000 7500000 "$V" >/dev/null
else
  save_parts 2500000 7500000 >/dev/null
fi

# ── S10. полное снятие разнесения → fallback к исходной операции ───────────
if [ "$MODE" = post ]; then
  V=$($P -c "select version from transactions where id='$TX';")
  q "select transaction_save('$TX','{\"project_id\":\"$PA\",\"counterparty_id\":\"$CA\",\"category_id\":\"$KA\"}'::jsonb,$V,'[]'::jsonb, gen_random_uuid());" >/dev/null
else
  $P -c "delete from transaction_splits where transaction_id='$TX';" >/dev/null
  $P -c "update transactions set project_id='$PA', counterparty_id='$CA', category_id='$KA' where id='$TX';" >/dev/null
fi
d=$($P -c "select count(*) from transaction_splits where transaction_id='$TX';")
check S10 "0" "$d" "разнесение снято"
check S10a "10000000" "$(agg "prj='$PA'")" "fallback: проект A получил всю операцию 100 000"
check S10b "0" "$(agg "prj='$PB'")" "fallback: у проекта B не осталось старых 75 000"
check S10c "10000000" "$(agg "cp='$CA'")" "fallback: исполнитель A получил 100 000"
check S10d "10000000" "$(agg "true")" "fallback: итог по-прежнему 100 000"
BAL3=$($P -c "select balance from account_balances where account_id='$ACC';")
check S10e "-10000000" "$((BAL3 - BAL0))" "fallback: движение денег по-прежнему учтено один раз"

echo "---------------------------------------------------"
echo "SPLIT MODE=$MODE: PASS=$pass FAIL=$fail"
[ "$fail" = 0 ]
