const express = require('express');
const { getActiveSeason, formatDate } = require('../helpers/league');

const router = express.Router();

// players.primary_position stores raw MLB StatsAPI position codes (see
// sync-mlb-data.js), not labels — same convention the draft position filter uses.
const POSITION_LABELS = {
  '2': 'C', '3': '1B', '4': '2B', '5': '3B', '6': 'SS',
  '7': 'LF', '8': 'CF', '9': 'RF', '10': 'DH',
  Y: 'DH', // two-way players slot as DH for this league
  O: 'OF', // generic outfielder — surfaced in all three OF tabs
};
const TAB_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];
const TOP_N = 30;

// GET /api/hr-leaders
// Returns top 15 HR leaders per position (plus ALL) for the active season.
// HR totals are real MLB stats from player_game_stats, not league-scored HRs.
// No status filter on purpose: season totals are historical facts, so IL'd or
// demoted players keep their spot on the board.
// manager_name is populated if the player is on a team's roster as of today.
router.get('/', async (req, res) => {
  const pool = req.app.get('pool');

  try {
    const season = await getActiveSeason(pool);
    if (!season) {
      return res.status(404).json({ error: 'No active season found' });
    }

    const result = await pool.query(
      `
      SELECT
        p.id AS player_id,
        p.name,
        p.primary_position AS position_code,
        COALESCE(SUM(pgs.home_runs), 0)::integer AS total_hrs,
        cr.manager_name
      FROM players p
      JOIN player_game_stats pgs ON pgs.player_id = p.id
        AND pgs.date >= $1
        AND pgs.date <= $2
      LEFT JOIN LATERAL (
        SELECT t.manager_name
        FROM team_rosters tr
        JOIN teams t ON t.id = tr.team_id
        WHERE tr.player_id = p.id
          AND t.season_id = $3
          AND tr.effective_date <= CURRENT_DATE
          AND tr.end_date IS NULL
        ORDER BY tr.effective_date DESC
        LIMIT 1
      ) cr ON true
      WHERE p.primary_position = ANY($4::text[])
      GROUP BY p.id, p.name, p.primary_position, cr.manager_name
      `,
      [
        formatDate(season.start_date),
        formatDate(season.end_date),
        season.id,
        Object.keys(POSITION_LABELS),
      ]
    );

    const sortFn = (a, b) => b.total_hrs - a.total_hrs || a.name.localeCompare(b.name);
    const players = result.rows.map(({ position_code, ...row }) => ({
      ...row,
      primary_position: POSITION_LABELS[position_code],
    }));

    const byPosition = {};
    for (const pos of TAB_POSITIONS) byPosition[pos] = [];
    for (const player of players) {
      const tabs = player.primary_position === 'OF'
        ? ['LF', 'CF', 'RF']
        : [player.primary_position];
      for (const tab of tabs) {
        if (byPosition[tab]) byPosition[tab].push(player);
      }
    }
    for (const pos of TAB_POSITIONS) {
      byPosition[pos] = byPosition[pos]
        .sort(sortFn)
        .slice(0, TOP_N)
        .map((row, i) => ({ ...row, pos_rank: i + 1 }));
    }

    const all = players
      .slice()
      .sort(sortFn)
      .slice(0, TOP_N)
      .map((row, i) => ({ ...row, pos_rank: i + 1 }));

    res.json({
      season_year: season.season_year,
      // Full labeled list — the frontend buckets/filters/ranks from this.
      players: players.slice().sort(sortFn),
      // Legacy pre-bucketed shape, kept so an older deployed frontend
      // keeps rendering during a backend-first deploy.
      positions: byPosition,
      all,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
