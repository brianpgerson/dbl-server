const express = require('express');

const router = express.Router();

// Newest-first feed, keyset-paginated by (event_date, id) since id order != date order
// (hr/title_change rows get fresh ids every sync while badge/swap rows keep originals).
router.get('/:seasonId', async (req, res) => {
  const pool = req.app.get('pool');
  const { seasonId } = req.params;
  const limit = Math.max(1, Math.min(parseInt(req.query.limit, 10) || 50, 200));
  const beforeDate = req.query.before_date || null;
  const beforeId = req.query.before_id ? parseInt(req.query.before_id, 10) : null;

  try {
    const params = [seasonId];
    let where = 'fe.season_id = $1';
    if (beforeDate && beforeId) {
      params.push(beforeDate, beforeId);
      where += ` AND (fe.event_date, fe.id) < ($${params.length - 1}::date, $${params.length})`;
    }
    params.push(limit);

    const r = await pool.query(
      `SELECT fe.id, fe.team_id, t.name as team_name, t.manager_name,
              fe.event_type, fe.event_date, fe.payload, fe.created_at
       FROM feed_events fe
       LEFT JOIN teams t ON fe.team_id = t.id
       WHERE ${where}
       ORDER BY fe.event_date DESC, fe.id DESC
       LIMIT $${params.length}`,
      params
    );

    const last = r.rows[r.rows.length - 1];
    const nextCursor = r.rows.length === limit
      ? { event_date: last.event_date, id: last.id }
      : null;
    res.json({ events: r.rows, next_cursor: nextCursor });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load feed' });
  }
});

module.exports = router;
