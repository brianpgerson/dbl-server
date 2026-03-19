-- Migration: Draft uniqueness constraints
-- Prevents duplicate drafts per season and duplicate player picks within a draft

-- One draft per season (partial: season_id is nullable in the existing schema)
CREATE UNIQUE INDEX drafts_season_id_unique
  ON drafts(season_id)
  WHERE season_id IS NOT NULL;

-- One pick per player per draft (partial: player_id is NULL until the pick is made)
CREATE UNIQUE INDEX draft_picks_draft_player_unique
  ON draft_picks(draft_id, player_id)
  WHERE player_id IS NOT NULL;
