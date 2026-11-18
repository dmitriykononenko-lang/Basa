#!/usr/bin/env bash
# SQL-тесты 0101_vault_intake на локальной БД (production не используется).
# Запуск: bash scripts/local-stack/db_reset.sh && bash scripts/local-stack/vault_intake_test.sh
set -u
PORT=${PGPORT:-54329}
DB=${DB:-basa_local}
PSQL=(psql -h 127.0.0.1 -p "$PORT" -U postgres -d "$DB" -qtA -v ON_ERROR_STOP=0 -v VERBOSITY=terse)
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL $1 — got: $2"; }
q()    { "${PSQL[@]}" -c "$1" 2>&1 | tr -d '\r' | sed '/^SET$/d' | tail -1; }
# Выполнить SQL от имени пользователя (uuid) или anon.
as()   { local who=$1; shift
  if [ "$who" = anon ]; then
    q "begin; set local role anon; set local request.jwt.claims = '{\"role\":\"anon\"}'; $*; commit;"
  else
    q "begin; set local role authenticated; set local request.jwt.claims = '{\"sub\":\"$who\",\"role\":\"authenticated\"}'; $*; commit;"
  fi; }
expect()   { [ "$2" = "$3" ] && ok "$1" || bad "$1" "$2"; }
expect_re(){ echo "$2" | grep -Eq "$3" && ok "$1" || bad "$1" "$2"; }

OWNER=11111111-0000-4000-8000-000000000001
MANAGER=11111111-0000-4000-8000-000000000002
EMPL=11111111-0000-4000-8000-000000000003
OUT=11111111-0000-4000-8000-000000000004
TEAM=22222222-0000-4000-8000-000000000001
TEAMB=22222222-0000-4000-8000-000000000002
PROJ=33333333-0000-4000-8000-000000000001
CP=44444444-0000-4000-8000-000000000001
PUB=$(printf 'B%.0s' $(seq 1 87))
WRAP='{"v":1,"kdf":"PBKDF2","hash":"SHA-256","iter":600000,"salt":"c2FsdHNhbHRzYWx0c2FsdA","iv":"aXZpdml2aXZpdml2","ct":"Y3RjdGN0"}'

echo "== seed"
"${PSQL[@]}" >/dev/null <<SQL
insert into auth.users (id, email) values
 ('$OWNER','owner@t.test'),('$MANAGER','manager@t.test'),('$EMPL','empl@t.test'),('$OUT','out@t.test');
insert into public.profiles (id, full_name) values ('$OWNER','Дмитрий'),('$MANAGER','Анна Менеджер'),('$EMPL','Сотрудник'),('$OUT','Чужой')
 on conflict (id) do update set full_name = excluded.full_name;
insert into public.teams (id, name, base_currency, created_by) values ('$TEAM','KO Agency','RUB','$OWNER'),('$TEAMB','Other','RUB','$OUT');
insert into public.team_members (team_id, user_id, role) values
 ('$TEAM','$OWNER','owner'),('$TEAM','$MANAGER','manager'),('$TEAM','$EMPL','employee'),('$TEAMB','$OUT','owner')
 on conflict do nothing;
insert into public.projects (id, team_id, name) values ('$PROJ','$TEAM','Maison · внедрение');
insert into public.counterparties (id, team_id, name, kind) values ('$CP','$TEAM','Maison LLC','client');
SQL

echo "== права на функции"
expect "anon не вызывает create"  "$(q "select has_function_privilege('anon','public.vault_intake_create(uuid,text,text,uuid,uuid,text,integer)','execute')")" "f"
expect "anon не вызывает accept"  "$(q "select has_function_privilege('anon','public.vault_intake_accept(uuid,text,text,text,text,text,text)','execute')")" "f"
expect "anon не вызывает revoke"  "$(q "select has_function_privilege('anon','public.vault_intake_revoke(uuid)','execute')")" "f"
expect "anon не вызывает key_set" "$(q "select has_function_privilege('anon','public.vault_team_key_set(uuid,text,jsonb)','execute')")" "f"
expect "anon не вызывает expire"  "$(q "select has_function_privilege('anon','public.vault_intake_expire()','execute')")" "f"
expect "authenticated не вызывает expire" "$(q "select has_function_privilege('authenticated','public.vault_intake_expire()','execute')")" "f"
expect "anon не вызывает notify"  "$(q "select has_function_privilege('anon','public.vault_intake_notify(public.vault_intake_requests,text,text)','execute')")" "f"
expect "anon вызывает load"       "$(q "select has_function_privilege('anon','public.vault_intake_load(text,jsonb)','execute')")" "t"
expect "anon не вызывает directory" "$(q "select has_function_privilege('anon','public.vault_directory(uuid)','execute')")" "f"

