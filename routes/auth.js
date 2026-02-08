const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const router = express.Router();

router.post('/login', async (req, res) => {
  const pool = req.app.get('pool');
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    // Get user
    const userResult = await pool.query(
      'SELECT id, email, password_hash FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = userResult.rows[0];

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Get league roles from user_leagues
    const leagueRolesResult = await pool.query(
      'SELECT league_id, role FROM user_leagues WHERE user_id = $1',
      [user.id]
    );
    const leagueRoles = leagueRolesResult.rows;
    const commissionerLeagueIds = leagueRoles
      .filter(r => r.role === 'commissioner')
      .map(r => r.league_id);

    // Get team assignments from user_teams
    const teamsResult = await pool.query(
      `SELECT ut.team_id, t.name as team_name, t.season_id
       FROM user_teams ut
       JOIN teams t ON ut.team_id = t.id
       WHERE ut.user_id = $1`,
      [user.id]
    );
    const teamIds = teamsResult.rows.map(t => t.team_id);

    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        teamIds,
        commissionerLeagueIds
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        teams: teamsResult.rows.map(t => ({ id: t.team_id, name: t.team_name })),
        commissionerLeagueIds
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
