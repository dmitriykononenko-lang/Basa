#!/usr/bin/env bash
# ============================================================================
# run.sh — поднимает одноразовый локальный Postgres 16, создаёт две БД
#   t_pre  = схема как в production ДО ремедиации
#   t_post = та же схема + миграции 0086–0090
# и прогоняет regression.sh в обоих режимах. Production не используется.
# Запуск из finance-app:  bash scripts/concurrency/run.sh
# ============================================================================
set -u
BASE=${BASE:-/var/tmp/pgaudit}
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
HERE="$(cd "$(dirname "$0")" && pwd)"
MIGRATIONS="$HERE/../../supabase/migrations"
STEPS="0086_guard_constraints 0087_accrual_idempotency 0088_financial_rpcs 0089_optimistic_concurrency 0090_bank_event_identity 0091_write_paths_and_authz 0092_transaction_lines"

start_pg() {
  if psql -h "$BASE" -p 5433 -U audit -d postgres -qc "select 1" >/dev/null 2>&1; then return; fi
  rm -rf "$BASE"; mkdir -p "$BASE"; chown postgres:postgres "$BASE" 2>/dev/null || true
  su postgres -c "$PGBIN/initdb -D $BASE/data -U audit --auth=trust" >"$BASE/initdb.log" 2>&1
  su postgres -c "$PGBIN/pg_ctl -D $BASE/data -o '-k $BASE -p 5433 -c listen_addresses=' -l $BASE/pg.log start" >/dev/null
  for i in $(seq 1 20); do psql -h "$BASE" -p 5433 -U audit -d postgres -qc "select 1" >/dev/null 2>&1 && break; sleep 0.3; done
}

start_pg
psql -h "$BASE" -p 5433 -U audit -d postgres -qc "drop database if exists t_pre;"  >/dev/null
psql -h "$BASE" -p 5433 -U audit -d postgres -qc "drop database if exists t_post;" >/dev/null
psql -h "$BASE" -p 5433 -U audit -d postgres -qc "drop database if exists t_base;" >/dev/null
psql -h "$BASE" -p 5433 -U audit -d postgres -qc "create database t_base;" >/dev/null
psql -h "$BASE" -p 5433 -U audit -d t_base -q -v ON_ERROR_STOP=1 -f "$HERE/schema_base.sql" 2>&1 | grep -v NOTICE
psql -h "$BASE" -p 5433 -U audit -d postgres -qc "create database t_pre  template t_base;" >/dev/null
psql -h "$BASE" -p 5433 -U audit -d postgres -qc "create database t_post template t_base;" >/dev/null

echo "=== применяю миграции к t_post ==="
for m in $STEPS; do
  out=$(psql -h "$BASE" -p 5433 -U audit -d t_post -q -v ON_ERROR_STOP=1 -f "$MIGRATIONS/$m.sql" 2>&1 | grep -v "does not exist, skipping")
  if [ -n "$out" ]; then echo "  $m: $out"; else echo "  $m: ok"; fi
done

BASE="$BASE" MODE=pre  bash "$HERE/regression.sh"; pre=$?
BASE="$BASE" MODE=post bash "$HERE/regression.sh"; post=$?
echo
echo "ИТОГ: pre — проблемы воспроизводятся (ожидаемо), post — $([ $post = 0 ] && echo 'все тесты PASS' || echo 'ЕСТЬ ПАДЕНИЯ')"
exit $post
