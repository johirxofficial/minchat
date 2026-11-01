#!/bin/sh
# Wait for PostgreSQL, apply migrations, then start the requested process.
set -eu

attempt=1
max_attempts="${MIGRATE_MAX_ATTEMPTS:-30}"

until node server/src/scripts/migrate.js; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "[minchat] migrations failed after $attempt attempts" >&2
    exit 1
  fi
  echo "[minchat] database not ready (attempt $attempt/$max_attempts), retrying in 2s..." >&2
  attempt=$((attempt + 1))
  sleep 2
done

exec "$@"
