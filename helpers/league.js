// Get the most recent (active) league from the database
async function getActiveLeague(pool) {
  const result = await pool.query(
    'SELECT id, name, season_year, start_date, end_date FROM leagues ORDER BY season_year DESC LIMIT 1'
  );
  if (result.rows.length === 0) return null;
  return result.rows[0];
}

// Format a pg DATE value to YYYY-MM-DD string
function formatDate(pgDate) {
  return new Date(pgDate).toISOString().split('T')[0];
}

module.exports = { getActiveLeague, formatDate };
