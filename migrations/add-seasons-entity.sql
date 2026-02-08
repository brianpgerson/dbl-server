-- Migration: Add seasons entity and restructure hierarchy
-- League = identity (Dong Bong League)
-- Season = per-year instance (2025, 2026, ...)
-- Run this on both local and production DBs

BEGIN;

-- ============================================================================
-- 1. Create seasons table
-- ============================================================================
CREATE TABLE seasons (
  id SERIAL PRIMARY KEY,
  league_id INTEGER NOT NULL REFERENCES leagues(id),
  season_year INTEGER NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(league_id, season_year)
);

-- ============================================================================
-- 2. Create user_leagues table (league-level roles: commissioner, manager)
-- ============================================================================
CREATE TABLE user_leagues (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  league_id INTEGER NOT NULL REFERENCES leagues(id),
  role VARCHAR(50) NOT NULL DEFAULT 'manager',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, league_id)
);

CREATE INDEX idx_user_leagues_user_id ON user_leagues(user_id);
CREATE INDEX idx_user_leagues_league_id ON user_leagues(league_id);

-- ============================================================================
-- 3. Migrate data: create season rows from existing leagues data
-- ============================================================================
INSERT INTO seasons (league_id, season_year, start_date, end_date, created_at, updated_at)
SELECT id, season_year, start_date, end_date, created_at, updated_at
FROM leagues;

-- ============================================================================
-- 4. Migrate data: populate user_leagues from user_teams roles
-- ============================================================================
INSERT INTO user_leagues (user_id, league_id, role, created_at)
SELECT DISTINCT ut.user_id,
  COALESCE(ut.league_id, t.league_id) as league_id,
  CASE WHEN ut.role = 'commissioner' THEN 'commissioner' ELSE 'manager' END as role,
  ut.created_at
FROM user_teams ut
LEFT JOIN teams t ON ut.team_id = t.id
WHERE COALESCE(ut.league_id, t.league_id) IS NOT NULL
ON CONFLICT (user_id, league_id) DO UPDATE SET role =
  CASE WHEN EXCLUDED.role = 'commissioner' THEN 'commissioner' ELSE user_leagues.role END;

-- ============================================================================
-- 5. Add season_id to tables that currently use league_id
-- ============================================================================

-- teams: add season_id, populate from league_id -> seasons mapping
ALTER TABLE teams ADD COLUMN season_id INTEGER REFERENCES seasons(id);
UPDATE teams SET season_id = s.id
FROM seasons s WHERE s.league_id = teams.league_id AND s.season_year = (
  SELECT season_year FROM leagues WHERE leagues.id = teams.league_id
);

-- roster_templates: add season_id
ALTER TABLE roster_templates ADD COLUMN season_id INTEGER REFERENCES seasons(id);
UPDATE roster_templates SET season_id = s.id
FROM seasons s WHERE s.league_id = roster_templates.league_id;

-- drafts: add season_id
ALTER TABLE drafts ADD COLUMN season_id INTEGER REFERENCES seasons(id);
UPDATE drafts SET season_id = s.id
FROM seasons s WHERE s.league_id = drafts.league_id;

-- ============================================================================
-- 6. Clean up leagues table (remove season-specific fields)
-- ============================================================================
ALTER TABLE leagues DROP COLUMN IF EXISTS season_year;
ALTER TABLE leagues DROP COLUMN IF EXISTS start_date;
ALTER TABLE leagues DROP COLUMN IF EXISTS end_date;

-- ============================================================================
-- 7. Clean up user_teams (remove role and league_id — now in user_leagues)
-- ============================================================================
ALTER TABLE user_teams DROP COLUMN IF EXISTS role;
ALTER TABLE user_teams DROP COLUMN IF EXISTS league_id;

-- ============================================================================
-- 8. Drop old league_id FKs from tables that now use season_id
-- ============================================================================
ALTER TABLE teams DROP COLUMN IF EXISTS league_id;
ALTER TABLE roster_templates DROP COLUMN IF EXISTS league_id;
ALTER TABLE drafts DROP COLUMN IF EXISTS league_id;

-- ============================================================================
-- 9. Add indexes on new season_id columns
-- ============================================================================
CREATE INDEX idx_teams_season_id ON teams(season_id);
CREATE INDEX idx_roster_templates_season_id ON roster_templates(season_id);
CREATE INDEX idx_drafts_season_id ON drafts(season_id);
CREATE INDEX idx_seasons_league_id ON seasons(league_id);

COMMIT;
