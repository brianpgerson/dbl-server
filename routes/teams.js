const express = require('express');
const { getTodaysGameData } = require('../helpers/mlb');

const router = express.Router();

// Get all teams (optionally filter by league_id)
router.get('/', async (req, res) => {
  const pool = req.app.get('pool');
  try {
    let query, params;
    if (req.query.league_id) {
      query = `SELECT id, name, manager_name, league_id FROM teams WHERE league_id = $1 ORDER BY name`;
      params = [req.query.league_id];
    } else {
      query = `
        SELECT id, name, manager_name, league_id FROM teams
        WHERE league_id = (SELECT id FROM leagues ORDER BY season_year DESC LIMIT 1)
        ORDER BY name
      `;
      params = [];
    }
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get team roster with HR counts
router.get('/:id/roster-with-hrs', async (req, res) => {
  const pool = req.app.get('pool');
  try {
    const query = `
      WITH current_roster AS (
        SELECT
          p.id as player_id, p.name, p.primary_position, p.mlb_id,
          tr.position, tr.drafted_position, tr.status as roster_status,
          p.status as player_status, p.current_mlb_team_id
        FROM team_rosters tr
        JOIN players p ON tr.player_id = p.id
        WHERE tr.team_id = $1
        AND tr.end_date IS NULL
      ),
      player_hrs AS (
        SELECT
          tr.player_id,
          COUNT(s.id) as hr_count
        FROM team_rosters tr
        JOIN scores s ON s.team_id = tr.team_id
          AND s.position = tr.position
          AND s.date >= tr.effective_date
          AND (tr.end_date IS NULL OR s.date < tr.end_date)
        WHERE tr.team_id = $1
        AND tr.status = 'STARTER'
        GROUP BY tr.player_id
      )
      SELECT
        r.player_id, r.name, r.position, r.drafted_position, r.roster_status, r.player_status, r.current_mlb_team_id,
        COALESCE(ph.hr_count, 0)::integer as hr_count
      FROM current_roster r
      LEFT JOIN player_hrs ph ON ph.player_id = r.player_id
      ORDER BY
        CASE r.position
          WHEN 'BEN' THEN 'ZZZ'
          ELSE r.position
        END,
        hr_count DESC
    `;
    const result = await pool.query(query, [req.params.id]);

    // Get unique MLB team IDs from roster
    const uniqueTeamIds = [...new Set(result.rows
      .map(player => player.current_mlb_team_id)
      .filter(id => id !== null))];

    // Fetch today's game data
    const gameData = await getTodaysGameData(uniqueTeamIds);

    // Add game info to each player
    const rosterWithGames = result.rows.map(player => ({
      ...player,
      game_info: gameData[player.current_mlb_team_id]?.text || 'No game',
      game_status: gameData[player.current_mlb_team_id]?.status || 'none'
    }));

    res.json(rosterWithGames);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
