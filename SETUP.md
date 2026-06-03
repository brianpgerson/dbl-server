# Local Development Setup

Welcome to the Dong Bong League — a fantasy baseball app where the only stat is home runs ("dongs"). This guide gets you from zero to a running local copy with real (mirrored) league data.

> **Using Claude Code?** Point it at this file and say "set me up following SETUP.md" — everything below is scripted and it can run the steps for you.

## What you're setting up

Two repos, cloned as **siblings** in the same parent folder:

```
your-folder/
├── backend/        # Node/Express API  → https://github.com/brianpgerson/dbl-server
└── dong-bong-fe/   # React frontend    → https://github.com/brianpgerson/dbl-frontend
```

| Piece | Tech | Local URL |
|---|---|---|
| Backend | Node 22, Express 5, PostgreSQL | http://localhost:3001 |
| Frontend | React 19 (Create React App) | http://localhost:3000 |

## Prerequisites

- macOS with [Homebrew](https://brew.sh) (the setup script installs PostgreSQL for you if needed)
- Node 22 — the frontend pins it via `.nvmrc`. If you use nvm: `nvm install 22 && nvm use 22`
- The **seed file**: ask Brian for `dbl_seed.dump` (a snapshot of the prod database). Place it at `backend/seed/dbl_seed.dump`.

## Setup (one command)

```bash
git clone git@github.com:brianpgerson/dbl-server.git backend
git clone git@github.com:brianpgerson/dbl-frontend.git dong-bong-fe
# put the seed file at backend/seed/dbl_seed.dump, then:
cd backend && ./scripts/setup-local.sh
```

The script: installs/starts Postgres if needed → creates the `dong_bong_league` DB → restores the seed → resets every user's password to `password` → writes `.env` files → `npm install`s both repos. It's safe to re-run (it asks before dropping the DB).

## Running

```bash
# Terminal 1 — API
cd backend && npm run dev

# Terminal 2 — UI
cd dong-bong-fe && npm start
```

Open http://localhost:3000 and log in as **any league member's email** with password **`password`** (the seed restore resets all passwords locally — prod credentials are never usable from the dump).

## Things worth knowing

- **The cron starts with the server.** `npm run dev` kicks off hourly jobs that fetch real MLB home-run data and write scores/badges into your *local* DB. Harmless, but don't be surprised when your local data drifts ahead of the seed. Re-run `setup-local.sh` any time you want a fresh mirror.
- **Frontend tests are skipped.** React 19 + CRA's jest have a known incompatibility (AggregateError). `npm run build` is the frontend health check, not `npm test`. Backend tests work: `cd backend && npm test`.
- **`.npmrc` matters.** The frontend has a project-level `.npmrc` pointing at the public npm registry — don't delete it.
- **Database layout:** `backend/current_schema.sql` is a reference snapshot of the schema. Migrations live in `backend/migrations/` and are plain SQL files applied with `psql -d dong_bong_league -f <file>` — there's no migration framework, and the seed dump already includes everything applied to prod.
- **You have no prod access, and that's by design.** `DATABASE_URL` in your `.env` points at localhost. The Heroku app and the real DB are commissioner-only. If you build something that needs a schema change, include the migration SQL in your PR and Brian applies it to prod.
- **Key backend dirs:** `routes/` (one file per API area), `badges/` (achievement evaluators), `scripts/` (cron + data jobs), `helpers/`, `middleware/auth.js` (JWT + commissioner checks).
- **Key frontend dirs:** `src/components/`, `src/badges/` (pixel-sprite badge system), `src/game/` (the Big Dongos minigame engine), `src/hooks/`.

## Contributing

Branch off `main` in either repo, open a PR on GitHub. Don't push to `main` directly — the frontend auto-deploys from it (Netlify), and the backend deploys to Heroku from `main` too.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `psql: command not found` after install | `echo 'export PATH="$(brew --prefix postgresql@17)/bin:$PATH"' >> ~/.zshrc` and restart your terminal |
| `connection refused` on :5432 | `brew services restart postgresql@17` |
| Frontend shows blank data / CORS errors | Backend not running on :3001, or `dong-bong-fe/.env.local` missing `REACT_APP_API_URL=http://localhost:3001` |
| Login fails | You're using a prod password — local is always `password` |
| `npm install` registry errors (frontend) | Make sure the project `.npmrc` exists and you're on Node 22 |
