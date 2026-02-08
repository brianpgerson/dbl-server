# Dong Bong League — 2026 Season Revamp

## Overview
Preparing the Home Run Race fantasy baseball app for its second season (2026). The app was built live during the 2025 season and needs cleanup, multi-season support, admin tooling, and a draft system.

**Production DB:** Heroku Postgres (essential-0) on `dbl-backend` app
**Current data:** 1 league, 8 teams, 1,710 players, ~5,260 game stats, ~1,871 scored HRs
**Roster format:** 9 starters (C, 1B, 2B, 3B, SS, LF, RF, CF, DH) + 2 bench

---

## Priority 1: Bug Fixes & Security (Pre-Season Must-Do)

### Security (Critical)
- [x] Set a real `JWT_SECRET` env var on Heroku (was falling back to `'your-secret-key'`)
- [x] Add `authenticateToken` middleware to `/api/roster/move` (was wide open)
- [x] Restrict CORS origins (was `app.use(cors())` with no whitelist) — set to `dong-bong-league.com`
- [x] Remove `.env.development` from git / add to `.gitignore`
- [x] Remove hardcoded JWT secret fallback from code

### Backend Bugs
- [x] Fix roster move query — added `AND end_date IS NULL` to prevent acting on historical rows
- [x] Fix MLB team abbreviation mapping — was completely wrong for ~10 teams, rebuilt from API ground truth
- [x] Hardcoded `season_year = 2025` and `'2025-03-27'` — now queries league table dynamically
- [x] Cron job now only fetches last 3 days for hourly runs (full sync on startup only)
- [x] Cron job now checks if we're within the season window before fetching
- [x] Fixed date formatting bug — pg DATE columns were passed as JS Date objects to MLB API
- [x] `/api/teams` now defaults to most recent league (was returning all teams across leagues)
- [x] `/api/race` now returns `season_year` alongside data
- [x] `sync-mlb-data.js` — removed hardcoded `season=2025`, now uses `currentYear`
- [x] `sync-mlb-data.js` — fixed duplicate Pool creation, now uses shared `getDbPool()`
- [ ] ~~Fix login query~~ — investigated, `ut.league_id` works fine (data is populated)

### Frontend Bugs
- [x] Race data fetch error = infinite loading — added error handling with retry button
- [x] JWT expiration handling — added token expiry check on load + axios interceptor for 401/403
- [x] Season year now comes from API data instead of `new Date().getFullYear()`
- [x] Removed pointless ternary (`'bottom' : 'bottom'`)
- [x] Added `prefers-reduced-motion` support for CRT/scanline/star animations
- [x] Removed fake "8%" loading indicator
- [x] Fixed duplicate `position: relative` in App-header CSS
- [ ] `window.innerWidth` not reactive — charts freeze on resize (deferring to P2 refactor)
- [ ] Chart data not memoized (deferring to P2 refactor)
- [ ] Player swap retry after login (deferring to P2 refactor)

### Cleanup
- [x] Remove unused Supabase dependency (`@supabase/supabase-js`) from frontend
- [x] Remove unused CSS classes (`.swap-players-button`, `.swap-arrow`, `.validation-message`)
- [x] Remove unused `canEdit` prop from `TeamRoster`
- [x] Remove default CRA `logo.svg`
- [x] Update stale `current_schema.sql` to match production
- [x] Cleaned up backend `.env` (removed stale Supabase keys, added JWT_SECRET + CORS_ORIGIN)
- [x] Set `CORS_ORIGIN` and `JWT_SECRET` on Heroku production

---

## Priority 2: Code Refactor & Test Coverage

Cleaning up the codebase before building new features. Everything after this gets built on a solid foundation.

### Backend Refactor
- [x] **Break up `server.js`** (713→42 lines) — extracted into route modules:
  - `routes/auth.js` — login endpoint
  - `routes/leagues.js` — league list, race/standings data
  - `routes/teams.js` — team data, roster-with-hrs endpoint
  - `routes/roster.js` — roster moves, player swaps
  - `middleware/auth.js` — JWT auth + team access middleware
  - `helpers/mlb.js` — team abbreviations, game data fetching
  - `helpers/league.js` — active league queries, date formatting
  - `cron.js` — all cron job scheduling
- [x] **Extract shared helpers** — mlb.js, league.js
- [x] **Extract cron jobs** into `cron.js` module

### Frontend Refactor
- [x] **Add React Router** — `react-router-dom` v7 with URL routing
  - `/` — charts/standings
  - `/team/:teamId` — team roster view
- [x] **Break up `App.js`** — extracted chart logic into custom hooks
  - `hooks/useChartData.js` — `useLineChartData` + `useBarChartData` with `useMemo`
  - `hooks/useWindowWidth.js` — reactive `useIsMobile` hook (fixes frozen charts on resize)
  - Team colors extracted to shared `TEAM_COLORS` constant
