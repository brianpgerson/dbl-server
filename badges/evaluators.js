// Achievement evaluators — one per badge_key.
// Each evaluator: async (pool, seasonId, asOfDate) => [{ team_id, context }]
// Returning a team means "award this badge on asOfDate"; the UNIQUE constraint on
// (season_id, team_id, badge_key, awarded_date) makes repeated returns idempotent.

const {
  teamsInSeason, standings, dailyTotals, playerHrsByTeam, addDays,
} = require('./queries');

const STARTER_POSITIONS = ['C', '1B', '2B', 'SS', '3B', 'LF', 'CF', 'RF', 'DH'];

// ---- helpers ----

// Award a threshold milestone on the day a team first crosses it.
// "First crosses" = total >= N AND total(yesterday) < N.
function milestone(threshold) {
  return async (pool, seasonId, asOfDate) => {
    const today = await standings(pool, seasonId, asOfDate);
    const yesterday = await standings(pool, seasonId, addDays(asOfDate, -1));
    const yMap = Object.fromEntries(yesterday.map(r => [r.team_id, r.total]));
    return today
      .filter(r => r.total >= threshold && (yMap[r.team_id] || 0) < threshold)
      .map(r => ({ team_id: r.team_id, context: { total: r.total, threshold } }));
  };
}

// Length of consecutive-day streak ending on asOfDate where cond(count) is true.
async function streakLength(pool, seasonId, teamId, asOfDate, cond, maxLook = 30) {
  let len = 0;
  for (let i = 0; i < maxLook; i++) {
    const d = addDays(asOfDate, -i);
    const day = await dailyTotals(pool, seasonId, d);
    if (cond(day[teamId] || 0)) len++;
    else break;
  }
  return len;
}

// ---- evaluators ----

