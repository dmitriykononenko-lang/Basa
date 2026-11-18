#!/usr/bin/env bash
# ============================================================================
# fx_test.sh — доказательство семантики FX на disposable-БД (не production).
# Требует: bash scripts/concurrency/run.sh (создаёт t_post с миграциями 0086–0092),
# поверх которой накатывается scripts/fx/fx_prototype.sql.
# ============================================================================
set -u
BASE=${BASE:-/var/tmp/pgaudit}
DB=${DB:-t_fx}
P="psql -h $BASE -p 5433 -U audit -d $DB -qtA"
T=11111111-1111-1111-1111-111111111111
U1=aaaaaaaa-0000-0000-0000-000000000001
ACC=a0000000-0000-0000-0000-000000000001
pass=0; fail=0
q(){ $P -c "set test.uid='$U1'; set app.fx_cutover_date='2026-08-20'; $1" 2>&1; }
check(){ if [ "$2" = "$3" ]; then printf '  %-6s PASS  %s\n' "$1" "$4"; pass=$((pass+1));
         else printf '  %-6s FAIL  %s — ожидалось [%s], получено [%s]\n' "$1" "$4" "$2" "$3"; fail=$((fail+1)); fi; }

echo "=============== FX SEMANTICS (db=$DB) ==============="
$P -c "delete from obligation_payments; delete from transaction_splits; delete from transactions; delete from obligations;" >/dev/null 2>&1
$P -c "delete from fx_calendar; delete from fx_quotes;" >/dev/null 2>&1

# ── Котировки ЦБ: пятница 04.09 и вторник 08.09 (07.09 — условный праздник,
#    ЦБ курс не публиковал). Значения синтетические, важна СЕМАНТИКА.
$P -c "insert into fx_quotes(quote_currency, rate_date, rate, nominal, source_url) values
  ('USD','2026-09-04',82.3000,1,'XML_daily.asp?date_req=04/09/2026'),
  ('USD','2026-09-08',83.1500,1,'XML_daily.asp?date_req=08/09/2026'),
  ('KZT','2026-09-04',18.4000,100,'XML_daily.asp?date_req=04/09/2026');" >/dev/null
# Календарь действия: то, что источник ответил про КАЖДУЮ календарную дату.
# Пт 04.09 → своя котировка; Сб 05.09, Вс 06.09, Пн 07.09 (праздник) → 04.09;
# Вт 08.09 → своя. Для 09.09 строки НЕТ — имитируем пробел загрузки.
$P -c "insert into fx_calendar(calendar_date, effective_rate_date, derivation) values
  ('2026-09-04','2026-09-04','SOURCE_DECLARED'),
  ('2026-09-05','2026-09-04','SOURCE_DECLARED'),
  ('2026-09-06','2026-09-04','SOURCE_DECLARED'),
  ('2026-09-07','2026-09-04','SOURCE_DECLARED'),
  ('2026-09-08','2026-09-08','SOURCE_DECLARED');" >/dev/null

