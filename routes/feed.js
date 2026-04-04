const express = require('express');

const router = express.Router();

// Newest-first feed, cursor-paginated by id.
router.get('/:seasonId', async (req, res) => {
  const pool = req.app.get('pool');
  const { seasonId } = req.params;
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const beforeId = req.query.before_id ? parseInt(req.query.before_id, 10) : null;

  try {
    const params = [seasonId];
    let where = 'fe.season_id = $1';
    if (beforeId) {
      params.push(beforeId);
      where += ` AND fe.id < $${params.length}`;
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

    const nextCursor = r.rows.length === limit ? r.rows[r.rows.length - 1].id : null;
    res.json({ events: r.rows, next_cursor: nextCursor });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load feed' });
  }
});

module.exports = router;