echo "== ключ команды"
expect_re "менеджер не создаёт ключ" "$(as $MANAGER "select public.vault_team_key_set('$TEAM','$PUB','$WRAP'::jsonb)")" "Нет доступа"
expect_re "слабый PBKDF2 отклоняется" "$(as $OWNER "select public.vault_team_key_set('$TEAM','$PUB','{\"v\":1,\"iter\":1000,\"salt\":\"a\",\"iv\":\"b\",\"ct\":\"c\"}'::jsonb)")" "Неверный формат"
expect_re "создание запроса без ключа запрещено" "$(as $MANAGER "select token from public.vault_intake_create('$TEAM','amocrm','',null,null,'X',48)")" "ключ команды"
KEY1=$(as $OWNER "select public.vault_team_key_set('$TEAM','$PUB','$WRAP'::jsonb)")
expect_re "владелец создал ключ" "$KEY1" "^[0-9a-f-]{36}$"
expect_re "anon не видит ключи" "$(as anon "select count(*) from public.vault_team_keys")" "^0$|permission denied"
expect_re "сотрудник не видит ключи" "$(as $EMPL "select count(*) from public.vault_team_keys")" "^0$"
expect "менеджер не видит обёрнутый ключ" "$(as $MANAGER "select count(*) from public.vault_team_keys")" "0"
expect "менеджер знает, что ключ есть" "$(as $MANAGER "select public.vault_team_has_key('$TEAM')")" "t"
expect "сотрудник — нет" "$(as $EMPL "select public.vault_team_has_key('$TEAM')")" "f"
expect "владелец видит обёрнутый ключ" "$(as $OWNER "select count(*) from public.vault_team_keys")" "1"

