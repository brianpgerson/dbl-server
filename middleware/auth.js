const jwt = require('jsonwebtoken');

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Middleware to check if user can manage a specific team
const requireTeamAccess = async (req, res, next) => {
  const pool = req.app.get('pool');
  const teamId = parseInt(req.body.teamId || req.params.teamId);

  if (!teamId) {
    return res.status(400).json({ error: 'Team ID required' });
  }

  const canManageTeam = req.user.teamIds.includes(teamId);

  let canCommissionTeam = false;
  if (!canManageTeam && req.user.commissionerLeagues.length > 0) {
    const result = await pool.query('SELECT league_id FROM teams WHERE id = $1', [teamId]);
    if (result.rows.length > 0) {
      canCommissionTeam = req.user.commissionerLeagues.includes(result.rows[0].league_id);
    }
  }

  if (!canManageTeam && !canCommissionTeam) {
    return res.status(403).json({ error: 'Not authorized to manage this team' });
  }

  next();
};

module.exports = { authenticateToken, requireTeamAccess };
