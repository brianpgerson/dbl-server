const express = require('express');
const { getActiveSeason, getSeason } = require('../helpers/league');

const router = express.Router();

// Get all leagues
router.get('/', async (req, res) => {
  const pool = req.app.get('pool');
  try {
    const result = await pool.query('SELECT id, name FROM leagues ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all seasons (optionally filter by league_id)
router.get('/seasons', async (req, res) => {
  const pool = req.app.get('pool');
  try {
    let query, params;
    if (req.query.league_id) {
      query = `SELECT s.id, s.league_id, s.season_year, s.start_date, s.end_date, l.name as league_name
               FROM seasons s JOIN leagues l ON s.league_id = l.id
               WHERE s.league_id = $1 ORDER BY s.season_year DESC`;
      params = [req.query.league_id];
    } else {
      query = `SELECT s.id, s.league_id, s.season_year, s.start_date, s.end_date, l.name as league_name
               FROM seasons s JOIN leagues l ON s.league_id = l.id
               ORDER BY s.season_year DESC`;
      params = [];
    }
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get home run race data for the active season
router.get('/race', async (req, res) => {
  const pool = req.app.get('pool');
  try {
    const season = await getActiveSeason(pool);
    if (!season) {
      return res.status(404).json({ error: 'No season found' });
    }

    const query = `
      WITH daily_totals AS (
        SELECT teams.id as team_id, teams.name as team_name, scores.date::date, COUNT(*) as daily_hrs
        FROM scores JOIN teams ON scores.team_id = teams.id
        WHERE teams.season_id = $1
        GROUP BY teams.id, teams.name, scores.date::date
      ),
      running_totals AS (
        SELECT team_id, team_name, date, daily_hrs,
          SUM(daily_hrs) OVER (PARTITION BY team_name ORDER BY date) as total_hrs
        FROM daily_totals
      ),
      team_list AS (SELECT id, name FROM teams WHERE season_id = $1),
      date_range AS (
        SELECT generate_series($2::date, LEAST(CURRENT_DATE, $3::date), '1 day'::interval)::date as date
      )
      SELECT t.name as team_name, d.date::text as date,
        COALESCE(r.daily_hrs, 0)::integer as daily_hrs,
        COALESCE(r.total_hrs, 0)::integer as total_hrs
      FROM team_list t CROSS JOIN date_range d
      LEFT JOIN running_totals r ON t.name = r.team_name AND d.date = r.date
      ORDER BY d.date, t.name
    `;
    const result = await pool.query(query, [season.id, season.start_date, season.end_date]);
    res.json({ season_year: season.season_year, league_name: season.league_name, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get standings for a specific season
router.get('/seasons/:seasonId/standings', async (req, res) => {
  const pool = req.app.get('pool');
  try {
    const season = await getSeason(pool, req.params.seasonId);
    if (!season) return res.status(404).json({ error: 'Season not found' });

    const result = await pool.query(`
      SELECT t.id as team_id, t.name as team_name, t.manager_name,
        COUNT(s.id)::integer as total_hrs
      FROM teams t LEFT JOIN scores s ON s.team_id = t.id
      WHERE t.season_id = $1
      GROUP BY t.id, t.name, t.manager_name
      ORDER BY total_hrs DESC
    `, [season.id]);

    res.json({ season, standings: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get final rosters for a specific season
router.get('/seasons/:seasonId/rosters', async (req, res) => {
  const pool = req.app.get('pool');
  try {
    const season = await getSeason(pool, req.params.seasonId);
    if (!season) return res.status(404).json({ error: 'Season not found' });

    const result = await pool.query(`
      SELECT t.id as team_id, t.name as team_name, t.manager_name,
        p.name as player_name, p.primary_position, tr.position, tr.drafted_position, tr.status as roster_status
      FROM teams t
      JOIN team_rosters tr ON tr.team_id = t.id
      JOIN players p ON tr.player_id = p.id
      WHERE t.season_id = $1
        AND tr.effective_date <= $2
        AND (tr.end_date IS NULL OR tr.end_date > $2)
      ORDER BY t.name, CASE tr.position WHEN 'BEN' THEN 'ZZZ' ELSE tr.position END
    `, [season.id, season.end_date]);

    const teamRosters = {};
    result.rows.forEach(row => {
      if (!teamRosters[row.team_id]) {
        teamRosters[row.team_id] = { team_id: row.team_id, team_name: row.team_name, manager_name: row.manager_name, players: [] };
      }
      teamRosters[row.team_id].players.push({
        name: row.player_name, primary_position: row.primary_position,
        position: row.position, drafted_position: row.drafted_position, roster_status: row.roster_status
      });
    });

    res.json({ season, rosters: Object.values(teamRosters) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get race data for a specific season
router.get('/seasons/:seasonId/race', async (req, res) => {
  const pool = req.app.get('pool');
  try {
    const season = await getSeason(pool, req.params.seasonId);
    if (!season) return res.status(404).json({ error: 'Season not found' });

    const query = `
      WITH daily_totals AS (
        SELECT teams.id as team_id, teams.name as team_name, scores.date::date, COUNT(*) as daily_hrs
        FROM scores JOIN teams ON scores.team_id = teams.id
        WHERE teams.season_id = $1
        GROUP BY teams.id, teams.name, scores.date::date
      ),
      running_totals AS (
        SELECT team_id, team_name, date, daily_hrs,
          SUM(daily_hrs) OVER (PARTITION BY team_name ORDER BY date) as total_hrs
        FROM daily_totals
      ),
      team_list AS (SELECT id, name FROM teams WHERE season_id = $1),
      date_range AS (
        SELECT generate_series($2::date, LEAST(CURRENT_DATE, $3::date), '1 day'::interval)::date as date
      )
      SELECT t.name as team_name, d.date::text as date,
        COALESCE(r.daily_hrs, 0)::integer as daily_hrs,
        COALESCE(r.total_hrs, 0)::integer as total_hrs
      FROM team_list t CROSS JOIN date_range d
      LEFT JOIN running_totals r ON t.name = r.team_name AND d.date = r.date
      ORDER BY d.date, t.name
    `;
    const result = await pool.query(query, [season.id, season.start_date, season.end_date]);
    res.json({ season_year: season.season_year, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get roster template for a season (public, read-only)
router.get('/seasons/:seasonId/roster-template', async (req, res) => {
  const pool = req.app.get('pool');
  try {
    const result = await pool.query(
      'SELECT position, count FROM roster_templates WHERE season_id = $1 ORDER BY id',
      [req.params.seasonId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
