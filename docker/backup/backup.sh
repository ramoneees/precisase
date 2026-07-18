#!/bin/sh
# Scheduled pg_dump + simple retention pruning.
# ARCHITECTURE.md §8.3: rolling 30 days daily + 12 months monthly (defaults,
# pending church-IT confirmation — Open question Q10).
set -eu

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:=5432}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${BACKUP_DIR:=/backups}"
: "${BACKUP_KEEP_DAILY:=30}"
: "${BACKUP_KEEP_MONTHLY:=12}"

export PGPASSWORD

timestamp="$(date +%Y-%m-%dT%H-%M-%S)"
day_of_month="$(date +%d)"
daily_dir="${BACKUP_DIR}/daily"
monthly_dir="${BACKUP_DIR}/monthly"
mkdir -p "$daily_dir" "$monthly_dir"

dump_file="${daily_dir}/${PGDATABASE}_${timestamp}.sql.gz"
echo "[backup] $(date -Iseconds) starting pg_dump of '${PGDATABASE}' -> ${dump_file}"
pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" --format=plain \
  | gzip > "$dump_file"
echo "[backup] $(date -Iseconds) dump complete ($(du -h "$dump_file" | cut -f1))"

# On the 1st of the month, keep a copy in the monthly archive too.
if [ "$day_of_month" = "01" ]; then
  cp "$dump_file" "${monthly_dir}/${PGDATABASE}_${timestamp}.sql.gz"
  echo "[backup] $(date -Iseconds) copied to monthly archive"
fi

# Retention pruning.
find "$daily_dir" -name "*.sql.gz" -mtime "+${BACKUP_KEEP_DAILY}" -delete
find "$monthly_dir" -name "*.sql.gz" -mtime "+$((BACKUP_KEEP_MONTHLY * 31))" -delete

echo "[backup] $(date -Iseconds) retention pruning done (keep ${BACKUP_KEEP_DAILY}d daily / ${BACKUP_KEEP_MONTHLY}mo monthly)"
