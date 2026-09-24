#!/usr/bin/env bash
# ============================================================================
# backup_and_verify.sh — выполняет MANUAL_BACKUP_PLAN.md и Разрешение №2A.2
# одной командой: backup → restore → сверка → репетиция 0086–0092 → откат.
#
# ЗАПУСКАТЬ СО СВОЕЙ МАШИНЫ, не из сессии агента: нужен клиент PostgreSQL 17
# (сервер 17.6) и сетевой доступ к БД Supabase. В контейнере агента нет ни
# того, ни другого: клиент только 16.13, apt.postgresql.org и хост БД режет
# сетевая политика, docker-демон не запущен.
#
#   export DB_URL='postgresql://postgres.<ref>@<POOLER_HOST>:5432/postgres?sslmode=require'
#   read -rsp 'DB password: ' PGPASSWORD; export PGPASSWORD; echo
#   bash scripts/backup/backup_and_verify.sh
#
# Production НЕ изменяется: к нему идут только SELECT и pg_dump.
# Ожидаемые значения не зашиты — снимаются с production в момент запуска.
# ============================================================================
set -euo pipefail

: "${DB_URL:?нужен DB_URL}"
: "${PGPASSWORD:?нужен PGPASSWORD (через read -rs, не в истории команд)}"

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$HERE/../.."
MIGRATIONS="$REPO/supabase/migrations"
DOWN="$MIGRATIONS/rollback"
STEPS="0086_guard_constraints 0087_accrual_idempotency 0088_financial_rpcs 0089_optimistic_concurrency 0090_bank_event_identity 0091_write_paths_and_authz 0092_transaction_lines"

TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT=${OUT:-"$HOME/basa-backup-$TS"}
mkdir -p "$OUT"; chmod 700 "$OUT"
DUMP="$OUT/basa_public_$TS.dump"
META="$OUT/backup_metadata_$TS.txt"

# ── клиент 17: локальный, иначе docker ──────────────────────────────────────
if command -v pg_dump >/dev/null && pg_dump --version | grep -qE ' 1[7-9]\.'; then
  PGD=pg_dump; PGR=pg_restore; PSQL=psql
  echo "клиент: локальный $(pg_dump --version)"
elif command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  D="docker run --rm -i --network host -e PGPASSWORD -v $OUT:/out postgres:17"
  PGD="$D pg_dump"; PGR="$D pg_restore"; PSQL="$D psql"
  echo "клиент: docker postgres:17"
else
  echo "ОСТАНОВ: нужен pg_dump >= 17 либо работающий docker." >&2
  echo "Подсказка: сервер PostgreSQL 17 без docker можно получить из npm" >&2
  echo "  npm i @embedded-postgres/linux-x64@17.6.0-beta.15   (initdb/pg_ctl/postgres)," >&2
  echo "  но pg_dump/pg_restore/psql там НЕ поставляются — их нужно ставить отдельно." >&2
  exit 1
fi
dpath(){ case "$PGD" in docker*) echo "/out/$(basename "$1")";; *) echo "$1";; esac; }

# ── 1. предполётная проверка заморозки ──────────────────────────────────────
echo "── предполётная проверка ──"
$PSQL "$DB_URL" -At -F'|' -c "
select (select count(*) from pg_stat_activity where state<>'idle' and pid<>pg_backend_pid()) as active,
       (select string_agg(jobid||':'||active,',' order by jobid) from cron.job) as cron,
       (select count(*) from transactions) as tx,
       (select count(*) from import_batches) as batches,
       (select max(last_synced_at) from bank_connections) as last_synced;" | tee "$OUT/preflight_$TS.txt"
echo "Прервите (Ctrl-C), если active<>0, cron<>1:f,2:f или счётчики разошлись с принятым baseline."
sleep 5

# ── 2. снимок ожидаемых значений с production (27 показателей) ──────────────
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
$PSQL "$DB_URL" -At -F'=' -c "$EXPECT_SQL" > "$OUT/expected_$TS.txt"
echo "ожидаемых показателей: $(wc -l < "$OUT/expected_$TS.txt")"

# ── 3. дамп ─────────────────────────────────────────────────────────────────
STARTED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
$PGD "$DB_URL" --format=custom --compress=9 --verbose \
     --schema=public --schema=supabase_migrations \
     --file="$(dpath "$DUMP")" 2> "$OUT/pg_dump_$TS.log"
