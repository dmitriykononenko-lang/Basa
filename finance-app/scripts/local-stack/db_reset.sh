#!/usr/bin/env bash
# Пересоздаёт локальную БД basa_local: заглушка Supabase + все миграции по порядку.
# Production не используется. PGPORT по умолчанию 54329.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
MIG="$HERE/../../supabase/migrations"
PORT=${PGPORT:-54329}
DB=${DB:-basa_local}
P=(psql -h 127.0.0.1 -p "$PORT" -U postgres)
"${P[@]}" -qc "drop database if exists $DB" -qc "create database $DB" || exit 1
"${P[@]}" -d "$DB" -q -v ON_ERROR_STOP=1 -f "$HERE/supabase_stub.sql" || exit 1
fail=0
for f in $(ls "$MIG"/*.sql | sort); do
  out=$("${P[@]}" -d "$DB" -q -v ON_ERROR_STOP=1 -f "$f" 2>&1 | grep -E "ERROR|ОШИБКА")
  if [ -n "$out" ]; then echo "$(basename "$f"): $out"; fail=$((fail+1)); fi
done
echo "migrations with errors: $fail"
