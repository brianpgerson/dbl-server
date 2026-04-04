// Title badges — "currently held by" badges that change hands.
// Computed on read rather than stored in badge_awards.

const { standings, positionHrsByTeam, playerHrsByTeam, benchHrsByTeam } = require('./queries');

// Returns the team_id with the highest hrs, or null if no one has scored yet / tie for zero.
function leader(rows) {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => b.hrs - a.hrs);
  if (sorted[0].hrs === 0) return null;
  return sorted[0];
}

async function computeTitles(pool, seasonId, asOfDate) {
  const titles = {};

  // Position leaders
  const c = leader(await positionHrsByTeam(pool, seasonId, asOfDate, ['C']));
  if (c) titles.backstop_bomber = { team_id: c.team_id, context: { hrs: c.hrs } };

  const mi = leader(await positionHrsByTeam(pool, seasonId, asOfDate, ['2B', 'SS']));
  if (mi) titles.middle_infield_mashers = { team_id: mi.team_id, context: { hrs: mi.hrs } };

  const dh = leader(await positionHrsByTeam(pool, seasonId, asOfDate, ['DH']));
  if (dh) titles.designated_dinger = { team_id: dh.team_id, context: { hrs: dh.hrs } };

  // The Reach: fewest HRs from a top-3-round pick, across the league.
  const reach = await pool.query(
    `SELECT dp.team_id, dp.player_id, p.name as player_name, dp.round,
            COALESCE(SUM(pgs.home_runs), 0)::int as hrs
     FROM draft_picks dp
     JOIN drafts d ON dp.draft_id = d.id AND d.season_id = $1
     JOIN players p ON p.id = dp.player_id
     LEFT JOIN player_game_stats pgs ON pgs.player_id = dp.player_id AND pgs.date <= $2
     WHERE dp.round <= 3 AND dp.player_id IS NOT NULL
     GROUP BY dp.team_id, dp.player_id, p.name, dp.round
     ORDER BY hrs ASC, dp.round ASC
     LIMIT 1`,
    [seasonId, asOfDate]
  );
  if (reach.rows.length > 0) {
    const r = reach.rows[0];
    titles.the_reach = { team_id: r.team_id, context: { player_name: r.player_name, round: r.round, hrs: r.hrs } };
  }

  // Carried: 50%+ of a team's total from one player. Can be held by multiple teams.
  const starters = await playerHrsByTeam(pool, seasonId, asOfDate);
  const stand = await standings(pool, seasonId, asOfDate);
  const totalByTeam = Object.fromEntries(stand.map(r => [r.team_id, r.total]));
  const carriedTeams = [];
  for (const row of starters) {
    const total = totalByTeam[row.team_id] || 0;
    if (total >= 10 && row.hrs / total >= 0.5) {
      carriedTeams.push({ team_id: row.team_id, context: { player_name: row.player_name, hrs: row.hrs, total } });
    }
  }
  if (carriedTeams.length > 0) titles.carried = carriedTeams;

  // Bench Genius: a BENCH player's HRs (while benched) exceed every STARTER's HRs on the same team.
  const bench = await benchHrsByTeam(pool, seasonId, asOfDate);
  const maxStarterByTeam = {};
  for (const row of starters) {
    if (!maxStarterByTeam[row.team_id] || row.hrs > maxStarterByTeam[row.team_id]) {
      maxStarterByTeam[row.team_id] = row.hrs;
    }
  }
  const benchGeniusTeams = [];
  for (const row of bench) {
    const maxStarter = maxStarterByTeam[row.team_id] || 0;
    if (row.hrs > maxStarter && row.hrs > 0) {
      benchGeniusTeams.push({ team_id: row.team_id, context: { player_name: row.player_name, bench_hrs: row.hrs, max_starter: maxStarter } });
    }
  }
  if (benchGeniusTeams.length > 0) titles.bench_genius = benchGeniusTeams;

  return titles;
}

// Normalize a title value (single object or array) to an array of {team_id, context}.
function asArray(v) {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

// Returns [{badge_key, team_id, prev_team_id|null, context}] for every handoff.
function diffTitles(prev, curr) {
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(curr || {})]);
  const changes = [];
  for (const key of keys) {
    const prevTeams = new Set(asArray(prev?.[key]).map(e => e.team_id));
    const currArr = asArray(curr?.[key]);
    for (const entry of currArr) {
      if (!prevTeams.has(entry.team_id)) {
        // For single-holder titles, note who lost it
        const prevHolder = asArray(prev?.[key])[0];
        const prev_team_id = (!Array.isArray(prev?.[key]) && prevHolder) ? prevHolder.team_id : null;
        changes.push({ badge_key: key, team_id: entry.team_id, prev_team_id, context: entry.context });
      }
    }
  }
  return changes;
}

module.exports = { computeTitles, diffTitles, asArray };
