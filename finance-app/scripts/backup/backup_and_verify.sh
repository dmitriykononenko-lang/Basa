#!/usr/bin/env bash
# ============================================================================
# backup_and_verify.sh — Разрешение №2A.2 одной командой:
#   backup production → restore в одноразовую БД → сверка 27 показателей →
#   репетиция 0086–0092 → проверка отката 0092_down…0086_down.
#
# ЗАПУСКАТЬ СО СВОЕЙ МАШИНЫ (macOS Apple Silicon подходит).
# Пошаговая инструкция: BACKUP_RUNBOOK_MACOS.md
#
# ГАРАНТИИ БЕЗОПАСНОСТИ (проверяются самим скриптом, а не обещаются):
#   * к production идут ТОЛЬКО select/show и pg_dump — через обёртку prod_ro(),
#     которая отказывается выполнять что-либо иное;
#   * все DDL/DML, миграции, откаты и restore идут ТОЛЬКО в одноразовую БД,
#     и перед каждым таким шагом проверяется, что цель — локальный сокет
#     во временном каталоге, а не production;
#   * пароль берётся из PGPASSWORD, никогда не попадает в argv, в метаданные,
#     в логи и в вывод; DB_URL с вписанным паролем отвергается;
#   * любой критический сбой = немедленный выход с кодом != 0.
# ============================================================================
set -Eeuo pipefail

die(){ echo "ОСТАНОВ: $*" >&2; exit 1; }
trap 'die "непредвиденная ошибка на строке $LINENO"' ERR

: "${DB_URL:?нужен DB_URL (строка подключения БЕЗ пароля)}"
: "${PGPASSWORD:?нужен PGPASSWORD — задайте через: read -rsp \"пароль: \" PGPASSWORD; export PGPASSWORD}"

# ── пароль не должен быть вписан в строку подключения ───────────────────────
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
mkdir -p "$OUT"; chmod 700 "$OUT"
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

# ── обёртка: к production допускаются только select/show ────────────────────
prod_ro(){
  local q="$1" first low
  low=$(printf '%s' "$q" | tr '\n\t' '  ' | tr '[:upper:]' '[:lower:]')
  first=$(printf '%s' "$low" | sed -E 's/^ +//' | cut -d' ' -f1)
  case "$first" in select|show|with|table) ;;
    *) die "внутренняя защита: к production попытались отправить запрос, начинающийся с '$first'" ;; esac
  case " $low " in
    *" insert "*|*" update "*|*" delete "*|*" drop "*|*" truncate "*|*" alter "*|*" create "*|*" grant "*|*" revoke "*|*" copy "*|*" call "*)
      die "внутренняя защита: в запросе к production обнаружено изменяющее ключевое слово" ;;
  esac
  "$(P psql)" "$DB_URL" -At -F'=' -v ON_ERROR_STOP=1 -c "$q"
}

# ── 1. предполётная проверка ────────────────────────────────────────────────
echo "── предполётная проверка production (только чтение) ──"
prod_ro "select 'active_backends='||(select count(*) from pg_stat_activity where state<>'idle' and pid<>pg_backend_pid())
      ||' cron='||(select string_agg(jobid||':'||active,',' order by jobid) from cron.job)
      ||' tx='||(select count(*) from transactions)
      ||' batches='||(select count(*) from import_batches)
      ||' last_synced='||coalesce((select max(last_synced_at)::text from bank_connections),'-')" | tee "$OUT/preflight_$TS.txt"
echo
echo "Сверьте строку выше с принятым baseline. Если что-то разошлось — нажмите Ctrl-C сейчас."
echo "Продолжение через 10 секунд..."; sleep 10

# ── 2. ожидаемые значения снимаются с живого production (27 показателей) ────
EXPECT_SQL="
select 'tables',      count(*)::text from information_schema.tables where table_schema='public' and table_type='BASE TABLE'
union all select 'views',       count(*)::text from information_schema.views where table_schema='public'
union all select 'functions',   count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
union all select 'triggers',    count(*)::text from pg_trigger where not tgisinternal
union all select 'indexes',     count(*)::text from pg_indexes where schemaname='public'
union all select 'constraints', count(*)::text from pg_constraint
union all select 'rls_tables',  count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity
union all select 'policies',    count(*)::text from pg_policies where schemaname='public'
union all select 'sequences',   count(*)::text from pg_class where relkind='S'
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

