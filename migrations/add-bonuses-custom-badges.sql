-- Migration: commissioner bonus HRs + custom badges
-- A bonus grants N HRs to a team (counts toward standings/milestones) and may be
-- paired with a custom_badge (commissioner-named, base64 image). The same custom
-- badge can be awarded to multiple teams via custom_badge_awards.

CREATE TABLE custom_badges (
  id SERIAL PRIMARY KEY,
  season_id INT NOT NULL REFERENCES seasons(id),
  name VARCHAR(80) NOT NULL,
  description TEXT,
  image_data TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE bonuses (
  id SERIAL PRIMARY KEY,
  season_id INT NOT NULL REFERENCES seasons(id),
  team_id INT NOT NULL REFERENCES teams(id),
  hrs INT NOT NULL CHECK (hrs > 0),
  reason VARCHAR(200),
  custom_badge_id INT REFERENCES custom_badges(id) ON DELETE SET NULL,
  awarded_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE custom_badge_awards (
  id SERIAL PRIMARY KEY,
  custom_badge_id INT NOT NULL REFERENCES custom_badges(id) ON DELETE CASCADE,
  team_id INT NOT NULL REFERENCES teams(id),
  awarded_date DATE NOT NULL DEFAULT CURRENT_DATE,
  bonus_id INT REFERENCES bonuses(id) ON DELETE CASCADE,
  UNIQUE(custom_badge_id, team_id)
);

CREATE INDEX ON bonuses(season_id, team_id);
CREATE INDEX ON custom_badge_awards(team_id);
