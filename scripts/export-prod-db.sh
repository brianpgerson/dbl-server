#!/usr/bin/env bash
# Export the prod DB to a fully scrubbed seed file for local development.
# COMMISSIONER ONLY — requires heroku CLI auth with access to dbl-backend,
# plus local PostgreSQL >= the prod PG major version (currently 16).
# If the scrub step fails with a version error: brew install postgresql@17
#
# Usage: ./scripts/export-prod-db.sh
# Output: seed/dbl_seed.dump — committed to the repo, so it must contain no
# real credentials or contact info:
#   - password hashes replaced with a placeholder (setup-local.sh resets every
#     local password to "password" on restore)
#   - emails replaced with <managername>@dbl.local (e.g. gerson@dbl.local);
#     everything else in the dump is already visible on the public site
#
# Refresh flow: re-run this script, review the printed login table, then
# commit the updated seed/dbl_seed.dump.

set -euo pipefail
cd "$(dirname "$0")/.."

APP=dbl-backend
SCRUB_DB=dbl_seed_scrub
RAW=seed/.raw_prod.dump
OUT=seed/dbl_seed.dump

# Prefer a modern brew postgres if present (keg-only, not on PATH by default)
PG_BIN=""
for v in 17 16; do
  p="$(brew --prefix postgresql@$v 2>/dev/null)/bin"
  [ -x "$p/pg_restore" ] && PG_BIN="$p" && break
done
[ -z "$PG_BIN" ] && PG_BIN="$(dirname "$(command -v pg_restore)")"
echo "Using PostgreSQL client tools in: $PG_BIN"

mkdir -p seed
trap 'rm -f "$RAW"; "$PG_BIN/dropdb" --if-exists "$SCRUB_DB" 2>/dev/null || true' EXIT

echo "==> Capturing a fresh backup on Heroku ($APP)..."
heroku pg:backups:capture -a "$APP"

echo "==> Downloading..."
heroku pg:backups:download -a "$APP" -o "$RAW"

echo "==> Scrubbing credentials + emails in a temp local DB ($SCRUB_DB)..."
"$PG_BIN/dropdb" --if-exists "$SCRUB_DB"
"$PG_BIN/createdb" "$SCRUB_DB"
"$PG_BIN/pg_restore" --no-owner --no-acl -d "$SCRUB_DB" "$RAW" || true
USERS=$("$PG_BIN/psql" -d "$SCRUB_DB" -tAc "SELECT COUNT(*) FROM users") \
  || { echo "ERROR: restore into temp DB failed (is local pg_restore >= Heroku's PG version?)"; exit 1; }

"$PG_BIN/psql" -d "$SCRUB_DB" -q <<'SQL'
UPDATE users SET password_hash = 'SCRUBBED-AT-EXPORT';

-- Guessable local emails: <managername>@dbl.local from the user's most recent
-- team (e.g. gerson@dbl.local). Falls back to user<id>, and disambiguates any
-- duplicate manager names with an id suffix so emails stay unique.
WITH candidates AS (
  SELECT u.id,
    COALESCE(
      (SELECT lower(regexp_replace(t.manager_name, '[^A-Za-z0-9]', '', 'g'))
       FROM user_teams ut JOIN teams t ON ut.team_id = t.id
       WHERE ut.user_id = u.id ORDER BY t.season_id DESC LIMIT 1),
      'user' || u.id
    ) AS base
  FROM users u
), uniq AS (
  SELECT id,
    CASE WHEN COUNT(*) OVER (PARTITION BY base) > 1
         THEN base || id ELSE base END || '@dbl.local' AS new_email
  FROM candidates
)
UPDATE users u SET email = uniq.new_email FROM uniq WHERE u.id = uniq.id;
SQL

echo "==> Re-dumping scrubbed data to $OUT..."
"$PG_BIN/pg_dump" -Fc --no-owner --no-acl -d "$SCRUB_DB" -f "$OUT"

echo ""
echo "Done. Scrubbed $USERS users. Local logins (password is always 'password'):"
"$PG_BIN/psql" -d "$SCRUB_DB" -c \
  "SELECT u.email, COALESCE(t.manager_name, '(no team)') AS manager
   FROM users u
   LEFT JOIN LATERAL (
     SELECT t.manager_name FROM user_teams ut JOIN teams t ON ut.team_id = t.id
     WHERE ut.user_id = u.id ORDER BY t.season_id DESC LIMIT 1
   ) t ON true
   ORDER BY u.email;"

echo "Sanity-check the table above, then commit the updated $OUT."
