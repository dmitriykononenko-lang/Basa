#!/usr/bin/env bash
# Ежедневный бэкап PostgreSQL (ТЗ §2.2). Хранение 14 дней.
#
# Запускать на хосте, не внутри контейнера:
#   BACKUP_DIR=/var/backups/basa ./scripts/backup-db.sh
#
# Или из cron (см. scripts/cron-backup.example).

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/basa}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
DB_SERVICE="${DB_SERVICE:-db}"         # имя сервиса в docker-compose
COMPOSE_PROJECT="${COMPOSE_PROJECT:-basa}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
DB_USER="${DB_USER:-basa}"
DB_NAME="${DB_NAME:-basa}"

mkdir -p "$BACKUP_DIR"
STAMP=$(date -u +"%Y%m%dT%H%M%SZ")
OUT="$BACKUP_DIR/basa-${STAMP}.sql.gz"

echo "[$(date -u +%FT%TZ)] backup → $OUT"

# pg_dump из контейнера сервиса db; на случай если контейнер не запущен — пробуем локальный pg_dump
if docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" ps "$DB_SERVICE" --status running -q | grep -q .; then
    docker compose -f "$COMPOSE_FILE" -p "$COMPOSE_PROJECT" exec -T "$DB_SERVICE" \
        pg_dump -U "$DB_USER" -d "$DB_NAME" --format=plain --no-owner --no-privileges \
        | gzip -9 > "$OUT"
elif command -v pg_dump >/dev/null 2>&1; then
    pg_dump -U "$DB_USER" -d "$DB_NAME" --format=plain --no-owner --no-privileges \
        | gzip -9 > "$OUT"
else
    echo "ERROR: neither docker compose db service is running, nor pg_dump is on PATH" >&2
    exit 1
fi

# Минимальная проверка — файл не пустой
if [ ! -s "$OUT" ]; then
    echo "ERROR: backup file is empty, removing" >&2
    rm -f "$OUT"
    exit 1
fi

SIZE=$(du -h "$OUT" | cut -f1)
echo "  size=$SIZE"

# Чистим старые
DELETED=$(find "$BACKUP_DIR" -name 'basa-*.sql.gz' -type f -mtime "+$RETENTION_DAYS" -print -delete | wc -l)
echo "  removed $DELETED files older than ${RETENTION_DAYS}d"

echo "[$(date -u +%FT%TZ)] done"
