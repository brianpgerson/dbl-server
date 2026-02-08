// Get the most recent season (across all leagues)
async function getActiveSeason(pool) {
  const result = await pool.query(
    `SELECT s.id, s.league_id, s.season_year, s.start_date, s.end_date, l.name as league_name
     FROM seasons s
     JOIN leagues l ON s.league_id = l.id
     ORDER BY s.season_year DESC LIMIT 1`
  );
  if (result.rows.length === 0) return null;
  return result.rows[0];
}

// Get a specific season by ID
async function getSeason(pool, seasonId) {
  const result = await pool.query(
    `SELECT s.id, s.league_id, s.season_year, s.start_date, s.end_date, l.name as league_name
     FROM seasons s
     JOIN leagues l ON s.league_id = l.id
     WHERE s.id = $1`,
    [seasonId]
  );
  if (result.rows.length === 0) return null;
  return result.rows[0];
}

// Format a pg DATE value to YYYY-MM-DD string
function formatDate(pgDate) {
  return new Date(pgDate).toISOString().split('T')[0];
}

module.exports = { getActiveSeason, getSeason, formatDate };