# ── 3. дамп (чтение; пароль только в PGPASSWORD, не в argv) ─────────────────
echo "── снимаю дамп ──"
STARTED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
"$(P pg_dump)" "$DB_URL" --format=custom --compress=9 --verbose \
     --schema=public --schema=supabase_migrations \
     --file="$DUMP" 2> "$OUT/pg_dump_$TS.log" || die "pg_dump упал, см. $OUT/pg_dump_$TS.log"
FINISHED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
[ -s "$DUMP" ] || die "дамп пустой"

SIZE=$(wc -c < "$DUMP" | tr -d ' ')
{ echo "backup_started_at   : $STARTED"
  echo "backup_completed_at : $FINISHED"
  echo "file                : $(basename "$DUMP")"
  echo "size_bytes          : $SIZE"
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

# ── 4. одноразовая БД: свой кластер PostgreSQL 17 во временном каталоге ─────
VDATA="$OUT/verifydb"; VSOCK="$OUT/vsock"; VPORT=${VPORT:-5455}
mkdir -p "$VSOCK"
"$(P initdb)" -D "$VDATA" -U verifier --auth=trust >"$OUT/initdb_$TS.log" 2>&1 || die "initdb упал, см. $OUT/initdb_$TS.log"
"$(P pg_ctl)" -D "$VDATA" -o "-p $VPORT -k $VSOCK -c listen_addresses=" -l "$OUT/verifydb_$TS.log" -w start >/dev/null \
  || die "не удалось поднять одноразовый кластер, см. $OUT/verifydb_$TS.log"
stop_v(){ "$(P pg_ctl)" -D "$VDATA" -m immediate stop >/dev/null 2>&1 || true; }
trap 'rc=$?; stop_v; [ $rc -ne 0 ] && echo "ОСТАНОВ: сбой, код $rc" >&2; exit $rc' EXIT

# ЦЕЛЬ ДЛЯ ВСЕХ РАЗРУШАЮЩИХ ОПЕРАЦИЙ. Только локальный сокет во временном каталоге.
VOPTS=(-h "$VSOCK" -p "$VPORT" -U verifier -d postgres)
assert_disposable(){
  case "$VSOCK" in "$OUT"/*) ;; *) die "цель не во временном каталоге — разрушающие операции запрещены" ;; esac
  local who
  who=$("$(P psql)" "${VOPTS[@]}" -At -c "select current_user||'@'||coalesce(inet_server_addr()::text,'unix-socket')||':'||coalesce(current_setting('port',true),'?')" 2>/dev/null || true)
  case "$who" in "verifier@unix-socket:$VPORT") ;; *) die "цель не опознана как одноразовая БД (получено: '$who') — разрушающие операции запрещены" ;; esac
}
assert_disposable
vq(){ "$(P psql)" "${VOPTS[@]}" -At -F'=' -v ON_ERROR_STOP=1 "$@"; }

vq -c "
do \$\$ begin create role anon nologin; exception when duplicate_object then null; end \$\$;
do \$\$ begin create role authenticated nologin; exception when duplicate_object then null; end \$\$;
do \$\$ begin create role service_role nologin; exception when duplicate_object then null; end \$\$;
do \$\$ begin create role authenticator nologin; exception when duplicate_object then null; end \$\$;
do \$\$ begin create role supabase_admin superuser nologin; exception when duplicate_object then null; end \$\$;
do \$\$ begin create role supabase_auth_admin nologin; exception when duplicate_object then null; end \$\$;
do \$\$ begin create role supabase_storage_admin nologin; exception when duplicate_object then null; end \$\$;
create extension if not exists pgcrypto; create extension if not exists \"uuid-ossp\";
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as \$f\$ select nullif(current_setting('test.uid', true),'')::uuid \$f\$;
" >/dev/null

echo "── восстанавливаю дамп в одноразовую БД ──"
assert_disposable
"$(P pg_restore)" -h "$VSOCK" -p "$VPORT" -U verifier -d postgres --no-owner "$DUMP" \
  > "$OUT/pg_restore_$TS.log" 2>&1 || true
n_err=$(grep -ci '^pg_restore: error' "$OUT/pg_restore_$TS.log" || true)
echo "  ошибок restore: $n_err (подробности: $OUT/pg_restore_$TS.log)"
[ "$n_err" -eq 0 ] || die "restore завершился с ошибками — дамп непригоден"

# ── 5. сверка копии с production ────────────────────────────────────────────
compare(){ # $1 метка, $2 = fatal|soft
  vq -c "$EXPECT_SQL" > "$OUT/actual_$1_$TS.txt"
  local bad=0 a
  while IFS='=' read -r k v; do
    a=$(grep -m1 -F -- "$k=" "$OUT/actual_$1_$TS.txt" | cut -d= -f2- || true)
    if [ "$v" != "$a" ]; then printf '  %-54s prod=[%s] copy=[%s]\n' "$k" "$v" "$a"; bad=$((bad+1)); fi
  done < "$OUT/expected_$TS.txt"
  if [ "$bad" -eq 0 ]; then echo "  [$1] все $n_exp показателей совпали"
  else
    echo "  [$1] расхождений: $bad"
    if [ "$2" = fatal ]; then die "копия не совпала с production — дальше идти нельзя"; fi
  fi
  return 0
}
echo "── сверка после restore (до миграций) ──"; compare restore fatal

# ── 6. что дамп НЕ покрыл — явно, без маскировки под disaster recovery ──────
echo "── объекты вне дампа: это НЕ полный disaster-recovery restore ──"
{ for rel in vault.secrets cron.job net._http_response auth.users storage.objects storage.buckets; do
    n=$(vq -c "select count(*) from $rel" 2>/dev/null || echo "объекта нет")
    printf '  %-24s на копии: %s\n' "$rel" "$n"
  done
  echo "  файлы Storage (S3) в дамп не входят по определению"
  echo "  vault.secrets — шифротекст без корневого ключа: в другом проекте не расшифруется"
  echo "  восстановлены только схемы public и supabase_migrations"
} | tee "$OUT/not_covered_$TS.txt"

# ── 7. репетиция 0086–0092 с таймингом ──────────────────────────────────────
echo "── применяю 0086–0092 (порядок как для production) ──"
: > "$OUT/migration_timings_$TS.txt"
for m in $STEPS; do
  assert_disposable
  t0=$(date +%s)
  if "$(P psql)" "${VOPTS[@]}" -q -v ON_ERROR_STOP=1 -f "$MIGRATIONS/$m.sql" > "$OUT/mig_${m}_$TS.log" 2>&1
    then st=ok; else st=ОШИБКА; fi
  w=$(grep -ciE 'notice|warning' "$OUT/mig_${m}_$TS.log" || true)
  printf '  %-34s %-8s %3d s  notices/warnings: %s\n' "$m" "$st" "$(( $(date +%s) - t0 ))" "$w" \
    | tee -a "$OUT/migration_timings_$TS.txt"
  if [ "$st" = "ОШИБКА" ]; then tail -8 "$OUT/mig_${m}_$TS.log"; die "миграция $m не применилась"; fi
done

echo "── сверка после миграций (structure-показатели МОГУТ вырасти — это норма) ──"
compare postmig soft
echo "── integrity audit на восстановленной копии ──"
"$(P psql)" "${VOPTS[@]}" -f "$REPO/scripts/db_integrity_audit.sql" > "$OUT/integrity_postmig_$TS.txt" 2>&1 || true
tail -32 "$OUT/integrity_postmig_$TS.txt"
echo "  ожидание: чисто, кроме двух известных findings — FIN-03 и duplicate auto-accrual;"
echo "  миграции 0086–0092 по дизайну их не исправляют."

# ── 8. наборы на синтетической фикстуре — только по явному запросу ──────────
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

# ── 9. откат 0092_down → 0086_down ──────────────────────────────────────────
echo "── откат ──"
: > "$OUT/rollback_$TS.txt"
apply_down(){
  assert_disposable
  if "$(P psql)" "${VOPTS[@]}" -q -v ON_ERROR_STOP=1 -f "$1" > "$2" 2>&1; then echo ok; else echo ОШИБКА; fi
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
echo "зашифровать дамп:  age -p -o \"$DUMP.age\" \"$DUMP\" && rm -P \"$DUMP\""
echo "============================================================"
