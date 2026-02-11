const express = require('express');
const bcrypt = require('bcrypt');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

router.use(authenticateToken);

// Middleware: require commissioner role
const requireCommissioner = (req, res, next) => {
  if (!req.user.commissionerLeagueIds || req.user.commissionerLeagueIds.length === 0) {
    return res.status(403).json({ error: 'Commissioner access required' });
  }
  next();
};

router.use(requireCommissioner);

// ============================================================================
// SEASON MANAGEMENT
// ============================================================================

// Create a new season for a league
router.post('/seasons', async (req, res) => {
  const pool = req.app.get('pool');
  const { league_id, season_year, start_date, end_date } = req.body;

  if (!league_id || !season_year || !start_date || !end_date) {
    return res.status(400).json({ error: 'All fields required: league_id, season_year, start_date, end_date' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const seasonResult = await client.query(
      'INSERT INTO seasons (league_id, season_year, start_date, end_date) VALUES ($1, $2, $3, $4) RETURNING *',
      [league_id, season_year, start_date, end_date]
    );
    const newSeason = seasonResult.rows[0];

    // Copy roster templates from the previous season of this league
    const prevSeason = await client.query(
      'SELECT id FROM seasons WHERE league_id = $1 AND id != $2 ORDER BY season_year DESC LIMIT 1',
      [league_id, newSeason.id]
    );
    if (prevSeason.rows.length > 0) {
      await client.query(
        `INSERT INTO roster_templates (season_id, position, count)
         SELECT $1, position, count FROM roster_templates WHERE season_id = $2`,
        [newSeason.id, prevSeason.rows[0].id]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, season: newSeason });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Update season dates
router.put('/seasons/:id', async (req, res) => {
  const pool = req.app.get('pool');
  const { start_date, end_date } = req.body;

  try {
    const result = await pool.query(
      'UPDATE seasons SET start_date = COALESCE($1, start_date), end_date = COALESCE($2, end_date), updated_at = NOW() WHERE id = $3 RETURNING *',
      [start_date, end_date, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Season not found' });
    res.json({ success: true, season: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// TEAM MANAGEMENT
// ============================================================================

// Create a team in a season
router.post('/teams', async (req, res) => {
  const pool = req.app.get('pool');
  const { season_id, name, manager_name } = req.body;

  if (!season_id || !name || !manager_name) {
    return res.status(400).json({ error: 'All fields required: season_id, name, manager_name' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO teams (season_id, name, manager_name) VALUES ($1, $2, $3) RETURNING *',
      [season_id, name, manager_name]
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
    if (result.rows.length === 0) return res.status(404).json({ error: 'Team not found' });
    res.json({ success: true, team: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// USER MANAGEMENT
// ============================================================================

router.get('/users', async (req, res) => {
  const pool = req.app.get('pool');
  try {
    const result = await pool.query(`
      SELECT u.id, u.email, u.created_at,
             COALESCE(
               (SELECT json_agg(json_build_object('league_id', ul.league_id, 'role', ul.role))
                FROM user_leagues ul WHERE ul.user_id = u.id),
               '[]'::json
             ) as league_roles,
             COALESCE(
               (SELECT json_agg(json_build_object('team_id', ut.team_id, 'team_name', t.name))
                FROM user_teams ut JOIN teams t ON ut.team_id = t.id WHERE ut.user_id = u.id),
               '[]'::json
             ) as team_assignments
      FROM users u ORDER BY u.email
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/users', async (req, res) => {
  const pool = req.app.get('pool');
  const { email, password, team_name } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await client.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at',
      [email.toLowerCase(), passwordHash]
    );
    const newUser = result.rows[0];

    // Auto-assign manager role in commissioner's league
    const leagueId = req.user.commissionerLeagueIds?.[0];
    if (leagueId) {
      await client.query(
        'INSERT INTO user_leagues (user_id, league_id, role) VALUES ($1, $2, $3)',
        [newUser.id, leagueId, 'manager']
      );

      // Create team and assign user if team_name provided
      if (team_name) {
        // Find the most recent season for this league
        const seasonResult = await client.query(
          'SELECT id FROM seasons WHERE league_id = $1 ORDER BY season_year DESC LIMIT 1',
          [leagueId]
        );
        if (seasonResult.rows.length > 0) {
          const seasonId = seasonResult.rows[0].id;
          const teamResult = await client.query(
            'INSERT INTO teams (season_id, name, manager_name) VALUES ($1, $2, $3) RETURNING id',
            [seasonId, team_name, email.split('@')[0]]
          );
          await client.query(
            'INSERT INTO user_teams (user_id, team_id) VALUES ($1, $2)',
            [newUser.id, teamResult.rows[0].id]
          );
        }
      }
    }

    await client.query('COMMIT');
    res.json({ success: true, user: newUser });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Assign user to a team
router.post('/user-teams', async (req, res) => {
  const pool = req.app.get('pool');
  const { user_id, team_id } = req.body;

  if (!user_id || !team_id) {
    return res.status(400).json({ error: 'user_id and team_id required' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO user_teams (user_id, team_id) VALUES ($1, $2) RETURNING *',
      [user_id, team_id]
    );
    res.json({ success: true, assignment: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'User already assigned to this team' });
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Assign league role
router.post('/user-leagues', async (req, res) => {
  const pool = req.app.get('pool');
  const { user_id, league_id, role } = req.body;

  if (!user_id || !league_id) {
    return res.status(400).json({ error: 'user_id and league_id required' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO user_leagues (user_id, league_id, role) VALUES ($1, $2, $3) ON CONFLICT (user_id, league_id) DO UPDATE SET role = $3 RETURNING *',
      [user_id, league_id, role || 'manager']
    );
    res.json({ success: true, assignment: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// NEW SEASON SETUP (one-stop)
// ============================================================================

router.post('/new-season', async (req, res) => {
  const pool = req.app.get('pool');
  const { league_id, season_year, start_date, end_date, source_season_id } = req.body;

  if (!league_id || !season_year || !start_date || !end_date) {
    return res.status(400).json({ error: 'All fields required: league_id, season_year, start_date, end_date' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Create the season
    const seasonResult = await client.query(
      'INSERT INTO seasons (league_id, season_year, start_date, end_date) VALUES ($1, $2, $3, $4) RETURNING *',
      [league_id, season_year, start_date, end_date]
    );
    const newSeason = seasonResult.rows[0];

    const newTeams = [];
    if (source_season_id) {
      // 2. Copy roster templates
      await client.query(
        `INSERT INTO roster_templates (season_id, position, count)
         SELECT $1, position, count FROM roster_templates WHERE season_id = $2`,
        [newSeason.id, source_season_id]
      );

      // 3. Clone teams
      const sourceTeams = await client.query(
        'SELECT name, manager_name FROM teams WHERE season_id = $1',
        [source_season_id]
      );

      for (const team of sourceTeams.rows) {
        const result = await client.query(
          'INSERT INTO teams (season_id, name, manager_name) VALUES ($1, $2, $3) RETURNING *',
          [newSeason.id, team.name, team.manager_name]
        );
        newTeams.push(result.rows[0]);
      }

      // 4. Reassign users to new teams (match by team name)
      const sourceUserTeams = await client.query(`
        SELECT ut.user_id, t.name as team_name
        FROM user_teams ut
        JOIN teams t ON ut.team_id = t.id
        WHERE t.season_id = $1
      `, [source_season_id]);

      for (const userTeam of sourceUserTeams.rows) {
        const newTeam = newTeams.find(t => t.name === userTeam.team_name);
        if (newTeam) {
          await client.query(
            'INSERT INTO user_teams (user_id, team_id) VALUES ($1, $2) ON CONFLICT (user_id, team_id) DO NOTHING',
            [userTeam.user_id, newTeam.id]
          );
        }
      }
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      season: newSeason,
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
// ROSTER TEMPLATES
// ============================================================================

router.get('/seasons/:seasonId/roster-templates', async (req, res) => {
  const pool = req.app.get('pool');
  try {
    const result = await pool.query(
      'SELECT id, position, count FROM roster_templates WHERE season_id = $1 ORDER BY id',
      [req.params.seasonId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.put('/seasons/:seasonId/roster-templates', async (req, res) => {
  const pool = req.app.get('pool');
  const { templates } = req.body; // Array of { position, count }

  if (!templates || !Array.isArray(templates)) {
    return res.status(400).json({ error: 'templates array required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM roster_templates WHERE season_id = $1', [req.params.seasonId]);
    for (const t of templates) {
      await client.query(
        'INSERT INTO roster_templates (season_id, position, count) VALUES ($1, $2, $3)',
        [req.params.seasonId, t.position, t.count]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Update league name
router.put('/leagues/:leagueId', async (req, res) => {
  const pool = req.app.get('pool');
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });

  try {
    const result = await pool.query(
      'UPDATE leagues SET name = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [name, req.params.leagueId]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'League not found' });
    res.json({ success: true, league: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// ROSTER AUDIT TRAIL
// ============================================================================

router.get('/teams/:teamId/roster-history', async (req, res) => {
  const pool = req.app.get('pool');
  try {
    const result = await pool.query(`
      SELECT tr.id, tr.position, tr.drafted_position, tr.status, tr.reason,
        tr.effective_date, tr.end_date, p.name as player_name, p.primary_position
      FROM team_rosters tr JOIN players p ON tr.player_id = p.id
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

router.get('/players/search', async (req, res) => {
  const pool = req.app.get('pool');
  const { q, position } = req.query;

  if (!q || q.length < 2) {
    return res.status(400).json({ error: 'Search query must be at least 2 characters' });
  }

  try {
    let query = 'SELECT id, name, mlb_id, primary_position, current_mlb_team_id, status FROM players WHERE name ILIKE $1';
    const params = [`%${q}%`];

    if (position) {
      query += ' AND primary_position = $2';
      params.push(position);
    }

    query += ' ORDER BY name LIMIT 50';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
