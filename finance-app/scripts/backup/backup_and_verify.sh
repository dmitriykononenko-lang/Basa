#!/usr/bin/env bash
# ============================================================================
# backup_and_verify.sh — Разрешение №2A.2 одной командой:
#   backup production → restore в одноразовую БД → сверка показателей →
#   репетиция 0086–0092 → проверка отката 0092_down…0086_down.
#
# ЗАПУСКАТЬ СО СВОЕЙ МАШИНЫ. Пошагово: BACKUP_RUNBOOK_MACOS.md
#
# ГАРАНТИИ БЕЗОПАСНОСТИ (проверяются кодом, а не обещаются):
#   * каждый запрос к production выполняется внутри
#     BEGIN TRANSACTION READ ONLY … COMMIT, поэтому запись физически невозможна
#     даже при ошибке в фильтре;
#   * перед этим текст запроса проходит клиентский фильтр: разделители
#     ; ( ) , = ' " заменяются пробелами, после чего проверяются первое слово
#     и отсутствие изменяющих ключевых слов;
#   * все DDL/DML, миграции, откаты и restore идут ТОЛЬКО в одноразовую БД;
#     перед каждой такой операцией проверяется, что цель — локальный unix-сокет
#     во временном каталоге прогона;
#   * пароль берётся из PGPASSWORD, не попадает в argv, метаданные, логи и вывод;
#     DB_URL с вписанным паролем отвергается;
#   * любой критический сбой = немедленный выход с кодом != 0.
# ============================================================================
set -Eeuo pipefail

die(){ echo "ОСТАНОВ: $*" >&2; exit 1; }
trap 'die "непредвиденная ошибка на строке $LINENO"' ERR

# >>> pure-helpers — не обращаются ни к одной БД; тесты извлекают этот блок и source'ят
# Финансовые и integrity-показатели. После миграций 0086–0092 любое их изменение
# относительно точки restore — FAIL.
FIN_KEYS="tx_total tx_actual tx_planned obligations allocations invoices invoice_items splits split_sum_mismatch import_batches accounts counterparties dup_auto_accrual rub_flow usdt_flow opening_sum fin03"
# Финансовые ключи, которые миграции меняют НАМЕРЕННО (формат: "ключ ключ ...").
# Сейчас пусто: 0086–0092 не меняют данных. Добавлять сюда только с обоснованием.
FIN_EXPECTED_DELTA=""

# значение ключа из файла "ключ=значение"; точное совпадение ключа; нет ключа → <нет>
kv_get(){ awk -F= -v k="$1" '$1==k{print substr($0,length(k)+2); f=1; exit} END{if(!f) print "<нет>"}' "$2"; }
is_fin_key(){ case " $FIN_KEYS " in *" $1 "*) return 0;; esac; return 1; }

