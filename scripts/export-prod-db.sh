#!/usr/bin/env bash
# Export the prod DB to a scrubbed seed file for local development.
# COMMISSIONER ONLY — requires heroku CLI auth with access to dbl-backend,
# plus local PostgreSQL (used to scrub the dump before it leaves your machine).
#
# Usage: ./scripts/export-prod-db.sh
# Output: seed/dbl_seed.dump — safe to send to a local dev:
#   - all password hashes are scrubbed (recipient never receives prod credentials;
#     setup-local.sh sets every local password to "password" on restore)

set -euo pipefail
cd "$(dirname "$0")/.."

APP=dbl-backend
SCRUB_DB=dbl_seed_scrub
RAW=seed/.raw_prod.dump
OUT=seed/dbl_seed.dump

mkdir -p seed
trap 'rm -f "$RAW"; dropdb --if-exists "$SCRUB_DB" 2>/dev/null || true' EXIT

echo "==> Capturing a fresh backup on Heroku ($APP)..."
heroku pg:backups:capture -a "$APP"

echo "==> Downloading..."
heroku pg:backups:download -a "$APP" -o "$RAW"

echo "==> Scrubbing credentials in a temp local DB ($SCRUB_DB)..."
dropdb --if-exists "$SCRUB_DB"
createdb "$SCRUB_DB"
pg_restore --no-owner --no-acl -d "$SCRUB_DB" "$RAW" || true
USERS=$(psql -d "$SCRUB_DB" -tAc "SELECT COUNT(*) FROM users") \
  || { echo "ERROR: restore into temp DB failed (is local pg_restore >= Heroku's PG version?)"; exit 1; }
psql -d "$SCRUB_DB" -c "UPDATE users SET password_hash = 'SCRUBBED-AT-EXPORT';" >/dev/null

echo "==> Re-dumping scrubbed data to $OUT..."
pg_dump -Fc --no-owner --no-acl -d "$SCRUB_DB" -f "$OUT"

echo ""
echo "Done. Scrubbed $USERS users' password hashes."
echo "Send $OUT to your local dev (AirDrop/Drive/etc) — do NOT commit it."
echo "They should drop it at backend/seed/dbl_seed.dump and run ./scripts/setup-local.sh"
