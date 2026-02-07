const express = require('express');
const { getActiveLeague } = require('../helpers/league');

const router = express.Router();

// Get all leagues
router.get('/', async (req, res) => {
  const pool = req.app.get('pool');
  try {
    const result = await pool.query('SELECT id, name, season_year, start_date, end_date FROM leagues ORDER BY season_year DESC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get home run race data for the active league
router.get('/race', async (req, res) => {
  const pool = req.app.get('pool');
  try {
    const league = await getActiveLeague(pool);
    if (!league) {
      return res.status(404).json({ error: 'No league found' });
    }

    const query = `
      WITH daily_totals AS (
        SELECT
          teams.id as team_id,
          teams.name as team_name,
          scores.date::date,
          COUNT(*) as daily_hrs
        FROM scores
        JOIN teams ON scores.team_id = teams.id
        WHERE teams.league_id = $1
        GROUP BY teams.id, teams.name, scores.date::date
      ),
      running_totals AS (
        SELECT
          team_id,
          team_name,
          date,
          daily_hrs,
          SUM(daily_hrs) OVER (PARTITION BY team_name ORDER BY date) as total_hrs
        FROM daily_totals
      ),
      team_list AS (
        SELECT id, name
        FROM teams
        WHERE league_id = $1
      ),
      date_range AS (
        SELECT generate_series($2::date, LEAST(CURRENT_DATE, $3::date), '1 day'::interval)::date as date
      )
      SELECT
        t.name as team_name,
        d.date::text as date,
        COALESCE(r.daily_hrs, 0)::integer as daily_hrs,
        COALESCE(r.total_hrs, 0)::integer as total_hrs
      FROM team_list t
      CROSS JOIN date_range d
      LEFT JOIN running_totals r ON t.name = r.team_name AND d.date = r.date
      ORDER BY d.date, t.name
    `;
    const result = await pool.query(query, [league.id, league.start_date, league.end_date]);
    res.json({ season_year: league.season_year, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
