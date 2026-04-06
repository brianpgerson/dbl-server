// Shared queries used by both evaluators and titles.

async function teamsInSeason(pool, seasonId) {
  const r = await pool.query('SELECT id FROM teams WHERE season_id = $1', [seasonId]);
  return r.rows.map(row => row.id);
}

// Cumulative HR totals per team as of a date.
async function standings(pool, seasonId, asOfDate) {
  const r = await pool.query(
    `SELECT t.id as team_id,
            COALESCE(COUNT(s.id), 0)::int as total,
            RANK() OVER (ORDER BY COUNT(s.id) DESC)::int as rank
     FROM teams t
     LEFT JOIN scores s ON s.team_id = t.id AND s.date <= $2
     WHERE t.season_id = $1
     GROUP BY t.id
     ORDER BY total DESC, t.id`,
    [seasonId, asOfDate]
  );
  return r.rows;
}

// Per-team HR count for a single date.
async function dailyTotals(pool, seasonId, date) {
  const r = await pool.query(
    `SELECT t.id as team_id, COALESCE(COUNT(s.id), 0)::int as count
     FROM teams t
     LEFT JOIN scores s ON s.team_id = t.id AND s.date = $2
     WHERE t.season_id = $1
     GROUP BY t.id`,
    [seasonId, date]
  );
  const map = {};
  r.rows.forEach(row => { map[row.team_id] = row.count; });
  return map;
}

// Per-player scoring HR totals (starters only — derived from scores via roster join).
async function playerHrsByTeam(pool, seasonId, asOfDate) {
  const r = await pool.query(
    `SELECT tr.team_id, tr.player_id, p.name as player_name,
            SUM(pgs.home_runs)::int as hrs
     FROM player_game_stats pgs
     JOIN team_rosters tr ON tr.player_id = pgs.player_id
       AND tr.effective_date <= pgs.date
       AND (tr.end_date IS NULL OR tr.end_date > pgs.date)
       AND tr.status = 'STARTER'
     JOIN teams t ON tr.team_id = t.id AND t.season_id = $1
     JOIN players p ON p.id = tr.player_id
     WHERE pgs.date <= $2
     GROUP BY tr.team_id, tr.player_id, p.name`,
    [seasonId, asOfDate]
  );
  return r.rows;
}

// Per-player HR totals while on a team's BENCH (does not score, but we track for bench_genius).
async function benchHrsByTeam(pool, seasonId, asOfDate) {
  const r = await pool.query(
    `SELECT tr.team_id, tr.player_id, p.name as player_name,
            SUM(pgs.home_runs)::int as hrs
     FROM player_game_stats pgs
     JOIN team_rosters tr ON tr.player_id = pgs.player_id
       AND tr.effective_date <= pgs.date
       AND (tr.end_date IS NULL OR tr.end_date > pgs.date)
       AND tr.status = 'BENCH'
     JOIN teams t ON tr.team_id = t.id AND t.season_id = $1
     JOIN players p ON p.id = tr.player_id
     WHERE pgs.date <= $2
     GROUP BY tr.team_id, tr.player_id, p.name`,
    [seasonId, asOfDate]
  );
  return r.rows;
}

// HRs by position per team.
async function positionHrsByTeam(pool, seasonId, asOfDate, positions) {
  const r = await pool.query(
    `SELECT team_id, COUNT(*)::int as hrs
     FROM scores s
     JOIN teams t ON s.team_id = t.id
     WHERE t.season_id = $1 AND s.date <= $2 AND s.position = ANY($3)
     GROUP BY team_id
     ORDER BY hrs DESC, team_id`,
    [seasonId, asOfDate, positions]
  );
  return r.rows;
}

async function seasonStartDate(pool, seasonId) {
  const r = await pool.query('SELECT start_date FROM seasons WHERE id = $1', [seasonId]);
  return dateStr(r.rows[0].start_date);
}

function dateStr(d) {
  return d instanceof Date ? d.toISOString().split('T')[0] : d;
}

function addDays(dateString, n) {
  const d = new Date(dateString);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}

module.exports = {
  teamsInSeason,
  standings,
  dailyTotals,
  playerHrsByTeam,
  benchHrsByTeam,
  positionHrsByTeam,
  seasonStartDate,
  dateStr,
  addDays,
};
