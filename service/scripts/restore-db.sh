#!/usr/bin/env bash
# Восстановление из бэкапа, созданного scripts/backup-db.sh.
#
# Использование:
#   ./scripts/restore-db.sh /var/backups/basa/basa-20260512T100000Z.sql.gz
#
# Скрипт удаляет существующую БД и создаёт её заново — будьте внимательны.

set -euo pipefail

FILE="${1:?usage: $0 <backup.sql.gz>}"
[ -f "$FILE" ] || { echo "file not found: $FILE" >&2; exit 1; }

DB_SERVICE="${DB_SERVICE:-db}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-basa}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
DB_USER="${DB_USER:-basa}"
DB_NAME="${DB_NAME:-basa}"
DB_SUPERUSER="${DB_SUPERUSER:-$DB_USER}"

echo "WARNING: this will DROP and recreate database '$DB_NAME'."
read -r -p "Type 'YES' to continue: " confirm
[ "$confirm" = "YES" ] || { echo "aborted"; exit 0; }

run_in_db() {
    docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" exec -T "$DB_SERVICE" "$@"
}

# отключаем сервис app, чтобы он не держал соединений
docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" stop app worker >/dev/null 2>&1 || true

run_in_db psql -U "$DB_SUPERUSER" -d postgres -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS $DB_NAME;" \
    -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"

echo "restoring from $FILE …"
gunzip -c "$FILE" | run_in_db psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -q

docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" start app worker >/dev/null 2>&1 || true

echo "done."