mk(){ # $1 дата, $2 сумма(минор), $3 валюта, $4 статус
  $P -c "set app.fx_cutover_date='2026-08-20'; insert into transactions(team_id,type,amount,currency,account_id,occurred_on,status)
         values('$T','expense',$2,'$3','$ACC','$1','${4:-actual}') returning id;"; }
snap(){ $P -c "select coalesce(fx_status,'-')||'|'||coalesce(fx_rate::text,'-')||'|'||coalesce(fx_rate_date::text,'-')||'|'||coalesce(base_amount::text,'-')||'|'||coalesce(fx_method,'-') from transactions where id='$1';"; }

# ── FX1. Пятница: курс своей даты
TX=$(mk 2026-09-04 100000 USDT); check FX1 "ok|82.30000000|2026-09-04|8230000|USDT_USD_1_TO_1_CBR" "$(snap "$TX")" "пятница: курс своей даты, метод USDT→USD"
# ── FX2/FX3/FX4. Суббота, воскресенье, праздничный понедельник → курс пятницы
TX=$(mk 2026-09-05 100000 USDT); check FX2 "ok|82.30000000|2026-09-04|8230000|USDT_USD_1_TO_1_CBR" "$(snap "$TX")" "суббота наследует официальный курс пятницы"
TX=$(mk 2026-09-06 100000 USDT); check FX3 "ok|82.30000000|2026-09-04|8230000|USDT_USD_1_TO_1_CBR" "$(snap "$TX")" "воскресенье наследует курс пятницы"
TX=$(mk 2026-09-07 100000 USDT); check FX4 "ok|82.30000000|2026-09-04|8230000|USDT_USD_1_TO_1_CBR" "$(snap "$TX")" "праздничный понедельник наследует курс пятницы"
# ── FX5. Вторник: новая котировка
TX=$(mk 2026-09-08 100000 USDT); check FX5 "ok|83.15000000|2026-09-08|8315000|USDT_USD_1_TO_1_CBR" "$(snap "$TX")" "вторник: применён новый официальный курс"
# ── FX6. ПРОБЕЛ загрузки: календаря за 09.09 нет → НЕ берём «ближайшую предыдущую»
TX=$(mk 2026-09-09 100000 USDT); check FX6 "missing|-|-|-|USDT_USD_1_TO_1_CBR" "$(snap "$TX")" "пробел в календаре => FX_RATE_MISSING, а не тихий перенос курса"
# ── FX7. RUB
TX=$(mk 2026-09-08 500000 RUB); check FX7 "ok|1.00000000|2026-09-08|500000|IDENTITY" "$(snap "$TX")" "RUB: rate=1, метод IDENTITY"
# ── FX8. Номинал: KZT котируется за 100
TX=$(mk 2026-09-04 100000 KZT); check FX8 "ok|0.18400000|2026-09-04|18400|CBR_DIRECT" "$(snap "$TX")" "KZT: номинал 100 учтён (18,40/100)"
# ── FX9. До cutover — legacy, FX не трогаем
TX=$(mk 2026-08-19 100000 USDT); check FX9 "legacy|-|-|-|-" "$(snap "$TX")" "до cutover: legacy, снимок не ставится"

# ── FX10. planned → ESTIMATED, прогноз меняется при смене котировок
$P -c "insert into fx_calendar(calendar_date, effective_rate_date, derivation) values ('2026-09-30','2026-09-08','SOURCE_DECLARED');" >/dev/null
PL=$(mk 2026-09-30 100000 USDT planned)
check FX10 "estimated|83.15000000|2026-09-08|8315000|USDT_USD_1_TO_1_CBR" "$(snap "$PL")" "плановая: прогноз ESTIMATED, не фиксация"
$P -c "insert into fx_quotes(quote_currency, rate_date, rate, nominal) values ('USD','2026-09-29',85.0000,1);
       update fx_calendar set effective_rate_date='2026-09-29' where calendar_date='2026-09-30';" >/dev/null
q "select fx_refresh_estimates('$T');" >/dev/null
check FX11 "estimated|85.00000000|2026-09-29|8500000|USDT_USD_1_TO_1_CBR" "$(snap "$PL")" "курс изменился → прогноз плановой пересчитан"
# ── FX12. planned → actual: фиксация immutable
$P -c "set app.fx_cutover_date='2026-08-20'; update transactions set status='actual' where id='$PL';" >/dev/null
AFTER_PIN=$(snap "$PL")
check FX12 "ok|85.00000000|2026-09-29|8500000|USDT_USD_1_TO_1_CBR" "$AFTER_PIN" "проведение: снимок зафиксирован (ok)"
# ── FX13. После фиксации изменение котировок НЕ меняет снимок
$P -c "insert into fx_quotes(quote_currency, rate_date, rate, nominal) values ('USD','2026-09-30',90.0000,1);
       update fx_calendar set effective_rate_date='2026-09-30' where calendar_date='2026-09-30';" >/dev/null
q "select fx_refresh_estimates('$T');" >/dev/null
check FX13 "$AFTER_PIN" "$(snap "$PL")" "зафиксированный снимок не меняется от новых котировок"
# ── FX14. Правка поля, не влияющего на FX, снимок не трогает
$P -c "update transactions set note='правка' where id='$PL';" >/dev/null
check FX14 "$AFTER_PIN" "$(snap "$PL")" "правка note не пересчитывает FX"
# ── FX15. Смена суммы: тот же курс, новый base_amount
$P -c "set app.fx_cutover_date='2026-08-20'; update transactions set amount=200000 where id='$PL';" >/dev/null
check FX15 "ok|85.00000000|2026-09-29|17000000|USDT_USD_1_TO_1_CBR" "$(snap "$PL")" "смена суммы: курс тот же, base_amount пересчитан"

# ── FX16. Split: сумма частей до копейки при «неудобном» курсе
$P -c "delete from transactions where id<>'$PL';" >/dev/null 2>&1
$P -c "insert into fx_quotes(quote_currency, rate_date, rate, nominal) values ('USD','2026-09-10',78.4321,1) on conflict do nothing;
       insert into fx_calendar(calendar_date, effective_rate_date, derivation) values ('2026-09-10','2026-09-10','SOURCE_DECLARED') on conflict do nothing;" >/dev/null
SP=$(mk 2026-09-10 100000 USDT)
$P -c "insert into transaction_splits(team_id,transaction_id,amount) values('$T','$SP',33333),('$T','$SP',33333),('$T','$SP',33334);" >/dev/null
d=$($P -c "select (select base_amount from transactions where id='$SP')||' vs '||(select sum(base_amount) from transaction_lines_fx where transaction_id='$SP' and split_id is not null);")
check FX16 "7843210 vs 7843210" "$d" "split 1/3: Σ base_amount частей = base_amount операции до копейки"
d=$($P -c "select count(distinct fx_rate)||'/'||count(*) from transaction_lines_fx where transaction_id='$SP' and split_id is not null;")
check FX17 "1/3" "$d" "все части несут ОДИН курс исходной операции"

# ── FX18/FX19. FIN-02: два разных ограничения
$P -c "delete from obligation_payments;" >/dev/null
# Обязательство 20 000,00 ₽ заведомо больше рублёвой стоимости платежа (8 315,00 ₽),
# чтобы тест проверял кэп ПО ОПЕРАЦИИ, а не по обязательству.
OBL=$($P -c "insert into obligations(team_id,counterparty_id,type,amount,currency,status)
             values('$T','22222222-2222-2222-2222-222222222222','payable',2000000,'RUB','open') returning id;")
PAY=$(mk 2026-09-08 10000 USDT)   # 100,00 USDT по курсу 83,15 = 8315,00 ₽
r=$(q "select obligation_allocate_fx('$OBL','$PAY',10000);" | head -1)
d=$($P -c "select payment_amount||'|'||payment_currency||'|'||amount||'|'||base_amount||'|'||fx_method from obligation_payments where transaction_id='$PAY';")
check FX18 "10000|USDT|831500|831500|CROSS_VIA_RUB" "$d" "разнесение: платёж в USDT, погашение в RUB, base RUB, метод записан"
# Переразнести тот же платёж можно только на ДРУГОЕ обязательство: индекс
# obligation_payments_tx_obl_uniq даёт не более одной строки на (операция,
# обязательство). Это и есть сценарий «одна операция гасит несколько
# обязательств» — именно на нём должен сработать кэп ПО ОПЕРАЦИИ.
OBL_B=$($P -c "insert into obligations(team_id,counterparty_id,type,amount,currency,status)
               values('$T','22222222-2222-2222-2222-222222222222','payable',2000000,'RUB','open') returning id;")
r=$(q "select obligation_allocate_fx('$OBL_B','$PAY',5000);" 2>&1 | head -3)
case "$r" in *"превышение"*|*23514*) o=rejected;; *) o="ALLOWED: $r";; esac
check FX19 rejected "$o" "кэп ПО ОПЕРАЦИИ (валюта операции): нельзя разнести больше, чем ушло"

OBL2=$($P -c "insert into obligations(team_id,counterparty_id,type,amount,currency,status)
              values('$T','22222222-2222-2222-2222-222222222222','payable',100000,'RUB','open') returning id;")
PAY2=$(mk 2026-09-08 100000 USDT)
r=$(q "select obligation_allocate_fx('$OBL2','$PAY2',100000);" 2>&1 | head -2)
case "$r" in *"обязательство"*|*"Обязательство"*|*23514*) o=rejected;; *) o="ALLOWED: $r";; esac
check FX20 rejected "$o" "кэп ПО ОБЯЗАТЕЛЬСТВУ (валюта обязательства): переплата отклонена"

echo "---------------------------------------------------"
echo "FX: PASS=$pass FAIL=$fail"
[ "$fail" = 0 ]
