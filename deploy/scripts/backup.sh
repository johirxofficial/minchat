#!/usr/bin/env bash
#
# MinChat backup: PostgreSQL dump + private media archive.
#
# Usage:
#   BACKUP_DIR=/var/backups/minchat deploy/scripts/backup.sh
#
# Environment:
#   ENV_FILE    default /etc/minchat/minchat.env
#   BACKUP_DIR  default ./backups
#   RETENTION_DAYS default 14 (0 disables pruning)
#
set -euo pipefail

ENV_FILE="${ENV_FILE:-/etc/minchat/minchat.env}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

if [[ ! -r "$ENV_FILE" ]]; then
  echo "error: cannot read $ENV_FILE" >&2
  exit 1
fi

# Load only the variables the backup needs.
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${DATABASE_URL:?DATABASE_URL must be set in $ENV_FILE}"
STORAGE_DIR="${STORAGE_DIR:-/srv/minchat/storage}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DB_FILE="$BACKUP_DIR/minchat-db-$STAMP.dump"
MEDIA_FILE="$BACKUP_DIR/minchat-media-$STAMP.tar.gz"

echo "==> dumping database to $DB_FILE"
pg_dump --format=custom --no-owner --no-acl --file "$DB_FILE" "$DATABASE_URL"
chmod 600 "$DB_FILE"

if [[ -d "$STORAGE_DIR" ]]; then
  echo "==> archiving media from $STORAGE_DIR"
  tar -czf "$MEDIA_FILE" -C "$(dirname "$STORAGE_DIR")" "$(basename "$STORAGE_DIR")"
  chmod 600 "$MEDIA_FILE"
else
  echo "warn: storage directory $STORAGE_DIR not found, skipping media archive" >&2
fi

# Verify the dump is readable before considering the backup successful.
pg_restore --list "$DB_FILE" >/dev/null

echo "==> backup complete"
ls -lh "$DB_FILE" ${MEDIA_FILE:+"$MEDIA_FILE"}

if [[ "$RETENTION_DAYS" -gt 0 ]]; then
  echo "==> pruning backups older than $RETENTION_DAYS days"
  find "$BACKUP_DIR" -maxdepth 1 -type f \
    \( -name 'minchat-db-*.dump' -o -name 'minchat-media-*.tar.gz' \) \
    -mtime "+$RETENTION_DAYS" -print -delete
fi
