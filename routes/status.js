const express = require('express');
const { getActiveSeason, formatDate } = require('../helpers/league');

const router = express.Router();

// Returns the current app state — used by frontend to determine what to render
router.get('/', async (req, res) => {
  const pool = req.app.get('pool');
  try {
    const today = new Date().toISOString().split('T')[0];

    // Get all seasons ordered by year
    const seasonsResult = await pool.query(
      `SELECT s.id, s.league_id, s.season_year, s.start_date, s.end_date, l.name as league_name
       FROM seasons s JOIN leagues l ON s.league_id = l.id
       ORDER BY s.season_year DESC`
    );

    if (seasonsResult.rows.length === 0) {
      return res.json({ state: 'offseason', season: null, previous_season: null, draft: null });
    }

    const latestSeason = seasonsResult.rows[0];
    const latestEndDate = formatDate(latestSeason.end_date);
    const latestStartDate = formatDate(latestSeason.start_date);

    // Check draft status for the latest season
    const draftResult = await pool.query(
      'SELECT id, status, current_pick FROM drafts WHERE season_id = $1 ORDER BY created_at DESC LIMIT 1',
      [latestSeason.id]
    );
    const draft = draftResult.rows[0] || null;
    const draftStatus = draft?.status || null;

    // Find the previous season (for offseason display)
    const previousSeason = seasonsResult.rows.length > 1 ? seasonsResult.rows[1] : null;

    let state;

    if (today > latestEndDate) {
      // Past the end of the most recent season
      state = 'offseason';
    } else if (draftStatus === 'active') {
      state = 'drafting';
    } else if (draftStatus === 'complete') {
      state = 'season';
    } else {
      // Season exists but draft hasn't completed (setup or null)
      state = 'preseason';
    }

    res.json({
      state,
      season: {
        id: latestSeason.id,
        league_id: latestSeason.league_id,
        league_name: latestSeason.league_name,
        season_year: latestSeason.season_year,
        start_date: latestStartDate,
        end_date: latestEndDate
      },
      previous_season: previousSeason ? {
        id: previousSeason.id,
        season_year: previousSeason.season_year,
        league_name: previousSeason.league_name
      } : null,
      draft: draft ? {
        id: draft.id,
        status: draft.status,
        current_pick: draft.current_pick
      } : null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
