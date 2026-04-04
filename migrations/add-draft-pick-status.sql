-- Migration: capture player status at the moment of drafting
-- Enables the santander_special badge ("drafted on IL, came back, delivered")

ALTER TABLE draft_picks ADD COLUMN status_at_pick VARCHAR(20);

-- Backfill from current player status — accurate right after the draft before statuses drift.
UPDATE draft_picks dp
SET status_at_pick = p.status
FROM players p
WHERE dp.player_id = p.id AND dp.status_at_pick IS NULL;
