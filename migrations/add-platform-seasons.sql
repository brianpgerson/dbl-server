BEGIN;

CREATE TABLE platform_seasons (
  id SERIAL PRIMARY KEY,
  year INTEGER NOT NULL UNIQUE,
  open_date DATE NOT NULL,      -- when commissioners can start creating league seasons
  start_date DATE NOT NULL,     -- default scoring start (MLB opening day)
  end_date DATE NOT NULL,       -- default scoring end (MLB season end)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed 2026
INSERT INTO platform_seasons (year, open_date, start_date, end_date)
VALUES (2026, '2026-02-01', '2026-03-26', '2026-09-28');

-- 2025 retroactively
INSERT INTO platform_seasons (year, open_date, start_date, end_date)
VALUES (2025, '2025-03-01', '2025-03-27', '2025-09-30');

COMMIT;