- [x] **Move CSS files** to `src/components/` alongside their components
- [x] **Add `prefers-reduced-motion`** support (done in P1)
- [ ] **Add Error Boundary** — deferred to P3/P4

### Tests
- [x] **Backend:** Jest installed, 10 tests passing:
  - MLB team abbreviation mapping (30 teams, no duplicates, known IDs)
  - Date formatting helper
  - Auth middleware (no token, invalid token, valid token, expired token)
- [ ] **Frontend:** React 19 + CRA jest has known AggregateError incompatibility
  - Tests are written but skipped pending CRA→Vite migration
  - Build passes, app runs correctly

---

## Priority 3: Multi-Season Support & League History

### Goal
Preserve 2025 data as viewable history while starting a clean 2026 season.

### Schema Observations
The existing schema is *almost* ready for multi-season:
- **`leagues` table** already has `season_year`, `start_date`, `end_date` — one row per season works
- **`teams`** have `league_id` FK — creating new teams under a 2026 league row naturally separates them
- **`team_rosters`** are tied to teams (which are tied to leagues) — history is scoped
- **`scores`** are tied to `team_id` — scoped through teams -> league join
- **`player_game_stats`** has no team/league scoping, but it's raw MLB data (shared across leagues). Date-range filtering against the league's `start_date`/`end_date` is sufficient
- **`players`** are a global pool — no changes needed
- **`roster_templates`** already have `league_id` FK
- **`user_teams`** has both `team_id` and `league_id` — can map users to new teams each season

### Approach: New League Row Per Season
Rather than adding `season_year` columns to `scores`/`player_game_stats`, we create a new `leagues` row for 2026 with new `teams` rows. The 2025 data stays intact and queryable.

**For 2026 season startup:**
1. Create new league row: `INSERT INTO leagues (name, season_year, start_date, end_date) VALUES ('Dong Bong League', 2026, '2026-03-26', '2026-09-28')`
2. Create new team rows under the 2026 league (same team names, same managers, new IDs)
3. Copy `roster_templates` for the new league
4. Map users to new teams via `user_teams`
5. Draft picks create `team_rosters` rows under the new teams

**For league history:**
- API endpoint: `GET /api/leagues` — list all seasons
- API endpoint: `GET /api/leagues/:id/standings` — final standings for a past season
- API endpoint: `GET /api/leagues/:id/rosters` — final rosters for a past season
- Frontend: season selector + history page showing past champions, final standings, rosters

### Backend Changes — DONE (completed in P1 + P3)
- [x] All API endpoints use dynamic `league_id` (done in P1)
- [x] `/api/race` uses league's `start_date`/`end_date` (done in P1)
- [x] `/api/teams` filters by league (done in P1)
- [x] Cron job uses active league's date range (done in P1)
- [x] `GET /api/leagues` — list all seasons
- [x] `GET /api/leagues/:id/standings` — standings for a specific season
- [x] `GET /api/leagues/:id/rosters` — end-of-season rosters grouped by team
- [x] `GET /api/leagues/:id/race` — race data for a specific season

### Frontend Changes — DONE
- [x] Added `/history` route with `LeagueHistory` component
- [x] Season selector buttons on history page
- [x] Final standings table with champion highlight
- [x] Navigation links in header (Current Season / History)

---

## Priority 4: Commissioner Admin Portal

### What Exists Today
- Commissioner role in JWT with league scoping
- Player swap on any team in commissioner's league
- Effective date override for commissioners

### Backend Endpoints — DONE
- [x] `POST /api/admin/new-season` — one-stop season setup: creates league, clones teams/templates/user assignments
- [x] `POST /api/admin/leagues` — create a new league
- [x] `POST /api/admin/teams` — create a team
- [x] `PUT /api/admin/teams/:id` — update team name/manager
- [x] `POST /api/admin/leagues/:id/clone-teams` — clone teams from another league
- [x] `GET /api/admin/users` — list all users with their team assignments
- [x] `POST /api/admin/users` — create a user account
- [x] `POST /api/admin/user-teams` — assign a user to a team with a role
- [x] `GET /api/admin/teams/:id/roster-history` — full roster move audit trail
- [x] `GET /api/admin/players/search` — search players by name (with optional position filter)
- [x] All admin routes protected by `authenticateToken` + `requireCommissioner` middleware

### Frontend — DONE
- [x] `/admin` route with `AdminPortal` component
- [x] Tab-based UI: New Season, Users, Teams
- [x] New Season form: create season, copy from previous, auto-clone teams+users
- [x] User list and create user form
- [x] Create team form
- [x] Commissioner-only nav link (hidden for regular users)
- [x] Success/error message feedback

---

## Day 2 Work (2026-02-08)

