const express = require('express');
const bcrypt = require('bcrypt');
const { authenticateToken } = require('../middleware/auth');
const { getActiveLeague } = require('../helpers/league');

const router = express.Router();

// All admin routes require authentication
router.use(authenticateToken);

// Middleware: require commissioner role
const requireCommissioner = (req, res, next) => {
  if (!req.user.commissionerLeagues || req.user.commissionerLeagues.length === 0) {
    return res.status(403).json({ error: 'Commissioner access required' });
  }
  next();
};

router.use(requireCommissioner);

// ============================================================================
// LEAGUE MANAGEMENT
// ============================================================================

// Create a new season/league
router.post('/leagues', async (req, res) => {
  const pool = req.app.get('pool');
  const { name, season_year, start_date, end_date } = req.body;

  if (!name || !season_year || !start_date || !end_date) {
    return res.status(400).json({ error: 'All fields required: name, season_year, start_date, end_date' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create the league
    const leagueResult = await client.query(
      'INSERT INTO leagues (name, season_year, start_date, end_date) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, season_year, start_date, end_date]
    );
    const newLeague = leagueResult.rows[0];

    // Copy roster templates from the previous league
    const prevLeague = await getActiveLeague(pool);
    if (prevLeague && prevLeague.id !== newLeague.id) {
      await client.query(
        `INSERT INTO roster_templates (league_id, position, count)
         SELECT $1, position, count FROM roster_templates WHERE league_id = $2`,
        [newLeague.id, prevLeague.id]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, league: newLeague });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// TEAM MANAGEMENT
// ============================================================================

// Create a team in a league
router.post('/teams', async (req, res) => {
  const pool = req.app.get('pool');
  const { league_id, name, manager_name } = req.body;

  if (!league_id || !name || !manager_name) {
    return res.status(400).json({ error: 'All fields required: league_id, name, manager_name' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO teams (league_id, name, manager_name) VALUES ($1, $2, $3) RETURNING *',
      [league_id, name, manager_name]
    );
    res.json({ success: true, team: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Update a team
router.put('/teams/:id', async (req, res) => {
  const pool = req.app.get('pool');
  const { name, manager_name } = req.body;

  try {
    const result = await pool.query(
      'UPDATE teams SET name = COALESCE($1, name), manager_name = COALESCE($2, manager_name), updated_at = NOW() WHERE id = $3 RETURNING *',
      [name, manager_name, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Team not found' });
    }
    res.json({ success: true, team: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Clone teams from a previous league to a new one
router.post('/leagues/:leagueId/clone-teams', async (req, res) => {
  const pool = req.app.get('pool');
  const { source_league_id } = req.body;
  const targetLeagueId = req.params.leagueId;

  if (!source_league_id) {
    return res.status(400).json({ error: 'source_league_id required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get source teams
    const sourceTeams = await client.query(
      'SELECT name, manager_name FROM teams WHERE league_id = $1',
      [source_league_id]
    );

    const newTeams = [];
    for (const team of sourceTeams.rows) {
      const result = await client.query(
        'INSERT INTO teams (league_id, name, manager_name) VALUES ($1, $2, $3) RETURNING *',
        [targetLeagueId, team.name, team.manager_name]
      );
      newTeams.push(result.rows[0]);
    }

    await client.query('COMMIT');
    res.json({ success: true, teams: newTeams });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// USER MANAGEMENT
// ============================================================================

// List all users
router.get('/users', async (req, res) => {
  const pool = req.app.get('pool');
  try {
    const result = await pool.query(`
      SELECT u.id, u.email, u.created_at,
             array_agg(json_build_object('team_id', ut.team_id, 'role', ut.role, 'league_id', ut.league_id)) as assignments
      FROM users u
      LEFT JOIN user_teams ut ON u.id = ut.user_id
      GROUP BY u.id, u.email, u.created_at
      ORDER BY u.email
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create a user
router.post('/users', async (req, res) => {
  const pool = req.app.get('pool');
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at',
      [email.toLowerCase(), passwordHash]
    );
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already exists' });
    }
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Assign a user to a team
router.post('/user-teams', async (req, res) => {
  const pool = req.app.get('pool');
  const { user_id, team_id, role, league_id } = req.body;

  if (!user_id || !team_id) {
    return res.status(400).json({ error: 'user_id and team_id required' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO user_teams (user_id, team_id, role, league_id) VALUES ($1, $2, $3, $4) RETURNING *',
      [user_id, team_id, role || 'manager', league_id]
    );
    res.json({ success: true, assignment: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'User already assigned to this team' });
    }
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// NEW SEASON SETUP (one-stop setup for a new season)
// ============================================================================

router.post('/new-season', async (req, res) => {
  const pool = req.app.get('pool');
  const { name, season_year, start_date, end_date, source_league_id } = req.body;

  if (!name || !season_year || !start_date || !end_date) {
    return res.status(400).json({ error: 'All fields required: name, season_year, start_date, end_date' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Create the league
    const leagueResult = await client.query(
      'INSERT INTO leagues (name, season_year, start_date, end_date) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, season_year, start_date, end_date]
    );
    const newLeague = leagueResult.rows[0];

    // 2. Clone roster templates from source league
    if (source_league_id) {
      await client.query(
        `INSERT INTO roster_templates (league_id, position, count)
         SELECT $1, position, count FROM roster_templates WHERE league_id = $2`,
        [newLeague.id, source_league_id]
      );
    }

    // 3. Clone teams from source league
    const newTeams = [];
    if (source_league_id) {
      const sourceTeams = await client.query(
        'SELECT name, manager_name FROM teams WHERE league_id = $1',
        [source_league_id]
      );

      for (const team of sourceTeams.rows) {
        const result = await client.query(
          'INSERT INTO teams (league_id, name, manager_name) VALUES ($1, $2, $3) RETURNING *',
          [newLeague.id, team.name, team.manager_name]
        );
        newTeams.push(result.rows[0]);
      }

      // 4. Reassign users to new teams (match by team name from source league)
      const sourceUserTeams = await client.query(`
        SELECT ut.user_id, ut.role, t.name as team_name
        FROM user_teams ut
        JOIN teams t ON ut.team_id = t.id
        WHERE t.league_id = $1
      `, [source_league_id]);

      for (const userTeam of sourceUserTeams.rows) {
        const newTeam = newTeams.find(t => t.name === userTeam.team_name);
        if (newTeam) {
          await client.query(
            'INSERT INTO user_teams (user_id, team_id, role, league_id) VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, team_id) DO NOTHING',
            [userTeam.user_id, newTeam.id, userTeam.role, newLeague.id]
          );
        }
      }
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      league: newLeague,
      teams: newTeams,
      message: `${season_year} season created with ${newTeams.length} teams`
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// ROSTER AUDIT TRAIL
// ============================================================================

// Get all roster moves for a team (including historical)
router.get('/teams/:teamId/roster-history', async (req, res) => {
  const pool = req.app.get('pool');
  try {
    const result = await pool.query(`
      SELECT
        tr.id, tr.position, tr.drafted_position, tr.status, tr.reason,
        tr.effective_date, tr.end_date,
        p.name as player_name, p.primary_position
      FROM team_rosters tr
      JOIN players p ON tr.player_id = p.id
      WHERE tr.team_id = $1
      ORDER BY tr.effective_date DESC, tr.created_at DESC
    `, [req.params.teamId]);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================================
// PLAYER SEARCH
// ============================================================================

// Search players by name (for draft, roster management)
router.get('/players/search', async (req, res) => {
  const pool = req.app.get('pool');
  const { q, position } = req.query;

  if (!q || q.length < 2) {
    return res.status(400).json({ error: 'Search query must be at least 2 characters' });
  }

  try {
    let query = `
      SELECT id, name, mlb_id, primary_position, current_mlb_team_id, status
      FROM players
      WHERE name ILIKE $1
    `;
    const params = [`%${q}%`];

    if (position) {
      query += ` AND primary_position = $2`;
      params.push(position);
    }

    query += ` ORDER BY name LIMIT 50`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
