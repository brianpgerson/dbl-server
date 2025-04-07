-- Database schema for Home Run Race Fantasy Baseball

CREATE TABLE leagues (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  season_year INTEGER NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE roster_templates (
  id SERIAL PRIMARY KEY,
  league_id INTEGER REFERENCES leagues(id),
  position VARCHAR(10) NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE teams (
  id SERIAL PRIMARY KEY,
  league_id INTEGER REFERENCES leagues(id),
  name VARCHAR(100) NOT NULL,
  manager_name VARCHAR(100) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE players (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  mlb_id INTEGER NOT NULL UNIQUE,
  primary_position VARCHAR(10) NOT NULL,
  current_mlb_team_id INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE team_rosters (
  id SERIAL PRIMARY KEY,
  team_id INTEGER REFERENCES teams(id),
  player_id INTEGER REFERENCES players(id),
  position VARCHAR(10) NOT NULL,
  drafted_position VARCHAR(10),
  status VARCHAR(20) NOT NULL DEFAULT 'STARTER',
  reason VARCHAR(50),
  effective_date DATE NOT NULL,
  end_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE player_game_stats (
  player_id INTEGER REFERENCES players(id),
  game_id INTEGER NOT NULL,
  date DATE NOT NULL,
  home_runs INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, game_id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE scores (
  id SERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL,
  team_id INTEGER REFERENCES teams(id),
  position VARCHAR(10) NOT NULL,
  date DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_team_rosters_effective_date ON team_rosters(effective_date);
CREATE INDEX idx_player_game_stats_date ON player_game_stats(date);
CREATE INDEX idx_scores_date ON scores(date);