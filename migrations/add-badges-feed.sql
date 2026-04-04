-- Migration: Achievement badges + activity feed
-- badge_awards: permanent per-team achievement records
-- feed_events: chronological activity stream (HRs, roster swaps, badge pops, title changes)

CREATE TABLE badge_awards (
  id SERIAL PRIMARY KEY,
  season_id INTEGER NOT NULL REFERENCES seasons(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  badge_key VARCHAR(40) NOT NULL,
  awarded_date DATE NOT NULL,
  context JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (season_id, team_id, badge_key, awarded_date)
);

CREATE INDEX idx_badge_awards_team ON badge_awards(season_id, team_id);
CREATE INDEX idx_badge_awards_key ON badge_awards(season_id, badge_key);

CREATE TABLE feed_events (
  id SERIAL PRIMARY KEY,
  season_id INTEGER NOT NULL REFERENCES seasons(id),
  team_id INTEGER REFERENCES teams(id),
  event_type VARCHAR(30) NOT NULL,
  event_date DATE NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_feed_season_date ON feed_events(season_id, event_date DESC, id DESC);
CREATE INDEX idx_feed_team ON feed_events(season_id, team_id);
