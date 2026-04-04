const express = require('express');
const { computeTitles, asArray } = require('../badges/titles');
const { BADGE_DEFS } = require('../badges/definitions');

const router = express.Router();

// All badge awards + currently-held titles for one team
router.get('/:seasonId/team/:teamId', async (req, res) => {
  const pool = req.app.get('pool');
  const { seasonId, teamId } = req.params;
  try {
    const awards = await pool.query(
      `SELECT badge_key, awarded_date, context
       FROM badge_awards
       WHERE season_id = $1 AND team_id = $2
       ORDER BY awarded_date DESC, id DESC`,
      [seasonId, teamId]
    );

    const today = new Date().toISOString().split('T')[0];
    const allTitles = await computeTitles(pool, seasonId, today);
    const teamIdInt = parseInt(teamId, 10);
    const titles = [];
    for (const [key, val] of Object.entries(allTitles)) {
      for (const entry of asArray(val)) {
        if (entry.team_id === teamIdInt) {
          titles.push({ badge_key: key, context: entry.context });
        }
      }
    }

    res.json({ awards: awards.rows, titles });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load badges' });
  }
});

// Current title holders league-wide
router.get('/:seasonId/titles', async (req, res) => {
  const pool = req.app.get('pool');
  try {
    const today = new Date().toISOString().split('T')[0];
    const titles = await computeTitles(pool, req.params.seasonId, today);
    res.json(titles);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to compute titles' });
  }
});

// Badge definitions (for clients that want to stay in sync)
router.get('/definitions', (req, res) => {
  res.json(BADGE_DEFS);
});

module.exports = router;
