#!/usr/bin/env bash
# One-shot local dev setup for the Dong Bong League backend (macOS).
#
# What it does:
#   1. Makes sure PostgreSQL is installed and running (installs via Homebrew if needed)
#   2. Creates the dong_bong_league database
#   3. Restores the prod seed file (seed/dbl_seed.dump — get this from the commissioner)
#   4. Resets every user's password to "password" so you can log in as anyone locally
#   5. Writes backend .env and installs npm dependencies
#   6. Optionally sets up the frontend repo if it's cloned as a sibling directory
#
# Usage: ./scripts/setup-local.sh
# Re-runnable: drops and recreates the local DB each time (it will ask first).

set -euo pipefail
cd "$(dirname "$0")/.."

DB_NAME=dong_bong_league
SEED_FILE=seed/dbl_seed.dump

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
die()  { printf '\033[31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
bold "1/6 Checking PostgreSQL..."

PSQL=""
if command -v psql >/dev/null 2>&1; then
  PSQL="$(command -v psql)"
elif [ -x /Applications/Postgres.app/Contents/Versions/latest/bin/psql ]; then
  PSQL=/Applications/Postgres.app/Contents/Versions/latest/bin/psql
fi

if [ -z "$PSQL" ]; then
  command -v brew >/dev/null 2>&1 || die "Homebrew not found. Install it first: https://brew.sh"
  echo "PostgreSQL not found — installing postgresql@17 via Homebrew (this takes a few minutes)..."
  brew install postgresql@17
  brew services start postgresql@17
  PSQL="$(brew --prefix postgresql@17)/bin/psql"
  echo ""
  echo "NOTE: add postgres to your PATH for future sessions:"
  echo "  echo 'export PATH=\"$(brew --prefix postgresql@17)/bin:\$PATH\"' >> ~/.zshrc"
  echo ""
fi

PG_BIN="$(dirname "$PSQL")"

# Wait for the server to accept connections (fresh installs need a moment)
for i in $(seq 1 15); do
  if "$PG_BIN/pg_isready" -q 2>/dev/null; then break; fi
  [ "$i" = 15 ] && die "PostgreSQL isn't accepting connections. Try: brew services restart postgresql@17"
  sleep 1
done
echo "PostgreSQL is running ($PSQL)"

# ---------------------------------------------------------------------------
bold "2/6 Creating database '$DB_NAME'..."

if "$PSQL" -lqt | cut -d'|' -f1 | grep -qw "$DB_NAME"; then
  read -r -p "Database '$DB_NAME' already exists. Drop and recreate it? [y/N] " yn
  case "$yn" in
    [Yy]*) "$PG_BIN/dropdb" "$DB_NAME" ;;
    *) die "Aborted. Re-run when you're ready to rebuild the local DB." ;;
  esac
fi
"$PG_BIN/createdb" "$DB_NAME"
echo "Created."

# ---------------------------------------------------------------------------
bold "3/6 Restoring seed data..."

[ -f "$SEED_FILE" ] || die "Seed file not found at backend/$SEED_FILE.
It ships with the repo — make sure your checkout is up to date (git pull).
(Commissioner: regenerate it with ./scripts/export-prod-db.sh)"

"$PG_BIN/pg_restore" --no-owner --no-acl -d "$DB_NAME" "$SEED_FILE" || true
# pg_restore exits non-zero on harmless ownership warnings; verify for real:
TEAMS=$("$PSQL" -d "$DB_NAME" -tAc "SELECT COUNT(*) FROM teams" 2>/dev/null) \
  || die "Restore failed — 'teams' table missing. Is the seed file a valid Heroku backup?"
echo "Restored ($TEAMS teams found)."

# ---------------------------------------------------------------------------
bold "4/6 Installing backend dependencies..."
npm install

# ---------------------------------------------------------------------------
bold "5/6 Resetting all local passwords to 'password'..."

HASH=$(node -e "require('bcrypt').hash('password',10).then(h=>console.log(h))")
"$PSQL" -d "$DB_NAME" -c "UPDATE users SET password_hash = '$HASH';" >/dev/null
echo "Done — log in locally as ANY league member with password: password"

# ---------------------------------------------------------------------------
bold "6/6 Writing .env..."

if [ -f .env ]; then
  echo ".env already exists — leaving it alone."
else
  cat > .env <<EOF
DATABASE_URL=postgres://localhost:5432/$DB_NAME
PORT=3001
JWT_SECRET=$(openssl rand -hex 32)
CORS_ORIGIN=http://localhost:3000
EOF
  echo "Wrote backend/.env"
fi

# ---------------------------------------------------------------------------
# Optional: frontend setup if cloned next door
FE_DIR=../dong-bong-fe
if [ -d "$FE_DIR" ]; then
  bold "Bonus: found frontend at $FE_DIR — setting it up..."
  if [ ! -f "$FE_DIR/.env.local" ]; then
    echo "REACT_APP_API_URL=http://localhost:3001" > "$FE_DIR/.env.local"
    echo "Wrote dong-bong-fe/.env.local"
  fi
  (cd "$FE_DIR" && npm install)
else
  echo ""
  echo "Frontend not found at $FE_DIR — clone it as a sibling and re-run, or set it up manually:"
  echo "  git clone git@github.com:brianpgerson/dbl-frontend.git $FE_DIR"
fi

# ---------------------------------------------------------------------------
echo ""
bold "All set! To run the app:"
echo "  Terminal 1:  cd backend && npm run dev          # API on http://localhost:3001"
echo "  Terminal 2:  cd dong-bong-fe && npm start       # UI on http://localhost:3000"
echo ""
echo "Log in with any league member's email + password: password"
echo "See SETUP.md for more details and gotchas."
