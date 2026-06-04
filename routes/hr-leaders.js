const express = require('express');
const { getActiveSeason } = require('../helpers/league');

const router = express.Router();

const VALID_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'RF', 'CF', 'DH'];
const TOP_N = 15;

// GET /api/hr-leaders
// Returns top 15 HR leaders per position (plus ALL) for the active season.
// HR totals are real MLB stats from player_game_stats, not league-scored HRs.
// manager_name is populated if the player is currently rostered on a team this season.
router.get('/', async (req, res) => {
  const pool = req.app.get('pool');

  try {
    const season = await getActiveSeason(pool);
    if (!season) {
      return res.status(404).json({ error: 'No active season found' });
    }

    const today = new Date().toISOString().split('T')[0];
    const seasonEnd = season.end_date instanceof Date
      ? season.end_date.toISOString().split('T')[0]
      : String(season.end_date).split('T')[0];
    const effectiveEnd = today < seasonEnd ? today : seasonEnd;

    const result = await pool.query(
      `
      WITH season_hrs AS (
        SELECT
          p.id          AS player_id,
          p.name,
          p.primary_position,
          COALESCE(SUM(pgs.home_runs), 0)::integer AS total_hrs
        FROM players p
        JOIN player_game_stats pgs ON pgs.player_id = p.id
          AND pgs.date >= $1
          AND pgs.date <= $2
        WHERE p.status = 'Active'
          AND p.primary_position = ANY($3::text[])
        GROUP BY p.id, p.name, p.primary_position
        HAVING SUM(pgs.home_runs) > 0
      ),
      current_roster AS (
        SELECT DISTINCT ON (tr.player_id)
          tr.player_id,
          t.manager_name
        FROM team_rosters tr
        JOIN teams t ON t.id = tr.team_id
        WHERE t.season_id = $4
          AND tr.end_date IS NULL
        ORDER BY tr.player_id, tr.effective_date DESC
      ),
      ranked AS (
        SELECT
          sh.player_id,
          sh.name,
          sh.primary_position,
          sh.total_hrs,
          cr.manager_name,
          ROW_NUMBER() OVER (
            PARTITION BY sh.primary_position
            ORDER BY sh.total_hrs DESC, sh.name ASC
          ) AS pos_rank
        FROM season_hrs sh
        LEFT JOIN current_roster cr ON cr.player_id = sh.player_id
      )
      SELECT player_id, name, primary_position, total_hrs, manager_name, pos_rank
      FROM ranked
      WHERE pos_rank <= $5
      ORDER BY primary_position, pos_rank
      `,
      [season.start_date, effectiveEnd, VALID_POSITIONS, season.id, TOP_N]
    );

    const byPosition = {};
    for (const pos of VALID_POSITIONS) {
      byPosition[pos] = [];
    }

    for (const row of result.rows) {
      if (byPosition[row.primary_position]) {
        byPosition[row.primary_position].push(row);
      }
    }

    const allPlayers = result.rows
      .slice()
      .sort((a, b) => b.total_hrs - a.total_hrs || a.name.localeCompare(b.name))
      .slice(0, TOP_N)
      .map((row, i) => ({ ...row, pos_rank: i + 1 }));

    res.json({
      season_year: season.season_year,
      positions: byPosition,
      all: allPlayers,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;