echo "== создание запроса"
expect_re "сотрудник не создаёт запрос" "$(as $EMPL "select token from public.vault_intake_create('$TEAM','amocrm','',null,null,'X',48)")" "Нет доступа"
expect_re "чужая команда не создаёт" "$(as $OUT "select token from public.vault_intake_create('$TEAM','amocrm','',null,null,'X',48)")" "Нет доступа"
expect_re "чужой проект отклоняется" "$(as $OUT "select token from public.vault_intake_create('$TEAMB','amocrm','','$PROJ',null,'X',48)")" "Сначала владелец|Проект не найден"
ROW=$(as $MANAGER "select id||'|'||token from public.vault_intake_create('$TEAM','amocrm','','$PROJ','$CP','',48)")
REQ=${ROW%%|*}; TOK=${ROW##*|}
expect_re "токен 43 символа base64url" "$TOK" "^[A-Za-z0-9_-]{43}$"
expect "имя клиента взято из контрагента" "$(q "select client_name from public.vault_intake_requests where id='$REQ'")" "Maison LLC"
expect "токен в БД не хранится" "$(q "select count(*) from public.vault_intake_requests where encode(token_hash,'escape') like '%$TOK%'")" "0"
expect "срок 48 часов" "$(q "select round(extract(epoch from expires_at-created_at)/3600) from public.vault_intake_requests where id='$REQ'")" "48"
expect_re "anon не читает запросы" "$(as anon "select count(*) from public.vault_intake_requests")" "^0$|permission denied"
expect "сотрудник не читает запросы" "$(as $EMPL "select count(*) from public.vault_intake_requests")" "0"
expect "менеджер читает запросы" "$(as $MANAGER "select count(*) from public.vault_intake_requests")" "1"
expect_re "прямой update запрещён" "$(as $MANAGER "update public.vault_intake_requests set status='accepted' where id='$REQ'")" "permission denied|denied"

echo "== клиент открывает ссылку"
expect "неверный токен" "$(as anon "select public.vault_intake_load('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA','{}')->>'status'")" "invalid"
expect "мусорный токен" "$(as anon "select public.vault_intake_load('x''; drop table x;--','{}')->>'status'")" "invalid"
L1=$(as anon "select public.vault_intake_load('$TOK','{\"ip_hash\":\"abc\",\"ua\":\"test\"}')")
expect "открытие ok" "$(echo "$L1" | python3 -c 'import sys,json;print(json.load(sys.stdin)["status"])')" "ok"
expect "первое открытие помечено" "$(echo "$L1" | python3 -c 'import sys,json;print(json.load(sys.stdin)["first_open"])')" "True"
expect "отдаётся открытый ключ" "$(echo "$L1" | python3 -c 'import sys,json;print(json.load(sys.stdin)["public_key"]==sys.argv[1])' "$PUB")" "True"
expect "закрытый ключ не отдаётся" "$(echo "$L1" | grep -c wrapped)" "0"
as anon "select public.vault_intake_load('$TOK','{}')" >/dev/null
expect "второе открытие: счётчик 2, статус opened" "$(q "select open_count||status from public.vault_intake_requests where id='$REQ'")" "2opened"
expect "уведомление об открытии: владелец и автор, без дублей" "$(q "select count(*) from public.notifications where dedupe_key='vault_intake:$REQ:open'")" "2"
expect "журнал: 2 открытия" "$(q "select count(*) from public.vault_access_log where action='intake_open' and details->>'request_id'='$REQ'")" "2"

echo "== клиент отправляет"
KID=$(q "select key_id from public.vault_intake_requests where id='$REQ'")
CT=$(printf 'Q%.0s' $(seq 1 120))
GOOD="{\"v\":1,\"kid\":\"$KID\",\"epk\":\"$PUB\",\"iv\":\"aXZpdml2aXZpdml2\",\"ct\":\"$CT\"}"
WRONGKID="{\"v\":1,\"kid\":\"00000000-0000-4000-8000-000000000000\",\"epk\":\"$PUB\",\"iv\":\"aXZpdml2aXZpdml2\",\"ct\":\"$CT\"}"
expect "чужой kid отклоняется" "$(as anon "select public.vault_intake_submit('$TOK','$WRONGKID',true,false,'{}')->>'status'")" "bad_payload"
expect "не JSON отклоняется" "$(as anon "select public.vault_intake_submit('$TOK',repeat('z',200),true,false,'{}')->>'status'")" "bad_payload"
expect "слишком большой отклоняется" "$(as anon "select public.vault_intake_submit('$TOK',repeat('z',30000),true,false,'{}')->>'status'")" "bad_payload"
expect "отправка ok" "$(as anon "select public.vault_intake_submit('$TOK','$GOOD',true,false,'{}')->>'status'")" "ok"
expect "повторная отправка запрещена" "$(as anon "select public.vault_intake_submit('$TOK','$GOOD',true,false,'{}')->>'status'")" "used"
expect "ссылка после отправки закрыта" "$(as anon "select public.vault_intake_load('$TOK','{}')->>'status'")" "used"
expect "статус submitted, отметка user_added" "$(q "select status||user_added from public.vault_intake_requests where id='$REQ'")" "submittedtrue"
expect "уведомление о передаче" "$(q "select count(*) from public.notifications where dedupe_key='vault_intake:$REQ:submit' and read_at is null")" "2"

echo "== приём"
expect_re "менеджер не принимает" "$(as $MANAGER "select public.vault_intake_accept('$REQ','T','','','','','')")" "не найден"
expect_re "чужой владелец не принимает" "$(as $OUT "select public.vault_intake_accept('$REQ','T','','','','','')")" "не найден"
ENTRY=$(as $OWNER "select public.vault_intake_accept('$REQ','amoCRM · Maison','koagency.me@gmail.com','https://maison.amocrm.ru','note','iv.tag.data','Доступы клиентов')")
expect_re "владелец принял" "$ENTRY" "^[0-9a-f-]{36}$"
expect "запись привязана к проекту и клиенту" "$(q "select (project_id='$PROJ' and counterparty_id='$CP' and secret_cipher='iv.tag.data')::text from public.vault_entries where id='$ENTRY'")" "true"
expect "шифртекст запроса удалён" "$(q "select (payload_cipher is null and status='accepted' and entry_id='$ENTRY')::text from public.vault_intake_requests where id='$REQ'")" "true"
expect "уведомления по запросу прочитаны" "$(q "select count(*) from public.notifications where dedupe_key like 'vault_intake:$REQ:%' and read_at is null")" "0"
expect_re "повторный приём запрещён" "$(as $OWNER "select public.vault_intake_accept('$REQ','T','','','','','')")" "не ожидает"
expect "справочник показывает клиента" "$(as $OWNER "select counterparty_name from public.vault_directory('$TEAM') where id='$ENTRY'")" "Maison LLC"
expect "журнал: create + accept" "$(q "select count(*) from public.vault_access_log where (action='intake_accept' and details->>'request_id'='$REQ') or (action='create' and entry_id='$ENTRY')")" "2"

echo "== отзыв"
R2=$(as $MANAGER "select id||'|'||token from public.vault_intake_create('$TEAM','other','Radist',null,null,'Garant',48)")
REQ2=${R2%%|*}; TOK2=${R2##*|}
expect_re "чужой не отзывает" "$(as $OUT "select public.vault_intake_revoke('$REQ2')")" "не найден"
as $MANAGER "select public.vault_intake_revoke('$REQ2')" >/dev/null
expect "отозванная ссылка" "$(as anon "select public.vault_intake_load('$TOK2','{}')->>'status'")" "revoked"
expect "отправка в отозванную" "$(as anon "select public.vault_intake_submit('$TOK2','$GOOD',false,false,'{}')->>'status'")" "revoked"

echo "== истечение"
R3=$(as $MANAGER "select id||'|'||token from public.vault_intake_create('$TEAM','meta','',null,null,'7S',1)")
REQ3=${R3%%|*}; TOK3=${R3##*|}
q "update public.vault_intake_requests set expires_at = now() - interval '1 minute' where id='$REQ3'" >/dev/null
expect "просроченная ссылка" "$(as anon "select public.vault_intake_load('$TOK3','{}')->>'status'")" "expired"
R4=$(as $MANAGER "select id||'|'||token from public.vault_intake_create('$TEAM','google_ads','',null,null,'EVERY',48)")
REQ4=${R4%%|*}; TOK4=${R4##*|}
KID4=$(q "select key_id from public.vault_intake_requests where id='$REQ4'")
as anon "select public.vault_intake_submit('$TOK4','{\"v\":1,\"kid\":\"$KID4\",\"epk\":\"$PUB\",\"iv\":\"aXZpdml2aXZpdml2\",\"ct\":\"$CT\"}',false,true,'{}')" >/dev/null
q "update public.vault_intake_requests set submitted_at = now() - interval '8 days' where id='$REQ4'" >/dev/null
expect "крон закрыл неразобранный запрос" "$(q "select public.vault_intake_expire()")" "1"
expect "шифртекст неразобранного удалён" "$(q "select (status='expired' and payload_cipher is null)::text from public.vault_intake_requests where id='$REQ4'")" "true"

echo "== смена ключа"
KEY2=$(as $OWNER "select public.vault_team_key_set('$TEAM','$(printf 'C%.0s' $(seq 1 87))','$WRAP'::jsonb)")
expect "один активный ключ" "$(q "select count(*) from public.vault_team_keys where team_id='$TEAM' and active")" "1"
expect "старый запрос ссылается на старый ключ" "$(q "select (key_id='$KEY1')::text from public.vault_intake_requests where id='$REQ'")" "true"
R5=$(as $MANAGER "select id from public.vault_intake_create('$TEAM','kommo','',null,null,'',48)")
expect "новый запрос — на новом ключе" "$(q "select (key_id='$KEY2')::text from public.vault_intake_requests where id='$R5'")" "true"

echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