### Entity Restructure
- [x] Added `seasons` table — separates league identity from per-year seasons
- [x] Added `user_leagues` table — league-level roles (commissioner/manager)
- [x] Added `platform_seasons` table — platform-wide season config (open_date, start_date, end_date)
- [x] Teams, roster_templates, drafts now reference `season_id` instead of `league_id`
- [x] `user_teams` simplified to just user_id + team_id (role moved to user_leagues)
- [x] Migration: `migrations/add-seasons-entity.sql`, `migrations/add-platform-seasons.sql`

### App State Machine
- [x] `GET /api/status` — returns current state (offseason/preseason/drafting/season)
- [x] Main page renders different views per state:
  - **Offseason**: "Last Season (YYYY)" with final charts/results
  - **Preseason**: "YYYY Season Starting Soon!" banner
  - **Drafting**: "The Draft Is Live!" with link to draft board
  - **Season**: HR race charts (normal view)
- [x] `PageShell` component — shared layout with state-aware nav

### Commissioner Admin Portal Redesign
- [x] **Offseason mode**: One-click "Start YYYY Season" (auto-populates from platform_seasons)
- [x] **Preseason mode**: Settings tab (league name, season dates, roster templates, users) + Start Draft tab
- [x] **Draft mode**: Go to Draft Board + Cancel Draft buttons
- [x] **Season mode**: Sync HR Data + View Draft Results

### Draft System Improvements
- [x] Two-step pick flow: select player → confirm (no accidental picks)
- [x] Auto-position from MLB primary position (with fallback: natural pos → DH → BEN)
- [x] Position buttons show filled/available based on roster template counts
- [x] Filled positions tracked as dict `{ pos: count }` vs template slots
- [x] Edit existing picks: change position AND/OR player
- [x] `DELETE /api/draft/:id` — cancel/reset draft entirely
- [x] Position filter dropdown in player search
- [x] Active roster only toggle (default on)
- [x] Snake draft board grid fixed — picks mapped to correct team columns
- [x] "Back to Home" button on draft completion
- [x] Public roster template endpoint (no auth needed for draft board)

### Player Data Fixes
- [x] Fixed pitcher filtering — MLB API uses numeric code `'1'`, not letter `'P'`
- [x] Fixed `sync-player-status.js` — now skips pitchers, respects `Inactive` status
- [x] Players marked `Inactive` when not on any 40-man roster
- [x] Draft search defaults to active players with toggle to include inactive
- [x] Position codes display as human-readable labels (2→C, 7→LF, etc.)

---

## Remaining Work / TODOs

### Pre-Deploy (Must Do)
- [ ] Run all migrations on Heroku production DB (`add-draft-tables.sql`, `add-seasons-entity.sql`, `add-platform-seasons.sql`)
- [ ] Push both repos to production
- [ ] Set up production `platform_seasons` row for 2026
- [ ] Create production users and team assignments for 2026 season
- [ ] Test full flow end-to-end on production

### Nice to Have
- [ ] CRA → Vite migration (fixes frontend tests, improves build speed)
- [ ] Switch `<a href>` to React Router `<Link>` (prevents full page reloads)
- [ ] Error Boundary component
- [ ] Manager email invites (SendGrid/SES integration)
- [ ] Mobile-optimized draft board (card layout vs grid)
- [ ] Real-time draft updates (WebSocket/SSE vs polling)
- [ ] Team color persistence across seasons

### Draft Order Minigame (P6)
- [ ] Design the minigame concept
- [ ] Build it!

---

## Architecture (Current)

### Entity Hierarchy
```
Platform
├── platform_seasons (year, open_date, start_date, end_date)
│
└── League (Dong Bong League)
    ├── user_leagues (commissioner/manager roles)
    │
    └── Season (2025, 2026, ...)
        ├── teams → team_rosters, scores
        ├── roster_templates
        ├── drafts → draft_order, draft_picks
        └── user_teams (team assignments per season)
```

### Backend Structure
```
server.js (entry point)
├── routes/auth.js      - login
├── routes/teams.js     - team data, roster-with-hrs
├── routes/roster.js    - roster moves, swaps
├── routes/leagues.js   - leagues, seasons, race data, history, roster templates
├── routes/admin.js     - commissioner: season/team/user management
├── routes/draft.js     - draft board, picks, order, cancel, edit
├── routes/status.js    - app state machine
├── middleware/auth.js   - JWT validation, team access checks
├── helpers/mlb.js      - team abbreviations, game data
├── helpers/league.js   - active season queries
├── cron.js             - HR fetch, MLB sync, player status
└── scripts/            - fetch-home-runs, sync-mlb-data, sync-player-status
```

### App State Machine
```
Offseason ──(create season)──> Preseason ──(start draft)──> Drafting ──(complete)──> Season
    ^                                                                                  │
    └──────────────────────────────(season end_date passes)─────────────────────────────┘
```
