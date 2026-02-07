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

### Deferred
- [ ] Data sync controls (manual trigger for HR fetch) — low priority, cron handles it
- [ ] Score corrections — rare edge case, can do via DB for now
- [ ] Season lifecycle (freeze rosters) — can handle via end_date

---

## Priority 5: Draft System

### Context
League drafts via text message (group chat). Commissioner manually inputs picks. Previously used a spreadsheet — this year we want it in-app.

### Schema — DONE
- [x] `drafts` table — league_id, status (setup/active/complete), draft_type (snake/straight), rounds, current_pick
- [x] `draft_picks` table — draft_id, pick_number, round, team_id, player_id, position, picked_at
- [x] `draft_order` table — draft_id, team_id, order_position
- [x] Migration file: `migrations/add-draft-tables.sql`

### Backend API — DONE
- [x] `GET /api/draft/league/:leagueId` — get draft status, order, all picks, who's on the clock
- [x] `POST /api/draft` — create a new draft (commissioner)
- [x] `POST /api/draft/:id/order` — set draft order + auto-generate pick slots (supports snake/straight)
- [x] `POST /api/draft/:id/start` — activate the draft
- [x] `POST /api/draft/:id/pick` — make a pick (auto-creates team_roster entry with reason='DRAFTED')
- [x] `POST /api/draft/:id/undo` — undo the last pick (removes roster entry too)
- [x] `GET /api/draft/:id/available` — search available (undrafted) players

### Frontend — DONE
- [x] `/draft/:leagueId` route with `DraftBoard` component
- [x] Live draft board with grid showing all picks by round
- [x] "On the clock" indicator with team name and pick number
- [x] Commissioner controls: position selector, player search, pick submission
- [x] Undo last pick button
- [x] Auto-polling every 10 seconds for live updates
- [x] Draft setup tab in Admin portal: league selection, draft order reordering, create/start draft
- [x] Link from admin to draft board

---

## Priority 6: Draft Order Minigame

### Context
Fun minigame for league members to determine draft order. Lowest priority — details TBD.

---

## Architecture Notes (Updated Post-Refactor)

### Current Stack
- **Backend:** Node.js/Express, modular routes (`server.js` is 44 lines), Heroku deployment
- **Frontend:** Create React App with React Router, custom hooks, deployed to dong-bong-league.com
- **Database:** Heroku Postgres essential-0 (1 GB limit, currently 11.6 MB, 12 tables)
- **External API:** MLB Stats API (statsapi.mlb.com) for game data and player info
- **Auth:** JWT-based, tokens stored in localStorage, 7-day expiry with client-side expiry check

### Backend Structure
```
server.js (44 lines - entry point)
├── routes/auth.js      - login
├── routes/teams.js     - team data, roster-with-hrs
├── routes/roster.js    - roster moves, swaps
├── routes/leagues.js   - league list, race data, history
├── routes/admin.js     - commissioner: season setup, user/team mgmt
├── routes/draft.js     - draft board, picks, order
├── middleware/auth.js   - JWT validation, team access checks
├── helpers/mlb.js      - team abbreviations, game data
├── helpers/league.js   - active league queries
├── cron.js             - HR fetch, MLB sync, player status
└── scripts/            - fetch-home-runs, sync-mlb-data, sync-player-status
```

### Data Flow
```
MLB Stats API  --(cron every hour)-->  player_game_stats
                                            |
team_rosters (who's on which team)  ------->|
                                            v
                                    scoring engine --> scores
                                            |
                                            v
                                    /api/race --> frontend charts
```

---

## Running Thoughts

_Notes and ideas captured during the P1-P5 build-out:_

- **CRA → Vite migration**: React 19's `act()` is incompatible with CRA's jest config. Frontend component tests are written but skipped. Migrating to Vite would fix this and improve dev/build speed. Worth doing before next season starts.
- **Real-time draft updates**: Currently the draft board polls every 10 seconds. Could upgrade to WebSocket/SSE for instant updates during the draft, but polling is probably fine for a text-based draft with 8 people.
- **Frontend nav**: The current nav uses `<a href>` tags (full page reload) instead of React Router `<Link>` components. This works but causes unnecessary reloads. Should switch to `<Link>` for SPA navigation.
- **Team colors consistency**: The TEAM_COLORS array assigns colors by index position. If teams are reordered between seasons, colors will change. Could persist color assignments per team.
- **Supabase cleanup**: Removed the dependency from the frontend, but the Supabase project still exists. Can delete the Supabase project entirely.
- **Error boundary**: Still missing a React Error Boundary. Low priority but would prevent white-screen crashes.
- **Player position flexibility**: The draft lets you assign any position to any player. The roster move logic enforces drafted_position rules. Should the draft also validate positions against primary_position?
- **Production deployment**: Need to run `migrations/add-draft-tables.sql` on the Heroku DB before the draft can be used.
- **Mobile UX**: The draft board grid is wide and requires horizontal scrolling on mobile. Could consider a card-based layout for mobile draft viewing.
