-- Draft system tables
-- Run this migration to add draft support

-- Main draft configuration
CREATE TABLE drafts (
  id SERIAL PRIMARY KEY,
  league_id INTEGER NOT NULL REFERENCES leagues(id),
  status VARCHAR(20) NOT NULL DEFAULT 'setup', -- setup, active, complete
  draft_type VARCHAR(20) NOT NULL DEFAULT 'snake', -- snake, straight
  rounds INTEGER NOT NULL DEFAULT 11, -- 9 starters + 2 bench
  current_pick INTEGER DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Draft order: which team picks in which position
CREATE TABLE draft_order (
  id SERIAL PRIMARY KEY,
  draft_id INTEGER NOT NULL REFERENCES drafts(id),
  team_id INTEGER NOT NULL REFERENCES teams(id),
  order_position INTEGER NOT NULL, -- 1-based position in draft order
  UNIQUE(draft_id, team_id),
  UNIQUE(draft_id, order_position)
);

-- Individual draft picks
CREATE TABLE draft_picks (
  id SERIAL PRIMARY KEY,
  draft_id INTEGER NOT NULL REFERENCES drafts(id),
  pick_number INTEGER NOT NULL, -- overall pick number (1, 2, 3, ...)
  round INTEGER NOT NULL,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  player_id INTEGER REFERENCES players(id), -- NULL until pick is made
  position VARCHAR(10), -- roster position assigned (C, 1B, etc.)
  picked_at TIMESTAMP WITH TIME ZONE, -- NULL until pick is made
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(draft_id, pick_number)
);

CREATE INDEX idx_draft_picks_draft_id ON draft_picks(draft_id);
CREATE INDEX idx_draft_order_draft_id ON draft_order(draft_id);
