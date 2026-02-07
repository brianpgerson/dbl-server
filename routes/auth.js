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
    const userQuery = `
      SELECT u.id, u.email, u.password_hash,
             array_agg(ut.team_id) as team_ids,
             array_agg(t.name) as team_names,
             array_agg(ut.role) as roles,
             array_agg(ut.league_id) as league_ids
      FROM users u
      LEFT JOIN user_teams ut ON u.id = ut.user_id
      LEFT JOIN teams t ON ut.team_id = t.id
      WHERE u.email = $1
      GROUP BY u.id, u.email, u.password_hash
    `;

    const result = await pool.query(userQuery, [email.toLowerCase()]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const roles = user.roles.filter(role => role !== null);
    const leagueIds = user.league_ids.filter(id => id !== null);
    const commissionerLeagues = leagueIds.filter((leagueId, index) =>
      roles[index] === 'commissioner'
    );

    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        teamIds: user.team_ids.filter(id => id !== null),
        leagueIds: leagueIds,
        commissionerLeagues: commissionerLeagues
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        teams: user.team_ids.filter(id => id !== null).map((id, index) => ({
          id: id,
          name: user.team_names[index]
        })),
        commissionerLeagues: commissionerLeagues
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