const evaluators = {
  // Milestones (per-team, awarded on the crossing day)
  double_digits: milestone(10),
  quarter_pounder: milestone(25),
  big_50: milestone(50),
  century_club: milestone(100),
  double_century: milestone(200),

  contributor: async (pool, seasonId, asOfDate) => {
    // Every starting position has ≥1 HR. Award on the day the 9th distinct position scores.
    const r = await pool.query(
      `SELECT team_id, COUNT(DISTINCT position)::int as distinct_positions
       FROM scores s JOIN teams t ON s.team_id = t.id
       WHERE t.season_id = $1 AND s.date <= $2 AND s.position != 'BEN'
       GROUP BY team_id`,
      [seasonId, asOfDate]
    );
    const yr = await pool.query(
      `SELECT team_id, COUNT(DISTINCT position)::int as distinct_positions
       FROM scores s JOIN teams t ON s.team_id = t.id
       WHERE t.season_id = $1 AND s.date <= $2 AND s.position != 'BEN'
       GROUP BY team_id`,
      [seasonId, addDays(asOfDate, -1)]
    );
    const yMap = Object.fromEntries(yr.rows.map(row => [row.team_id, row.distinct_positions]));
    const need = STARTER_POSITIONS.length;
    return r.rows
      .filter(row => row.distinct_positions >= need && (yMap[row.team_id] || 0) < need)
      .map(row => ({ team_id: row.team_id, context: { positions: need } }));
  },

  // ---- single-day ----

  feast: async (pool, seasonId, asOfDate) => {
    const day = await dailyTotals(pool, seasonId, asOfDate);
    return Object.entries(day)
      .filter(([, c]) => c >= 5)
      .map(([team_id, c]) => ({ team_id: parseInt(team_id, 10), context: { count: c } }));
  },

  famine: async (pool, seasonId, asOfDate) => {
    const day = await dailyTotals(pool, seasonId, asOfDate);
    const teams = Object.keys(day);
    const zeros = teams.filter(t => day[t] === 0);
    const scored = teams.filter(t => day[t] > 0);
    // Award only if exactly you are at 0 and everyone else scored (at least one other team must exist)
    if (scored.length === 0) return [];
    return zeros
      .filter(t => scored.length === teams.length - 1) // everyone else scored
      .map(t => ({ team_id: parseInt(t, 10), context: {} }));
  },

  back_to_back_to_back: async (pool, seasonId, asOfDate) => {
    const r = await pool.query(
      `SELECT tr.team_id, p.name as player_name, pgs.home_runs
       FROM player_game_stats pgs
       JOIN team_rosters tr ON tr.player_id = pgs.player_id
         AND tr.effective_date <= pgs.date
         AND (tr.end_date IS NULL OR tr.end_date > pgs.date)
         AND tr.status = 'STARTER'
       JOIN teams t ON tr.team_id = t.id AND t.season_id = $1
       JOIN players p ON p.id = pgs.player_id
       WHERE pgs.date = $2 AND pgs.home_runs >= 3`,
      [seasonId, asOfDate]
    );
    return r.rows.map(row => ({
      team_id: row.team_id,
      context: { player_name: row.player_name, hrs: row.home_runs },
    }));
  },

  the_cycle: async (pool, seasonId, asOfDate) => {
    const r = await pool.query(
      `SELECT team_id, COUNT(DISTINCT position)::int as distinct_positions
       FROM scores s JOIN teams t ON s.team_id = t.id
       WHERE t.season_id = $1 AND s.date = $2 AND s.position != 'BEN'
       GROUP BY team_id`,
      [seasonId, asOfDate]
    );
    const need = STARTER_POSITIONS.length;
    return r.rows
      .filter(row => row.distinct_positions >= need)
      .map(row => ({ team_id: row.team_id, context: {} }));
  },

  // ---- streaks ----
  // Award only on the day the streak hits the threshold (streak == N exactly),
  // so a 10-day run awards once (on day 7), not days 7-10.

  on_fire: async (pool, seasonId, asOfDate) => {
    const teams = await teamsInSeason(pool, seasonId);
    const awards = [];
    for (const teamId of teams) {
      const len = await streakLength(pool, seasonId, teamId, asOfDate, c => c >= 1);
      if (len === 7) awards.push({ team_id: teamId, context: { streak: len } });
    }
    return awards;
  },

  the_drought: async (pool, seasonId, asOfDate) => {
    const teams = await teamsInSeason(pool, seasonId);
    const awards = [];
    for (const teamId of teams) {
      const len = await streakLength(pool, seasonId, teamId, asOfDate, c => c === 0);
      if (len === 5) awards.push({ team_id: teamId, context: { streak: len } });
    }
    return awards;
  },

  heater: async (pool, seasonId, asOfDate) => {
    // LIMITATION: player_game_stats only has rows for games where the player homered
    // (that's all fetch-home-runs records). We can't see 0-HR games, so "4 consecutive
    // games" is approximated as "4 consecutive calendar days with a HR row" — a stricter
    // condition since players don't play every day.
    const r = await pool.query(
      `SELECT tr.team_id, pgs.player_id, p.name as player_name, pgs.date
       FROM player_game_stats pgs
       JOIN team_rosters tr ON tr.player_id = pgs.player_id
         AND tr.effective_date <= pgs.date
         AND (tr.end_date IS NULL OR tr.end_date > pgs.date)
         AND tr.status = 'STARTER'
       JOIN teams t ON tr.team_id = t.id AND t.season_id = $1
       JOIN players p ON p.id = pgs.player_id
       WHERE pgs.date <= $2 AND pgs.date > $2::date - INTERVAL '10 days'
       ORDER BY pgs.player_id, pgs.date`,
      [seasonId, asOfDate]
    );
    const byPlayer = {};
    r.rows.forEach(row => {
      const k = `${row.team_id}:${row.player_id}`;
      if (!byPlayer[k]) byPlayer[k] = { team_id: row.team_id, player_name: row.player_name, dates: [] };
      byPlayer[k].dates.push(row.date.toISOString().split('T')[0]);
    });
    const awards = [];
    for (const k of Object.keys(byPlayer)) {
      const { team_id, player_name, dates } = byPlayer[k];
      // Check if there's a 4-consecutive-day run ending on asOfDate
      const set = new Set(dates);
      const need = [0, 1, 2, 3].map(i => addDays(asOfDate, -i));
      const hit4 = need.every(d => set.has(d));
      const day5 = addDays(asOfDate, -4);
      // Only award on the day the streak hits 4 (not on days 5+)
      if (hit4 && !set.has(day5)) {
        awards.push({ team_id, context: { player_name, streak: 4 } });
      }
    }
    return awards;
  },

  // ---- standings-based ----

  separation: async (pool, seasonId, asOfDate) => {
    const s = await standings(pool, seasonId, asOfDate);
    if (s.length < 2) return [];
    const gap = s[0].total - s[1].total;
    if (gap < 10) return [];
    // Award on the day the gap first reaches 10
    const prev = await standings(pool, seasonId, addDays(asOfDate, -1));
    const prevGap = prev.length >= 2 ? prev[0].total - prev[1].total : 0;
    if (prevGap >= 10) return [];
    return [{ team_id: s[0].team_id, context: { gap, second: s[1].total } }];
  },

  the_climb: async (pool, seasonId, asOfDate) => {
    // Team is top-3 now AND was last place on some prior date this season.
    const s = await standings(pool, seasonId, asOfDate);
    const top3 = s.filter(r => r.rank <= 3);
    const teamCount = s.length;
    const season = await pool.query('SELECT start_date FROM seasons WHERE id = $1', [seasonId]);
    const start = season.rows[0].start_date.toISOString().split('T')[0];
    const awards = [];
    for (const team of top3) {
      // Skip if already awarded (the ON CONFLICT handles the dupe, but avoid the scan)
      let wasLast = false;
      let d = addDays(asOfDate, -1);
      while (d >= start) {
        const hist = await standings(pool, seasonId, d);
        const me = hist.find(r => r.team_id === team.team_id);
        if (me && me.rank === teamCount && me.total > 0) {
          // Only counts as "last" once scoring has actually started (total > 0 somewhere)
          const anyScored = hist.some(r => r.total > 0);
          if (anyScored) { wasLast = true; break; }
        }
        d = addDays(d, -7); // scan weekly to keep it cheap
      }
      if (wasLast) awards.push({ team_id: team.team_id, context: { rank: team.rank } });
    }
    return awards;
  },

  buried: async (pool, seasonId, asOfDate) => {
    // Was 1st within the last 7 days, now 5th or worse.
    const now = await standings(pool, seasonId, asOfDate);
    const weekAgo = await standings(pool, seasonId, addDays(asOfDate, -7));
    // Ignore pre-season all-zeros tie where rank 1 is arbitrary.
    const wasFirst = new Set(
      weekAgo.filter(r => r.rank === 1 && r.total > 0).map(r => r.team_id)
    );
    return now
      .filter(r => r.rank >= 5 && wasFirst.has(r.team_id))
      .map(r => ({ team_id: r.team_id, context: { from: 1, to: r.rank } }));
  },

  // ---- draft hindsight ----

  eleventh_round_hero: async (pool, seasonId, asOfDate) => {
    // Last-round draft pick (round = drafts.rounds) reaches 10+ scoring HRs.
    const r = await pool.query(
      `SELECT dp.team_id, dp.player_id, p.name as player_name,
              COALESCE(SUM(pgs.home_runs), 0)::int as hrs
       FROM draft_picks dp
       JOIN drafts d ON dp.draft_id = d.id AND d.season_id = $1
       JOIN players p ON p.id = dp.player_id
       LEFT JOIN team_rosters tr ON tr.player_id = dp.player_id AND tr.team_id = dp.team_id
         AND tr.status = 'STARTER'
       LEFT JOIN player_game_stats pgs ON pgs.player_id = dp.player_id
         AND pgs.date <= $2
         AND tr.effective_date <= pgs.date
         AND (tr.end_date IS NULL OR tr.end_date > pgs.date)
       WHERE dp.round = d.rounds AND dp.player_id IS NOT NULL
       GROUP BY dp.team_id, dp.player_id, p.name`,
      [seasonId, asOfDate]
    );
    return r.rows
      .filter(row => row.hrs >= 10)
      .map(row => ({ team_id: row.team_id, context: { player_name: row.player_name, hrs: row.hrs } }));
  },

  santander_special: async (pool, seasonId, asOfDate) => {
    // Drafted while not Active (status_at_pick captured at draft time), now has 5+ HRs this season.
    const r = await pool.query(
      `SELECT dp.team_id, p.name as player_name, dp.status_at_pick,
              COALESCE(SUM(pgs.home_runs), 0)::int as hrs
       FROM draft_picks dp
       JOIN drafts d ON dp.draft_id = d.id AND d.season_id = $1
       JOIN seasons se ON se.id = d.season_id
       JOIN players p ON p.id = dp.player_id
       LEFT JOIN player_game_stats pgs ON pgs.player_id = dp.player_id
         AND pgs.date >= se.start_date AND pgs.date <= $2
       WHERE dp.status_at_pick IS NOT NULL AND dp.status_at_pick != 'Active'
       GROUP BY dp.team_id, p.name, dp.status_at_pick
       HAVING COALESCE(SUM(pgs.home_runs), 0) >= 5`,
      [seasonId, asOfDate]
    );
    return r.rows.map(row => ({
      team_id: row.team_id,
      context: { player_name: row.player_name, drafted_as: row.status_at_pick, hrs: row.hrs },
    }));
  },

  // ---- date-gated / endgame ----

  dead_weight: async (pool, seasonId, asOfDate) => {
    // Only fires on or after June 1 of the season year.
    const season = await pool.query('SELECT season_year FROM seasons WHERE id = $1', [seasonId]);
    const gate = `${season.rows[0].season_year}-06-01`;
    if (asOfDate < gate) return [];
    // Any current STARTER roster slot with zero scores.
    const r = await pool.query(
      `SELECT tr.team_id, p.name as player_name, tr.position
       FROM team_rosters tr
       JOIN teams t ON tr.team_id = t.id AND t.season_id = $1
       JOIN players p ON p.id = tr.player_id
       WHERE tr.status = 'STARTER'
         AND tr.effective_date <= $2
         AND (tr.end_date IS NULL OR tr.end_date > $2)
         AND NOT EXISTS (
           SELECT 1 FROM scores s
           WHERE s.team_id = tr.team_id AND s.position = tr.position AND s.date <= $2
         )`,
      [seasonId, asOfDate]
    );
    // One award per team (context names the first offending slot)
    const seen = new Set();
    const awards = [];
    for (const row of r.rows) {
      if (seen.has(row.team_id)) continue;
      seen.add(row.team_id);
      awards.push({ team_id: row.team_id, context: { player_name: row.player_name, position: row.position } });
    }
    return awards;
  },

  participation_trophy: async (pool, seasonId, asOfDate) => {
    // Heuristic: mathematically eliminated if (leader - you) > days_remaining * 4.
    // 4 ≈ generous upper bound on daily team HRs. Not exact, but close enough for shame.
    const season = await pool.query('SELECT end_date FROM seasons WHERE id = $1', [seasonId]);
    const end = season.rows[0].end_date.toISOString().split('T')[0];
    const daysRemaining = Math.max(0, Math.floor((new Date(end) - new Date(asOfDate)) / 86400000));
    const s = await standings(pool, seasonId, asOfDate);
    if (s.length === 0) return [];
    const leader = s[0].total;
    return s
      .filter(r => (leader - r.total) > daysRemaining * 4 && r.rank > 1)
      .map(r => ({ team_id: r.team_id, context: { deficit: leader - r.total, days_remaining: daysRemaining } }));
  },
};

module.exports = { evaluators, STARTER_POSITIONS };