FINISHED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
sha(){ sha256sum "$1" 2>/dev/null | cut -d' ' -f1 || shasum -a 256 "$1" | cut -d' ' -f1; }

{ echo "backup_started_at   : $STARTED"
  echo "backup_completed_at : $FINISHED"
  echo "file                : $(basename "$DUMP")"
  echo "size_bytes          : $(stat -c%s "$DUMP" 2>/dev/null || stat -f%z "$DUMP")"
  echo "sha256              : $(sha "$DUMP")"
  echo "source_db           : $(echo "$DB_URL" | sed -E 's#//[^@]*@#//<redacted>@#')"
  echo "server_version      : $($PSQL "$DB_URL" -At -c 'show server_version')"
  echo "pg_dump_version     : $($PGD --version)"
  echo "scope               : --schema=public --schema=supabase_migrations, -Fc --compress=9"
} | tee "$META"

echo "── что реально вошло в дамп (оглавление) ──"
$PGR --list "$(dpath "$DUMP")" > "$OUT/dump_toc_$TS.txt" 2>&1 || true
awk '{print $4}' "$OUT/dump_toc_$TS.txt" | grep -v '^$' | sort | uniq -c | sort -rn | head -20 | tee "$OUT/dump_objects_$TS.txt"

echo "── дополнительные артефакты (то, чего в дампе нет) ──"
if command -v supabase >/dev/null; then
  supabase db dump --db-url "$DB_URL" --role-only -f "$OUT/basa_roles_$TS.sql" && echo "  роли: ok" || echo "  роли: пропущено"
