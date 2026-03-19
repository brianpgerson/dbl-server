-- Migration: Big Dongos unique constraint
-- Prevents duplicate swing rows from concurrent requests (TOCTOU race in app-layer check)

ALTER TABLE big_dongos_swings
  ADD CONSTRAINT big_dongos_unique_swing
  UNIQUE (season_id, user_id, attempt_number, swing_number);
