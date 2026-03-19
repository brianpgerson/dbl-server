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
  if (!canManageTeam && req.user.commissionerLeagueIds.length > 0) {
    // Get the team's league via season
    const result = await pool.query(
      `SELECT s.league_id FROM teams t JOIN seasons s ON t.season_id = s.id WHERE t.id = $1`,
      [teamId]
    );
    if (result.rows.length > 0) {
      canCommissionTeam = req.user.commissionerLeagueIds.includes(result.rows[0].league_id);
    }
  }

  if (!canManageTeam && !canCommissionTeam) {
    return res.status(403).json({ error: 'Not authorized to manage this team' });
  }

  next();
};

const requireCommissioner = (req, res, next) => {
  if (!req.user.commissionerLeagueIds || req.user.commissionerLeagueIds.length === 0) {
    return res.status(403).json({ error: 'Commissioner access required' });
  }
  next();
};

// Throws if caller is not commissioner of the given league. Use inside route handlers
// after resolving season_id/team_id/draft_id → league_id.
const assertCommissionerOfLeague = (req, leagueId) => {
  if (!req.user.commissionerLeagueIds.includes(leagueId)) {
    const err = new Error('Not authorized for this league');
    err.status = 403;
    throw err;
  }
};

// Resolve season → league_id and assert ownership. Works with pool or client.
const assertCommissionerOfSeason = async (db, req, seasonId) => {
  const r = await db.query('SELECT league_id FROM seasons WHERE id = $1', [seasonId]);
  if (r.rows.length === 0) {
    const err = new Error('Season not found');
    err.status = 404;
    throw err;
  }
  assertCommissionerOfLeague(req, r.rows[0].league_id);
};

module.exports = {
  authenticateToken,
  requireTeamAccess,
  requireCommissioner,
  assertCommissionerOfLeague,
  assertCommissionerOfSeason,
};
