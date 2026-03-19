const express = require('express');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const MAX_ATTEMPTS = 1;
const WARMUP_SWINGS = 5;
const REAL_SWINGS = 5;
const TOTAL_SWINGS = WARMUP_SWINGS + REAL_SWINGS;

// ============================================================================
// PUBLIC: Leaderboard (only counts non-warmup swings)
// ============================================================================

router.get('/:seasonId/leaderboard', async (req, res) => {
  const pool = req.app.get('pool');
  try {
    const result = await pool.query(`
      SELECT
        bds.user_id,
        u.email,
        MAX(t.name) as team_name,
        MAX(t.manager_name) as manager_name,
        MAX(bds.distance_feet * 12 + bds.distance_inches) as best_distance_total_inches,
        COUNT(DISTINCT bds.attempt_number) as attempts_used
      FROM big_dongos_swings bds
      JOIN users u ON bds.user_id = u.id
      LEFT JOIN user_teams ut ON ut.user_id = u.id
      LEFT JOIN teams t ON ut.team_id = t.id AND t.season_id = bds.season_id
      WHERE bds.season_id = $1
        AND bds.is_warmup = false
      GROUP BY bds.user_id, u.email
      ORDER BY best_distance_total_inches DESC
    `, [req.params.seasonId]);

    const leaderboard = result.rows.map((row, idx) => ({
      rank: idx + 1,
      user_id: row.user_id,
      email: row.email,
      team_name: row.team_name,
      manager_name: row.manager_name || row.email,
      best_distance_inches: row.best_distance_total_inches,
      attempts_used: parseInt(row.attempts_used)
    }));

    // Get exact feet/inches for each user's best swing
    for (const entry of leaderboard) {
      const bestSwing = await pool.query(`
        SELECT distance_feet, distance_inches, exit_velocity, launch_angle
        FROM big_dongos_swings
        WHERE season_id = $1 AND user_id = $2 AND is_warmup = false
        ORDER BY (distance_feet * 12 + distance_inches) DESC
        LIMIT 1
      `, [req.params.seasonId, entry.user_id]);

      if (bestSwing.rows.length > 0) {
        entry.best_feet = bestSwing.rows[0].distance_feet;
        entry.best_inches = bestSwing.rows[0].distance_inches;
        entry.exit_velocity = parseFloat(bestSwing.rows[0].exit_velocity);
        entry.launch_angle = parseFloat(bestSwing.rows[0].launch_angle);
      }
    }

    res.json({ leaderboard, max_attempts: MAX_ATTEMPTS });
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// ============================================================================
// AUTHENTICATED: My results (includes swing count for resume)
// ============================================================================

router.get('/:seasonId/my-results', authenticateToken, async (req, res) => {
  const pool = req.app.get('pool');
  try {
    const result = await pool.query(`
      SELECT attempt_number, swing_number, is_warmup, distance_feet, distance_inches,
             exit_velocity, launch_angle, contact_quality, created_at
      FROM big_dongos_swings
      WHERE season_id = $1 AND user_id = $2
      ORDER BY attempt_number, swing_number
    `, [req.params.seasonId, req.user.userId]);

    // Group by attempt
    const attempts = {};
    for (const row of result.rows) {
      if (!attempts[row.attempt_number]) {
        attempts[row.attempt_number] = [];
      }
      attempts[row.attempt_number].push(row);
    }

    const attemptNumbers = Object.keys(attempts).map(Number);
    const attemptCount = attemptNumbers.length;

    // For resume: highest swing_number in the latest attempt (not .length — tolerates gaps from failed saves)
    let currentAttemptSwings = 0;
    let currentAttemptNumber = 0;
    if (attemptCount > 0) {
      currentAttemptNumber = Math.max(...attemptNumbers);
      const latestAttempt = attempts[currentAttemptNumber];
      currentAttemptSwings = Math.max(...latestAttempt.map(s => s.swing_number));
    }

    res.json({
      attempts,
      attempts_used: attemptCount,
      attempts_remaining: MAX_ATTEMPTS - attemptCount,
      max_attempts: MAX_ATTEMPTS,
      current_attempt_swings: currentAttemptSwings,
      total_swings_per_attempt: TOTAL_SWINGS,
    });
  } catch (error) {
    console.error('Error fetching results:', error);
    res.status(500).json({ error: 'Failed to fetch results' });
  }
});

// ============================================================================
// AUTHENTICATED: Save a swing
// ============================================================================

router.post('/:seasonId/swing', authenticateToken, async (req, res) => {
  const pool = req.app.get('pool');
  const { attempt_number, swing_number, distance_feet, distance_inches,
          exit_velocity, launch_angle, contact_quality } = req.body;

  if (!attempt_number || !swing_number || distance_feet == null || distance_inches == null) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (attempt_number < 1 || attempt_number > MAX_ATTEMPTS) {
    return res.status(400).json({ error: `Attempt number must be 1-${MAX_ATTEMPTS}` });
  }

  if (swing_number < 1 || swing_number > TOTAL_SWINGS) {
    return res.status(400).json({ error: `Swing number must be 1-${TOTAL_SWINGS}` });
  }

  const is_warmup = swing_number <= WARMUP_SWINGS;

  try {
    // Check attempts used
    const attemptCheck = await pool.query(`
      SELECT COUNT(DISTINCT attempt_number) as count
      FROM big_dongos_swings
      WHERE season_id = $1 AND user_id = $2
    `, [req.params.seasonId, req.user.userId]);

    const usedAttempts = parseInt(attemptCheck.rows[0].count);

    const isExistingAttempt = await pool.query(`
      SELECT 1 FROM big_dongos_swings
      WHERE season_id = $1 AND user_id = $2 AND attempt_number = $3
      LIMIT 1
    `, [req.params.seasonId, req.user.userId, attempt_number]);

    if (isExistingAttempt.rows.length === 0 && usedAttempts >= MAX_ATTEMPTS) {
      return res.status(400).json({ error: 'Maximum attempts reached' });
    }

    // Prevent duplicate swing numbers within an attempt
    const dupeCheck = await pool.query(`
      SELECT 1 FROM big_dongos_swings
      WHERE season_id = $1 AND user_id = $2 AND attempt_number = $3 AND swing_number = $4
      LIMIT 1
    `, [req.params.seasonId, req.user.userId, attempt_number, swing_number]);

    if (dupeCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Swing already recorded' });
    }

    const result = await pool.query(`
      INSERT INTO big_dongos_swings
        (season_id, user_id, attempt_number, swing_number, is_warmup,
         distance_feet, distance_inches, exit_velocity, launch_angle, contact_quality)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [
      req.params.seasonId, req.user.userId, attempt_number, swing_number,
      is_warmup,
      distance_feet, distance_inches, exit_velocity || 0, launch_angle || 0,
      contact_quality || 0
    ]);

    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(400).json({ error: 'Swing already recorded' });
    }
    console.error('Error saving swing:', error);
    res.status(500).json({ error: 'Failed to save swing' });
  }
});

module.exports = router;
