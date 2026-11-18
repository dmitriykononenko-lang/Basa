#!/usr/bin/env bash
# ============================================================================
# split_prod_replay.sh — BEFORE/AFTER на РЕАЛЬНЫХ данных production.
#
# В disposable-БД воспроизводятся две существующие операции с разнесением
# (прочитаны из production только SELECT'ом 2026-09-23) и считается, что
# показывают потребители аналитики ДО и ПОСЛЕ SPLIT-01:
#   BEFORE — прежнее правило страниц: агрегировать сами transactions
#            по transactions.project_id / counterparty_id / category_id;
#   AFTER  — каноническое представление transaction_lines.
# Production не изменяется.
# ============================================================================
set -u
BASE=${BASE:-/var/tmp/pgaudit}
DB=${DB:-t_post}
P="psql -h $BASE -p 5433 -U audit -d $DB -qtA"
T=11111111-1111-1111-1111-111111111111
ACC=a0000000-0000-0000-0000-000000000001

echo "=============== SPLIT-01 BEFORE/AFTER на данных production ==============="
$P -c "delete from transaction_splits; delete from transactions;" >/dev/null 2>&1

# справочники под реальные имена
ASANA=$($P -c "insert into counterparties(team_id,name,kind) values('$T','Asana','supplier') returning id;")
SK=$($P -c "insert into counterparties(team_id,name,kind) values('$T','Станислав Кутишко','employee') returning id;")
P125=$($P -c "insert into projects(team_id,name) values('$T','[125] Re:clinic | Техническая поддержка') returning id;")
P126=$($P -c "insert into projects(team_id,name) values('$T','[126] Maison  development | Тех ведение CRM') returning id;")
CSV=$($P -c "insert into categories(team_id,name,kind,cf_activity) values('$T','Сервисы/связь','expense','operating') returning id;")
CBON=$($P -c "insert into categories(team_id,name,kind,cf_activity) values('$T','Выплата % / бонусы за проект','expense','operating') returning id;")

# ── Операция 1 (prod 42d431aa-41be-4d24-9661-6fb278380367): 50,00 USDT,
#    контрагент и статья у частей те же, что у операции ────────────────────
TX1=$($P -c "insert into transactions(team_id,type,amount,currency,account_id,occurred_on,note,counterparty_id,category_id,status)
             values('$T','expense',5000,'USDT','$ACC','2026-08-09','Bybit вывод USDT','$ASANA','$CSV','actual') returning id;")
$P -c "insert into transaction_splits(team_id,transaction_id,amount,counterparty_id,category_id)
       values('$T','$TX1',2600,'$ASANA','$CSV'),('$T','$TX1',2400,'$ASANA','$CSV');" >/dev/null

# ── Операция 2 (prod b7457804-2622-474d-af32-29bb80bc81cb): 200,00 USDT.
#    У самой операции НЕТ проекта и НЕТ контрагента; они есть только у частей ─
TX2=$($P -c "insert into transactions(team_id,type,amount,currency,account_id,occurred_on,note,category_id,status)
             values('$T','expense',20000,'USDT','$ACC','2026-09-22','Bybit перевод на UID 32089198','$CBON','actual') returning id;")
$P -c "insert into transaction_splits(team_id,transaction_id,amount,project_id,counterparty_id,category_id)
       values('$T','$TX2',10000,'$P125','$SK','$CBON'),('$T','$TX2',10000,'$P126','$SK','$CBON');" >/dev/null

money(){ awk -v v="$1" 'BEGIN{printf "%.2f", v/100}'; }
row(){ printf '  %-46s %12s → %12s  %s\n' "$1" "$(money "$2")" "$(money "$3")" "$4"; }

before(){ $P -c "select coalesce(sum(amount),0) from transactions where status='actual' and $1;"; }
after(){  $P -c "select coalesce(sum(amount),0) from transaction_lines where status='actual' and $1;"; }

echo
echo "  Потребитель / разрез                                 BEFORE →        AFTER   (USDT)"
echo "  ---------------------------------------------------------------------------------"
b=$(before "project_id='$P125'");      a=$(after "project_id='$P125'")
row "Проект [125] Re:clinic" "$b" "$a" "$([ "$a" = 10000 ] && echo OK || echo '!!')"
b=$(before "project_id='$P126'");      a=$(after "project_id='$P126'")
row "Проект [126] Maison development" "$b" "$a" "$([ "$a" = 10000 ] && echo OK || echo '!!')"
b=$(before "counterparty_id='$SK'");   a=$(after "counterparty_id='$SK'")
row "Сотрудник «Станислав Кутишко»" "$b" "$a" "$([ "$a" = 20000 ] && echo OK || echo '!!')"
b=$(before "counterparty_id='$ASANA'");a=$(after "counterparty_id='$ASANA'")
row "Контрагент «Asana»" "$b" "$a" "$([ "$a" = 5000 ] && echo OK || echo '!!')"
b=$(before "category_id='$CBON'");     a=$(after "category_id='$CBON'")
row "Статья «Выплата % / бонусы за проект»" "$b" "$a" "$([ "$a" = 20000 ] && echo OK || echo '!!')"
b=$(before "category_id='$CSV'");      a=$(after "category_id='$CSV'")
row "Статья «Сервисы/связь»" "$b" "$a" "$([ "$a" = 5000 ] && echo OK || echo '!!')"
b=$(before "true");                    a=$(after "true")
row "ИТОГО расходы (ОПиУ/ДДС/дашборд)" "$b" "$a" "$([ "$a" = 25000 ] && echo OK || echo '!!')"

echo
echo "  Инварианты:"
d=$($P -c "select count(*) from (select transaction_id, sum(amount) s, max(transaction_amount) a from transaction_lines group by transaction_id having sum(amount)<>max(transaction_amount)) z;")
echo "    операций, где Σ строк ≠ сумме операции: $d   (должно быть 0)"
d=$($P -c "select count(*) from transactions;")
echo "    операций в cash layer:                  $d   (должно быть 2)"
d=$($P -c "select count(*) from transaction_lines;")
echo "    строк в management layer:               $d   (2 части + 2 части = 4)"
b=$($P -c "select balance from account_balances where account_id='$ACC';")
echo "    остаток счёта:                          $(money "$b") USDT  (= −250,00: движение учтено один раз)"