else echo "  роли: supabase CLI не установлен — пропущено"; fi
$PSQL "$DB_URL" -At -c "select jobid, jobname, schedule, active from cron.job order by jobid" > "$OUT/cron_jobs_$TS.txt"
echo "  cron.job: $(wc -l < "$OUT/cron_jobs_$TS.txt") строк (без поля command — оно содержит секрет, OPS-01)"
(cd "$OUT" && sha256sum ./*.dump ./*.txt 2>/dev/null > SHA256SUMS; true)

# ── 4. одноразовый PostgreSQL 17 и восстановление ───────────────────────────
command -v docker >/dev/null && docker info >/dev/null 2>&1 || { echo "для проверки нужен docker" >&2; exit 1; }
docker rm -f basa-verify >/dev/null 2>&1 || true
docker run -d --name basa-verify -e POSTGRES_PASSWORD=verify -p 5455:5432 postgres:17 >/dev/null
V='postgresql://postgres:verify@localhost:5455/postgres'
until psql "$V" -c 'select 1' >/dev/null 2>&1; do sleep 1; done

psql "$V" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticator nologin; exception when duplicate_object then null; end $$;
do $$ begin create role supabase_admin superuser nologin; exception when duplicate_object then null; end $$;
do $$ begin create role supabase_auth_admin nologin; exception when duplicate_object then null; end $$;
do $$ begin create role supabase_storage_admin nologin; exception when duplicate_object then null; end $$;
create extension if not exists pgcrypto; create extension if not exists "uuid-ossp";
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('test.uid', true),'')::uuid $f$;
SQL

pg_restore --dbname="$V" --no-owner "$DUMP" > "$OUT/pg_restore_$TS.log" 2>&1 || true
echo "строк с ошибками/предупреждениями при restore: $(grep -ci 'error\|warning' "$OUT/pg_restore_$TS.log" || true) — см. $OUT/pg_restore_$TS.log"

# ── 5. сверка восстановленной копии с production ────────────────────────────
compare(){
  psql "$V" -At -F'=' -c "$EXPECT_SQL" > "$OUT/actual_$1_$TS.txt"
  local bad=0 a
  while IFS='=' read -r k v; do
    a=$(grep -m1 -F "$k=" "$OUT/actual_$1_$TS.txt" | cut -d= -f2-)
    [ "$v" != "$a" ] && { printf '  %-54s prod=[%s] copy=[%s]\n' "$k" "$v" "$a"; bad=$((bad+1)); }
  done < "$OUT/expected_$TS.txt"
  [ "$bad" = 0 ] && echo "  [$1] все показатели совпали" || echo "  [$1] расхождений: $bad"
  return 0
}
echo "── сверка после restore (до миграций) ──"; compare restore

# ── 6. что manual backup НЕ покрыл — показываем явно ────────────────────────
echo "── объекты вне дампа: это НЕ полный disaster-recovery restore ──"
{ for rel in vault.secrets cron.job net._http_response auth.users storage.objects storage.buckets; do
    n=$(psql "$V" -At -c "select count(*) from $rel" 2>/dev/null || echo "объекта нет")
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
  t0=$(date +%s)
  if psql "$V" -q -v ON_ERROR_STOP=1 -f "$MIGRATIONS/$m.sql" > "$OUT/mig_${m}_$TS.log" 2>&1; then st=ok; else st=ОШИБКА; fi
  printf '  %-34s %-8s %3d s  notices/warnings: %s\n' "$m" "$st" "$(( $(date +%s) - t0 ))" \
    "$(grep -ciE 'notice|warning' "$OUT/mig_${m}_$TS.log" || true)" | tee -a "$OUT/migration_timings_$TS.txt"
  [ "$st" = "ОШИБКА" ] && { tail -5 "$OUT/mig_${m}_$TS.log"; exit 1; }
done

echo "── сверка после миграций (structure-показатели МОГУТ вырасти) ──"; compare postmig
echo "── integrity audit на восстановленной копии ──"
psql "$V" -f "$REPO/scripts/db_integrity_audit.sql" 2>&1 | tail -32 | tee "$OUT/integrity_postmig_$TS.txt"
echo "  ожидание: чисто, кроме двух известных findings — FIN-03 = 126 и duplicate auto-accrual = 1;"
echo "  миграции 0086–0092 по дизайну их не исправляют."

# ── 8. наборы тестов (синтетическая фикстура, НЕ эта копия) ─────────────────
echo "── T1–T14 / AUTHZ / SPLIT / SEC-008-010 на одноразовой фикстуре ──"
bash "$REPO/scripts/concurrency/run.sh" 2>&1 | grep -E "MODE=(pre|post):" || true
MODE=post bash "$REPO/scripts/concurrency/authz_test.sh" 2>&1 | tail -1
MODE=post bash "$REPO/scripts/concurrency/split_test.sh" 2>&1 | tail -1
bash "$REPO/scripts/concurrency/sec010_test.sh" 2>&1 | tail -1

# ── 9. откат 0092_down → 0086_down на этой же копии ─────────────────────────
echo "── откат ──"
: > "$OUT/rollback_$TS.txt"
run_down(){ psql "$V" -q -v ON_ERROR_STOP=1 -f "$1" > "$2" 2>&1 && echo ok || echo ОШИБКА; }
for m in 0092 0091 0090 0089 0088; do
  st=$(run_down "$DOWN/${m}_down.sql" "$OUT/down_${m}_$TS.log")
  printf '  %-22s %s\n' "${m}_down" "$st" | tee -a "$OUT/rollback_$TS.txt"
  [ "$st" = "ОШИБКА" ] && { tail -5 "$OUT/down_${m}_$TS.log"; exit 1; }
done
st=$(run_down "$DOWN/0087_functions_before.sql" "$OUT/down_0087fn_$TS.log")
printf '  %-22s %s\n' "0087_functions_before" "$st" | tee -a "$OUT/rollback_$TS.txt"
[ "$st" = "ОШИБКА" ] && { tail -5 "$OUT/down_0087fn_$TS.log"; exit 1; }
for m in 0087 0086; do
  st=$(run_down "$DOWN/${m}_down.sql" "$OUT/down_${m}_$TS.log")
  printf '  %-22s %s\n' "${m}_down" "$st" | tee -a "$OUT/rollback_$TS.txt"
  [ "$st" = "ОШИБКА" ] && { tail -5 "$OUT/down_${m}_$TS.log"; exit 1; }
done

echo "── сверка после отката с состоянием сразу после restore ──"
psql "$V" -At -F'=' -c "$EXPECT_SQL" > "$OUT/actual_rollback_$TS.txt"
if diff -u "$OUT/actual_restore_$TS.txt" "$OUT/actual_rollback_$TS.txt" > "$OUT/rollback_diff_$TS.txt"; then
  echo "  ОТКАТ ЧИСТЫЙ: все показатели вернулись к состоянию после restore"
else
  echo "  РАСХОЖДЕНИЯ ПОСЛЕ ОТКАТА — production migrations НЕ разрешать до разбора:"
  cat "$OUT/rollback_diff_$TS.txt"
fi

echo
echo "готово. артефакты: $OUT"
echo "зашифровать дамп: age -p -o $DUMP.age $DUMP && shred -u $DUMP"
echo "снести копию:     docker rm -f basa-verify"