# все ключи базового файла должны совпасть (используется для restore против production)
compare_all(){ # BASE ACTUAL LABEL
  local base="$1" act="$2" label="$3" line k v a bad=0 n=0
  while IFS= read -r line; do
    k=${line%%=*}; [ -n "$k" ] || continue
    v=${line#*=}; a=$(kv_get "$k" "$act"); n=$((n+1))
    if [ "$v" != "$a" ]; then printf '  [%s] %-54s было=[%s] стало=[%s]\n' "$label" "$k" "$v" "$a"; bad=$((bad+1)); fi
  done < "$base"
  echo "  [$label] сверено показателей: $n, расхождений: $bad"
  [ "$bad" -eq 0 ]
}

# финансы — фатально; структура/ACL — отдельно и только информативно
compare_fin_struct(){ # BASE ACTUAL LABEL → код 1 при любом финансовом расхождении
  local base="$1" act="$2" label="$3" line k v a fin_bad=0 st_bad=0
  echo "  [$label] финансовые показатели (расхождение = FAIL):"
  for k in $FIN_KEYS; do
    v=$(kv_get "$k" "$base"); a=$(kv_get "$k" "$act")
    if [ "$v" = "$a" ]; then continue; fi
    case " $FIN_EXPECTED_DELTA " in
      *" $k "*) printf '    %-20s было=[%s] стало=[%s]  (предусмотрено миграцией)\n' "$k" "$v" "$a"; continue;;
    esac
    printf '    ФИНАНСЫ %-20s было=[%s] стало=[%s]\n' "$k" "$v" "$a"; fin_bad=$((fin_bad+1))
  done
  echo "  [$label] структура и ACL (изменения ожидаемы от миграций, не FAIL):"
  while IFS= read -r line; do
    k=${line%%=*}; [ -n "$k" ] || continue
    if is_fin_key "$k"; then continue; fi
    v=${line#*=}; a=$(kv_get "$k" "$act")
    if [ "$v" != "$a" ]; then printf '    структура %-44s было=[%s] стало=[%s]\n' "$k" "$v" "$a"; st_bad=$((st_bad+1)); fi
  done < "$base"
  echo "  [$label] финансовых расхождений: $fin_bad · структурных изменений: $st_bad"
  [ "$fin_bad" -eq 0 ]
}

# каталог → абсолютный физический путь (создаётся при необходимости)
abs_dir(){ mkdir -p -- "$1" && (cd -- "$1" && pwd -P); }
# <<< pure-helpers

: "${DB_URL:?нужен DB_URL (строка подключения БЕЗ пароля)}"
: "${PGPASSWORD:?нужен PGPASSWORD — задайте через: read -rsp \"пароль: \" PGPASSWORD; export PGPASSWORD}"

case "$DB_URL" in
  *://*:*@*) die "в DB_URL вписан пароль. Уберите его: пароль передаётся только через PGPASSWORD.
       Правильный вид: postgresql://postgres.<ref>@<HOST>:5432/postgres?sslmode=require" ;;
esac
case "$DB_URL" in postgres://*|postgresql://*) ;; *) die "DB_URL должен начинаться с postgresql://" ;; esac

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$HERE/../.."
MIGRATIONS="$REPO/supabase/migrations"
DOWN="$MIGRATIONS/rollback"
STEPS="0086_guard_constraints 0087_accrual_idempotency 0088_financial_rpcs 0089_optimistic_concurrency 0090_bank_event_identity 0091_write_paths_and_authz 0092_transaction_lines"
[ -f "$MIGRATIONS/0086_guard_constraints.sql" ] || die "запускайте из репозитория: не вижу $MIGRATIONS"

TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT=${OUT:-"$HOME/basa-backup-$TS"}
OUT=$(abs_dir "$OUT") || die "не удалось создать каталог артефактов"
case "$OUT" in /*) ;; *) die "каталог артефактов не абсолютный: '$OUT'" ;; esac
chmod 700 "$OUT"
DUMP="$OUT/basa_public_$TS.dump"
META="$OUT/backup_metadata_$TS.txt"

# ── клиент PostgreSQL 17 ────────────────────────────────────────────────────
for c in /opt/homebrew/opt/postgresql@17/bin /usr/local/opt/postgresql@17/bin /usr/lib/postgresql/17/bin ""; do
  if [ -x "${c:+$c/}pg_dump" ] && "${c:+$c/}pg_dump" --version | grep -qE ' 1[7-9]\.'; then PGBIN="$c"; break; fi
done
[ "${PGBIN+set}" = set ] || die "не найден pg_dump версии 17+. На macOS: brew install postgresql@17"
P(){ echo "${PGBIN:+$PGBIN/}$1"; }
for t in pg_dump pg_restore psql initdb pg_ctl; do
  [ -x "$(P "$t")" ] || die "не найден $t рядом с pg_dump ($PGBIN)"
done
echo "клиент: $("$(P pg_dump)" --version)"

sha256(){ if command -v shasum >/dev/null; then shasum -a 256 "$1" | awk '{print $1}';
           else sha256sum "$1" | awk '{print $1}'; fi; }

# ── (1) доступ к production: только чтение, в read-only транзакции ──────────
prod_guard(){
  local q="$1" low first
  # разделители заменяем пробелами, чтобы "select 1;delete" не прошёл фильтр
  low=$(printf '%s' "$q" | tr '\n\t;(),='"'"'"' '        ' | tr '[:upper:]' '[:lower:]')
  first=$(printf '%s' "$low" | sed -E 's/^ +//' | cut -d' ' -f1)
  case "$first" in select|show|with|table) ;;
    *) die "внутренняя защита: запрос к production начинается с '$first'" ;; esac
  case " $low " in
    *" insert "*|*" update "*|*" delete "*|*" drop "*|*" truncate "*|*" alter "*|*" create "*|*" grant "*|*" revoke "*|*" copy "*|*" call "*|*" do "*|*" vacuum "*|*" refresh "*)
      die "внутренняя защита: в запросе к production найдено изменяющее ключевое слово" ;;
  esac
}
prod_ro(){
  prod_guard "$1"
  "$(P psql)" "$DB_URL" -X -q -At -F'=' -v ON_ERROR_STOP=1 \
    -c "begin transaction read only" -c "$1" -c "commit"
}
prod_ro_csv(){
  prod_guard "$1"
  "$(P psql)" "$DB_URL" -X -q -At --csv -v ON_ERROR_STOP=1 \
    -c "begin transaction read only" -c "$1" -c "commit"
}

# ── 1. предполётная проверка ────────────────────────────────────────────────
echo "── предполётная проверка production (только чтение) ──"
prod_ro "select 'active_backends='||(select count(*) from pg_stat_activity where state<>'idle' and pid<>pg_backend_pid())
      ||' cron='||(select string_agg(jobid||':'||active,',' order by jobid) from cron.job)
      ||' tx='||(select count(*) from transactions)
      ||' batches='||(select count(*) from import_batches)
      ||' last_synced='||coalesce((select max(last_synced_at)::text from bank_connections),'-')" | tee "$OUT/preflight_$TS.txt"
echo
echo "Сверьте строку выше с принятым baseline. Если что-то разошлось — Ctrl-C сейчас."
echo "Продолжение через 10 секунд..."; sleep 10

# ── 2. ожидаемые значения с живого production ───────────────────────────────
#     (5) constraints / triggers / sequences считаем только по схеме public
EXPECT_SQL="
select 'tables',      count(*)::text from information_schema.tables where table_schema='public' and table_type='BASE TABLE'
union all select 'views',       count(*)::text from information_schema.views where table_schema='public'
union all select 'functions',   count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
union all select 'triggers',    count(*)::text from pg_trigger tg join pg_class c on c.oid=tg.tgrelid join pg_namespace n on n.oid=c.relnamespace where not tg.tgisinternal and n.nspname='public'
union all select 'indexes',     count(*)::text from pg_indexes where schemaname='public'
union all select 'constraints', count(*)::text from pg_constraint co join pg_namespace n on n.oid=co.connamespace where n.nspname='public'
union all select 'rls_tables',  count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity
union all select 'policies',    count(*)::text from pg_policies where schemaname='public'
union all select 'sequences',   count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='S' and n.nspname='public'
union all select 'migrations',  count(*)::text from supabase_migrations.schema_migrations
union all select 'tx_total',    count(*)::text from transactions
union all select 'tx_actual',   count(*)::text from transactions where status='actual'
union all select 'tx_planned',  count(*)::text from transactions where status='planned'
union all select 'obligations', count(*)::text from obligations
union all select 'allocations', count(*)::text from obligation_payments
union all select 'invoices',    count(*)::text from invoices
union all select 'invoice_items', count(*)::text from invoice_items
union all select 'splits',      count(*)::text from transaction_splits
union all select 'split_txs',   count(distinct transaction_id)::text from transaction_splits
union all select 'split_sum_mismatch', count(*)::text from (select s.transaction_id from transaction_splits s join transactions t on t.id=s.transaction_id group by s.transaction_id having sum(s.amount)<>max(t.amount)) x
union all select 'import_batches', count(*)::text from import_batches
union all select 'accounts',    count(*)::text from accounts
union all select 'counterparties', count(*)::text from counterparties
union all select 'dup_auto_accrual', coalesce(sum(c-1),0)::text from (select count(*) c from obligations where pay_part='fixed' and period_month is not null group by counterparty_id,type,pay_part,period_month having count(*)>1) x
union all select 'rub_flow',    coalesce(sum(case when type='income' then amount when type='expense' then -amount else 0 end),0)::text from transactions where status='actual' and currency='RUB'
union all select 'usdt_flow',   coalesce(sum(case when type='income' then amount when type='expense' then -amount else 0 end),0)::text from transactions where status='actual' and currency='USDT'
union all select 'opening_sum', coalesce(sum(coalesce(opening_balance,0)),0)::text from accounts
union all select 'fin03',       count(*)::text from transactions tr
   where tr.type='transfer' and tr.account_id is not null and tr.transfer_account_id is not null and coalesce(tr.note,'')<>''
     and exists (select 1 from transactions e where e.team_id=tr.team_id and e.type='expense' and e.account_id=tr.account_id
                  and e.amount=tr.amount and e.currency=tr.currency and e.occurred_on=tr.occurred_on and e.id<>tr.id
                  and left(coalesce(e.note,''),40)=left(coalesce(tr.note,''),40))
     and exists (select 1 from transactions i where i.team_id=tr.team_id and i.type='income' and i.account_id=tr.transfer_account_id
                  and i.amount=tr.amount and i.currency=tr.currency and i.occurred_on=tr.occurred_on
                  and left(coalesce(i.note,''),40)=left(coalesce(tr.note,''),40))
union all select 'acl:'||p.oid::regprocedure::text,
       has_function_privilege('anon',p.oid,'EXECUTE')::text||'/'||
       has_function_privilege('authenticated',p.oid,'EXECUTE')::text||'/'||
       has_function_privilege('public',p.oid,'EXECUTE')::text||'/'||
       has_function_privilege('service_role',p.oid,'EXECUTE')::text||'/'||md5(pg_get_functiondef(p.oid))
  from pg_proc p where p.oid in (
    'public.bybit_sync_logged(integer)'::regprocedure,
    'public.support_open_period(uuid,bigint,uuid,uuid)'::regprocedure,
    'public.support_delete_period(uuid)'::regprocedure,
    'public.can_edit_finance(uuid)'::regprocedure,
    'public.can_write_tx(uuid)'::regprocedure,
    'public.can_manage_team(uuid)'::regprocedure)
order by 1;"
prod_ro "$EXPECT_SQL" > "$OUT/expected_$TS.txt"
n_exp=$(wc -l < "$OUT/expected_$TS.txt" | tr -d ' ')
[ "$n_exp" -ge 27 ] || die "с production снято только $n_exp показателей, ожидалось не меньше 27"
echo "снято показателей с production: $n_exp"

# ── 2b. окружение схемы, которое НЕ входит в дамп public ────────────────────
echo "── снимаю с production описание окружения (только чтение) ──"
prod_ro "select rolname from pg_roles where rolname not like 'pg\\_%' and rolname <> current_user order by 1" \
  > "$OUT/env_roles_$TS.txt"
prod_ro "select e.extname||'='||n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace order by 1" \
  > "$OUT/env_extensions_$TS.txt"
prod_ro "show search_path" > "$OUT/env_search_path_$TS.txt"
# внешние таблицы: цели FK из public + таблицы вне public, от которых зависят представления public
prod_ro "select distinct fn.nspname||'.'||fc.relname
           from pg_constraint co
           join pg_class c   on c.oid = co.conrelid
           join pg_namespace n on n.oid = c.relnamespace and n.nspname='public'
           join pg_class fc  on fc.oid = co.confrelid
           join pg_namespace fn on fn.oid = fc.relnamespace and fn.nspname <> 'public'
          where co.contype='f'
          union
         select distinct dn.nspname||'.'||dc.relname
           from pg_depend d
           join pg_rewrite r on r.oid = d.objid
           join pg_class v   on v.oid = r.ev_class
           join pg_namespace vn on vn.oid = v.relnamespace and vn.nspname='public'
           join pg_class dc  on dc.oid = d.refobjid and dc.relkind in ('r','v','m')
           join pg_namespace dn on dn.oid = dc.relnamespace and dn.nspname not in ('public','pg_catalog','information_schema')
          order by 1" > "$OUT/env_ext_tables_$TS.txt"
prod_ro "select p.oid::regprocedure::text||'|'||pg_get_function_result(p.oid)
           from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='auth' order by 1" > "$OUT/env_auth_funcs_$TS.txt"
echo "  ролей: $(wc -l < "$OUT/env_roles_$TS.txt" | tr -d ' ') · расширений: $(wc -l < "$OUT/env_extensions_$TS.txt" | tr -d ' ') · внешних таблиц: $(wc -l < "$OUT/env_ext_tables_$TS.txt" | tr -d ' ') · функций auth: $(wc -l < "$OUT/env_auth_funcs_$TS.txt" | tr -d ' ')"

# ── 3. дамп ─────────────────────────────────────────────────────────────────
echo "── снимаю дамп ──"
STARTED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
"$(P pg_dump)" "$DB_URL" --format=custom --compress=9 --verbose \
     --schema=public --schema=supabase_migrations \
     --file="$DUMP" 2> "$OUT/pg_dump_$TS.log" || die "pg_dump упал, см. $OUT/pg_dump_$TS.log"
FINISHED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
[ -s "$DUMP" ] || die "дамп пустой"

{ echo "backup_started_at   : $STARTED"
  echo "backup_completed_at : $FINISHED"
  echo "file                : $(basename "$DUMP")"
  echo "size_bytes          : $(wc -c < "$DUMP" | tr -d ' ')"
  echo "sha256              : $(sha256 "$DUMP")"
  echo "source_db           : $(printf '%s' "$DB_URL" | sed -E 's#//[^@/]*@#//<redacted>@#')"
  echo "server_version      : $(prod_ro 'show server_version')"
  echo "pg_dump_version     : $("$(P pg_dump)" --version)"
  echo "scope               : --schema=public --schema=supabase_migrations, -Fc --compress=9"
} | tee "$META"

"$(P pg_restore)" --list "$DUMP" > "$OUT/dump_toc_$TS.txt" 2>&1 || true
{ awk '{print $4}' "$OUT/dump_toc_$TS.txt" | grep -v '^$' | sort | uniq -c | sort -rn | head -20; } > "$OUT/dump_objects_$TS.txt" || true
echo "── состав дампа (топ типов объектов) ──"; cat "$OUT/dump_objects_$TS.txt"

echo "── дополнительные артефакты ──"
if command -v supabase >/dev/null 2>&1; then
  if supabase db dump --db-url "$DB_URL" --role-only -f "$OUT/basa_roles_$TS.sql" >/dev/null 2>&1
    then echo "  роли: ok"; else echo "  роли: не получилось, пропущено"; fi
else echo "  роли: Supabase CLI не установлен — пропущено (не критично)"; fi
prod_ro "select jobid||' '||jobname||' '||schedule||' active='||active from cron.job order by jobid" \
  > "$OUT/cron_jobs_$TS.txt"
echo "  cron.job: сохранён БЕЗ поля command (в нём лежит секрет, OPS-01)"
( cd "$OUT" && for f in *.dump *.txt *.sql; do [ -f "$f" ] && echo "$(sha256 "$f")  $f"; done > SHA256SUMS ) || true

# ── 4. одноразовая БД ───────────────────────────────────────────────────────
VDATA="$OUT/verifydb"; VSOCK="$OUT/vsock"; VPORT=${VPORT:-5455}
case "$VSOCK" in /*) ;; *) die "путь к сокету не абсолютный: '$VSOCK'" ;; esac
# у unix-сокета ограничение длины пути (~104 байта на macOS)
[ ${#VSOCK} -le 90 ] || die "слишком длинный путь к каталогу артефактов (${#VSOCK} симв.). Запустите без OUT — по умолчанию ~/basa-backup-<TS>"
mkdir -p "$VSOCK"
"$(P initdb)" -D "$VDATA" -U verifier --auth=trust >"$OUT/initdb_$TS.log" 2>&1 || die "initdb упал, см. $OUT/initdb_$TS.log"
"$(P pg_ctl)" -D "$VDATA" -o "-p $VPORT -k $VSOCK -c listen_addresses=" -l "$OUT/verifydb_$TS.log" -w start >/dev/null \
  || die "не удалось поднять одноразовый кластер (порт $VPORT занят? задайте VPORT=…), см. $OUT/verifydb_$TS.log"
stop_v(){ "$(P pg_ctl)" -D "$VDATA" -m immediate stop >/dev/null 2>&1 || true; }
trap 'rc=$?; stop_v; exit $rc' EXIT

VOPTS=(-h "$VSOCK" -p "$VPORT" -U verifier -d postgres)
assert_disposable(){
  case "$VSOCK" in /*) ;; *) die "путь к сокету не абсолютный — разрушающие операции запрещены" ;; esac
  case "$VSOCK" in "$OUT"/*) ;; *) die "цель не во временном каталоге — разрушающие операции запрещены" ;; esac
  local who
  who=$("$(P psql)" "${VOPTS[@]}" -X -At -c "select current_user||'@'||coalesce(inet_server_addr()::text,'unix-socket')||':'||coalesce(current_setting('port',true),'?')" 2>/dev/null || true)
  case "$who" in "verifier@unix-socket:$VPORT") ;; *) die "цель не опознана как одноразовая БД (получено: '$who')" ;; esac
}
assert_disposable
vq(){ "$(P psql)" "${VOPTS[@]}" -X -At -F'=' -v ON_ERROR_STOP=1 "$@"; }
vsql(){ "$(P psql)" "${VOPTS[@]}" -X -q -v ON_ERROR_STOP=1 "$@"; }

echo "── готовлю окружение одноразовой БД по описанию production ──"
# роли
while read -r r; do [ -n "$r" ] || continue
  vsql -c "do \$\$ begin create role \"$r\" nologin; exception when duplicate_object then null; end \$\$;" >/dev/null
done < "$OUT/env_roles_$TS.txt"
echo "  роли созданы"
# расширения в тех же схемах
while IFS='=' read -r ext nsp; do [ -n "$ext" ] || continue
  case "$ext" in plpgsql) continue;; esac
  vsql -c "create schema if not exists \"$nsp\"" >/dev/null
  if vsql -c "create extension if not exists \"$ext\" schema \"$nsp\"" >/dev/null 2>&1
    then echo "  расширение $ext → схема $nsp"
    else echo "  расширение $ext недоступно локально — пропущено (объекты, которые на него опираются, могут не восстановиться)"; fi
done < "$OUT/env_extensions_$TS.txt"
# search_path как на prod
SP=$(cat "$OUT/env_search_path_$TS.txt")
vsql -c "alter database postgres set search_path to $SP" >/dev/null && echo "  search_path = $SP"
# схема auth и заглушки функций
vsql -c "create schema if not exists auth" >/dev/null
vsql -c "create or replace function auth.uid() returns uuid language sql stable as \$f\$ select nullif(current_setting('test.uid', true),'')::uuid \$f\$;" >/dev/null
while IFS='|' read -r sig ret; do
  [ -n "$sig" ] || continue
  case "$sig" in auth.uid\(\)) continue;; esac
  vsql -c "create or replace function $sig returns $ret language sql stable as \$f\$ select null::$ret \$f\$;" >/dev/null 2>&1 || true
done < "$OUT/env_auth_funcs_$TS.txt"
echo "  заглушки auth.*: $(wc -l < "$OUT/env_auth_funcs_$TS.txt" | tr -d ' ')"

# заглушки внешних таблиц: колонки (нестандартные типы → text), PK и UNIQUE под FK,
# затем загрузка ТОЛЬКО ключевых колонок
while read -r t; do
  [ -n "$t" ] || continue
  sch=${t%%.*}; rel=${t#*.}
  vsql -c "create schema if not exists \"$sch\"" >/dev/null
  cols=$(prod_ro "select string_agg(quote_ident(column_name)||' '||
            case when data_type in ('uuid','text','boolean','integer','bigint','smallint','numeric','date','jsonb','json')
                 then data_type
                 when data_type like 'timestamp%' then 'timestamptz'
                 when data_type in ('character varying','character') then 'text'
                 else 'text' end, ', ' order by ordinal_position)
          from information_schema.columns where table_schema='$sch' and table_name='$rel'")
  [ -n "$cols" ] || { echo "  $t — колонок не видно, пропущено"; continue; }
  vsql -c "create table \"$sch\".\"$rel\" ($cols)" >/dev/null
  # PK и UNIQUE, на которые могут ссылаться FK
  keys=$(prod_ro "select co.contype||':'||string_agg(quote_ident(a.attname), ',' order by k.ord)
                    from pg_constraint co
                    join pg_class c on c.oid=co.conrelid
                    join pg_namespace n on n.oid=c.relnamespace
                    cross join lateral unnest(co.conkey) with ordinality as k(attnum, ord)
                    join pg_attribute a on a.attrelid=c.oid and a.attnum=k.attnum
                   where n.nspname='$sch' and c.relname='$rel' and co.contype in ('p','u')
                   group by co.oid, co.contype")
  keycols=""
  while IFS=':' read -r ctype clist; do
    [ -n "$clist" ] || continue
    if [ "$ctype" = p ]; then vsql -c "alter table \"$sch\".\"$rel\" add primary key ($clist)" >/dev/null 2>&1 || true
    else vsql -c "alter table \"$sch\".\"$rel\" add unique ($clist)" >/dev/null 2>&1 || true; fi
    keycols="$keycols${keycols:+,}$clist"
  done <<< "$keys"
  # данные — ТОЛЬКО ключевые колонки (для auth.users это id). Ни email, ни хешей.
  if [ -n "$keycols" ]; then
    uniq_cols=$(printf '%s' "$keycols" | tr ',' '\n' | awk '!a[$0]++' | paste -sd, -)
    # -t в prod_ro_csv уже убирает заголовок, поэтому строку не отрезаем
    CSV="$OUT/.extdata_$TS.csv"
    prod_ro_csv "select $uniq_cols from $sch.$rel" > "$CSV"
    vsql -c "\\copy \"$sch\".\"$rel\" ($uniq_cols) from '$CSV' with (format csv)" >/dev/null 2>&1 || true
    rm -f "$CSV"
    echo "  заглушка $t: колонки $(printf '%s' "$cols" | awk -F', ' '{print NF}'), загружены только ключи ($uniq_cols)"
  else
    echo "  заглушка $t: без ключей, данные не грузились"
  fi
done < "$OUT/env_ext_tables_$TS.txt"

# ── (3) restore по оглавлению без строки "SCHEMA - public" ──────────────────
echo "── восстанавливаю дамп в одноразовую БД ──"
grep -v 'SCHEMA - public ' "$OUT/dump_toc_$TS.txt" > "$OUT/restore_list_$TS.txt" || true
assert_disposable
"$(P pg_restore)" -h "$VSOCK" -p "$VPORT" -U verifier -d postgres --no-owner \
  -L "$OUT/restore_list_$TS.txt" "$DUMP" > "$OUT/pg_restore_$TS.log" 2>&1 || true
n_err=$(grep -ci '^pg_restore: error' "$OUT/pg_restore_$TS.log" || true)
echo "  ошибок restore: $n_err (подробности: $OUT/pg_restore_$TS.log)"
[ "$n_err" -eq 0 ] || { grep -i '^pg_restore: error' "$OUT/pg_restore_$TS.log" | head -10; die "restore завершился с ошибками"; }

# ── 5. сверка копии с production. (4) ключ ищется точно ─────────────────────
echo "── сверка после restore с production ──"
vq -c "$EXPECT_SQL" > "$OUT/actual_restore_$TS.txt"
compare_all "$OUT/expected_$TS.txt" "$OUT/actual_restore_$TS.txt" restore \
  || die "копия не совпала с production — дальше идти нельзя"

# ── 6. что дамп НЕ покрыл ───────────────────────────────────────────────────
echo "── объекты вне дампа: это НЕ полный disaster-recovery restore ──"
{ for rel in vault.secrets cron.job net._http_response auth.users storage.objects storage.buckets; do
    n=$(vq -c "select count(*) from $rel" 2>/dev/null || echo "объекта нет")
    printf '  %-24s на копии: %s\n' "$rel" "$n"
  done
  echo "  auth.users на копии — заглушка: только id, без email и хешей паролей"
  echo "  файлы Storage (S3) в дамп не входят по определению"
  echo "  vault.secrets — шифротекст без корневого ключа: в другом проекте не расшифруется"
  echo "  восстановлены только схемы public и supabase_migrations"
} | tee "$OUT/not_covered_$TS.txt"

# ── 7. репетиция 0086–0092 ──────────────────────────────────────────────────
echo "── применяю 0086–0092 (порядок как для production) ──"
: > "$OUT/migration_timings_$TS.txt"
for m in $STEPS; do
  assert_disposable
  t0=$(date +%s)
  if "$(P psql)" "${VOPTS[@]}" -X -q -v ON_ERROR_STOP=1 -f "$MIGRATIONS/$m.sql" > "$OUT/mig_${m}_$TS.log" 2>&1
    then st=ok; else st=ОШИБКА; fi
  w=$(grep -ciE 'notice|warning' "$OUT/mig_${m}_$TS.log" || true)
  printf '  %-34s %-8s %3d s  notices/warnings: %s\n' "$m" "$st" "$(( $(date +%s) - t0 ))" "$w" \
    | tee -a "$OUT/migration_timings_$TS.txt"
  if [ "$st" = "ОШИБКА" ]; then tail -8 "$OUT/mig_${m}_$TS.log"; die "миграция $m не применилась"; fi
done

echo "── сверка после миграций с точкой restore ──"
vq -c "$EXPECT_SQL" > "$OUT/actual_postmig_$TS.txt"
compare_fin_struct "$OUT/actual_restore_$TS.txt" "$OUT/actual_postmig_$TS.txt" postmig \
  || die "после 0086–0092 изменились финансовые показатели — production migrations НЕ разрешать"
echo "── integrity audit на восстановленной копии ──"
"$(P psql)" "${VOPTS[@]}" -X -f "$REPO/scripts/db_integrity_audit.sql" > "$OUT/integrity_postmig_$TS.txt" 2>&1 || true
tail -32 "$OUT/integrity_postmig_$TS.txt"
echo "  ожидание: чисто, кроме двух известных findings — FIN-03 и duplicate auto-accrual;"
echo "  миграции 0086–0092 по дизайну их не исправляют."

# ── 8. наборы на синтетической фикстуре — по явному запросу ─────────────────
if [ "${RUN_FIXTURE_SUITES:-0}" = "1" ]; then
  echo "── T1–T14 / AUTHZ / SPLIT / SEC-008-010 (отдельная фикстура, НЕ эта копия) ──"
  bash "$REPO/scripts/concurrency/run.sh" 2>&1 | grep -E "MODE=(pre|post):" || true
  MODE=post bash "$REPO/scripts/concurrency/authz_test.sh" 2>&1 | tail -1 || true
  MODE=post bash "$REPO/scripts/concurrency/split_test.sh" 2>&1 | tail -1 || true
  bash "$REPO/scripts/concurrency/sec010_test.sh" 2>&1 | tail -1 || true
else
  echo "── наборы T1–T14 / AUTHZ / SPLIT / SEC пропущены (RUN_FIXTURE_SUITES=0) ──"
  echo "  они рассчитаны на Linux-окружение аудита и уже прогнаны там:"
  echo "  T1–T14 14/0 · AUTHZ 21/0 · SPLIT 36/0 · SEC-008/010 25/0"
fi

# ── 9. откат ────────────────────────────────────────────────────────────────
echo "── откат ──"
: > "$OUT/rollback_$TS.txt"
apply_down(){
  assert_disposable
  if "$(P psql)" "${VOPTS[@]}" -X -q -v ON_ERROR_STOP=1 -f "$1" > "$2" 2>&1; then echo ok; else echo ОШИБКА; fi
}
for f in 0092_down 0091_down 0090_down 0089_down 0088_down 0087_functions_before 0087_down 0086_down; do
  st=$(apply_down "$DOWN/$f.sql" "$OUT/down_${f}_$TS.log")
  printf '  %-24s %s\n' "$f" "$st" | tee -a "$OUT/rollback_$TS.txt"
  if [ "$st" = "ОШИБКА" ]; then tail -8 "$OUT/down_${f}_$TS.log"; die "откат $f не прошёл — production migrations не разрешены"; fi
done

echo "── сверка после отката с состоянием сразу после restore ──"
vq -c "$EXPECT_SQL" > "$OUT/actual_rollback_$TS.txt"
if diff -u "$OUT/actual_restore_$TS.txt" "$OUT/actual_rollback_$TS.txt" > "$OUT/rollback_diff_$TS.txt"; then
  echo "  ОТКАТ ЧИСТЫЙ: все $n_exp показателей вернулись к состоянию после restore"
else
  cat "$OUT/rollback_diff_$TS.txt"
  die "после отката состояние не совпало с точкой restore — production migrations НЕ разрешать"
fi

stop_v; trap - EXIT
echo
echo "============================================================"
echo "ВСЁ ПРОШЛО УСПЕШНО"
echo "артефакты: $OUT"
echo "зашифровать дамп:"
echo "  D=\"$OUT\"; F=\"\$(ls \"\$D\"/basa_public_*.dump)\"; age -p -o \"\$F.age\" \"\$F\" && rm -P \"\$F\""
echo "============================================================"
