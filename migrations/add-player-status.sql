-- Add status column to players table
ALTER TABLE players 
ADD COLUMN status VARCHAR(20) DEFAULT 'Active';

-- Comment on the column for documentation
COMMENT ON COLUMN players.status IS 'Current MLB status: Active, IL, DTD, etc.';