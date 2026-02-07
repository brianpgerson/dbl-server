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

// Get standings for a specific league
router.get('/:leagueId/standings', async (req, res) => {
  const pool = req.app.get('pool');
  try {
    const leagueId = req.params.leagueId;

    // Get league info
    const leagueResult = await pool.query('SELECT * FROM leagues WHERE id = $1', [leagueId]);
    if (leagueResult.rows.length === 0) {
      return res.status(404).json({ error: 'League not found' });
    }
    const league = leagueResult.rows[0];

    // Get standings: total HRs per team for this league
    const standingsQuery = `
      SELECT
        t.id as team_id,
        t.name as team_name,
        t.manager_name,
        COUNT(s.id)::integer as total_hrs
      FROM teams t
      LEFT JOIN scores s ON s.team_id = t.id
      WHERE t.league_id = $1
      GROUP BY t.id, t.name, t.manager_name
      ORDER BY total_hrs DESC
    `;
    const result = await pool.query(standingsQuery, [leagueId]);

    res.json({
      league: {
        id: league.id,
        name: league.name,
        season_year: league.season_year,
        start_date: league.start_date,
        end_date: league.end_date
      },
      standings: result.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get final rosters for a specific league (end-of-season snapshot)
router.get('/:leagueId/rosters', async (req, res) => {
  const pool = req.app.get('pool');
  try {
    const leagueId = req.params.leagueId;

    const leagueResult = await pool.query('SELECT * FROM leagues WHERE id = $1', [leagueId]);
    if (leagueResult.rows.length === 0) {
      return res.status(404).json({ error: 'League not found' });
    }
    const league = leagueResult.rows[0];

    // Get rosters as they were at season end (or current if season is active)
    const rostersQuery = `
      SELECT
        t.id as team_id,
        t.name as team_name,
        t.manager_name,
        p.name as player_name,
        p.primary_position,
        tr.position,
        tr.drafted_position,
        tr.status as roster_status
      FROM teams t
      JOIN team_rosters tr ON tr.team_id = t.id
      JOIN players p ON tr.player_id = p.id
      WHERE t.league_id = $1
        AND tr.effective_date <= $2
        AND (tr.end_date IS NULL OR tr.end_date > $2)
      ORDER BY t.name,
        CASE tr.position WHEN 'BEN' THEN 'ZZZ' ELSE tr.position END
    `;
    const result = await pool.query(rostersQuery, [leagueId, league.end_date]);

    // Group by team
    const teamRosters = {};
    result.rows.forEach(row => {
      if (!teamRosters[row.team_id]) {
        teamRosters[row.team_id] = {
          team_id: row.team_id,
          team_name: row.team_name,
          manager_name: row.manager_name,
          players: []
        };
      }
      teamRosters[row.team_id].players.push({
        name: row.player_name,
        primary_position: row.primary_position,
        position: row.position,
        drafted_position: row.drafted_position,
        roster_status: row.roster_status
      });
    });

    res.json({
      league: {
        id: league.id,
        name: league.name,
        season_year: league.season_year
      },
      rosters: Object.values(teamRosters)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get race data for a specific league (for history viewing)
router.get('/:leagueId/race', async (req, res) => {
  const pool = req.app.get('pool');
  try {
    const leagueId = req.params.leagueId;

    const leagueResult = await pool.query('SELECT * FROM leagues WHERE id = $1', [leagueId]);
    if (leagueResult.rows.length === 0) {
      return res.status(404).json({ error: 'League not found' });
    }
    const league = leagueResult.rows[0];

    const query = `
      WITH daily_totals AS (
        SELECT teams.id as team_id, teams.name as team_name, scores.date::date, COUNT(*) as daily_hrs
        FROM scores JOIN teams ON scores.team_id = teams.id
        WHERE teams.league_id = $1
        GROUP BY teams.id, teams.name, scores.date::date
      ),
      running_totals AS (
        SELECT team_id, team_name, date, daily_hrs,
          SUM(daily_hrs) OVER (PARTITION BY team_name ORDER BY date) as total_hrs
        FROM daily_totals
      ),
      team_list AS (SELECT id, name FROM teams WHERE league_id = $1),
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
    const result = await pool.query(query, [league.id, league.start_date, league.end_date]);
    res.json({ season_year: league.season_year, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
