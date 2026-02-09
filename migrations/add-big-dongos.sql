-- Migration: Big Dongos minigame results
-- Stores individual swing results for the draft order minigame

CREATE TABLE big_dongos_swings (
  id SERIAL PRIMARY KEY,
  season_id INTEGER NOT NULL REFERENCES seasons(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  attempt_number INTEGER NOT NULL,
  swing_number INTEGER NOT NULL,
  is_warmup BOOLEAN DEFAULT false,
  distance_feet INTEGER NOT NULL,
  distance_inches INTEGER NOT NULL,
  exit_velocity DECIMAL(5,1),
  launch_angle DECIMAL(5,1),
  contact_quality DECIMAL(4,3),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_big_dongos_season ON big_dongos_swings(season_id);
CREATE INDEX idx_big_dongos_user ON big_dongos_swings(season_id, user_id);
