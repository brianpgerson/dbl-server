const { evaluators } = require('../badges/evaluators');
const { computeTitles, diffTitles } = require('../badges/titles');
const { byKey } = require('../badges/definitions');
const { addDays, dateStr } = require('../badges/queries');

async function emitFeed(pool, seasonId, teamId, eventType, eventDate, payload) {
  await pool.query(
    'INSERT INTO feed_events (season_id, team_id, event_type, event_date, payload) VALUES ($1, $2, $3, $4, $5)',
    [seasonId, teamId, eventType, eventDate, JSON.stringify(payload)]
  );
}

// Run all achievement evaluators for a single date, persist new awards, emit feed events.
async function evaluateBadges(pool, seasonId, asOfDate) {
  const date = dateStr(asOfDate);
  let awarded = 0;

  // For non-repeatable achievements, skip teams that already have the badge on any prior date.
  const alreadyAwarded = await pool.query(
    `SELECT badge_key, team_id FROM badge_awards WHERE season_id = $1`,
    [seasonId]
  );
  const have = new Set(alreadyAwarded.rows.map(r => `${r.badge_key}:${r.team_id}`));

  for (const [key, evalFn] of Object.entries(evaluators)) {
    const def = byKey[key];
    let results;
    try {
      results = await evalFn(pool, seasonId, date);
    } catch (err) {
      console.error(`[badges] evaluator ${key} failed for ${date}:`, err.message);
      continue;
    }
    for (const { team_id, context } of results) {
      if (!def?.repeatable && have.has(`${key}:${team_id}`)) continue;
      const r = await pool.query(
        `INSERT INTO badge_awards (season_id, team_id, badge_key, awarded_date, context)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (season_id, team_id, badge_key, awarded_date) DO NOTHING
         RETURNING id`,
        [seasonId, team_id, key, date, JSON.stringify(context || {})]
      );
      if (r.rows.length > 0) {
        have.add(`${key}:${team_id}`);
        awarded++;
        await emitFeed(pool, seasonId, team_id, 'badge', date, {
          badge_key: key,
          badge_name: def?.name || key,
          tier: def?.tier,
          context: context || {},
        });
      }
    }
  }

  // Titles: diff today's holders vs yesterday's, emit handoff events.
  // Re-runs for the same date would otherwise duplicate — clear this date's first.
  await pool.query(
    `DELETE FROM feed_events WHERE season_id = $1 AND event_type = 'title_change' AND event_date = $2`,
    [seasonId, date]
  );
  const teamNames = await pool.query(
    'SELECT id, manager_name FROM teams WHERE season_id = $1', [seasonId]
  );
  const nameById = Object.fromEntries(teamNames.rows.map(r => [r.id, r.manager_name]));
  const curr = await computeTitles(pool, seasonId, date);
  const prev = await computeTitles(pool, seasonId, addDays(date, -1));
  const changes = diffTitles(prev, curr);
  for (const c of changes) {
    const def = byKey[c.badge_key];
    await emitFeed(pool, seasonId, c.team_id, 'title_change', date, {
      badge_key: c.badge_key,
      badge_name: def?.name || c.badge_key,
      tier: def?.tier,
      kind: c.kind,
      prev_team_id: c.prev_team_id,
      prev_manager_name: c.prev_team_id ? nameById[c.prev_team_id] : null,
      context: c.context,
    });
  }

  return { awarded, title_changes: changes.length };
}

// Run evaluateBadges for every date from season.start_date through today (or provided end).
async function backfillBadges(pool, seasonId, endDate) {
  const season = await pool.query('SELECT start_date, end_date FROM seasons WHERE id = $1', [seasonId]);
  if (season.rows.length === 0) throw new Error(`Season ${seasonId} not found`);
  const start = dateStr(season.rows[0].start_date);
  const today = new Date().toISOString().split('T')[0];
  const end = endDate || (today < dateStr(season.rows[0].end_date) ? today : dateStr(season.rows[0].end_date));

  let d = start;
  let totalAwarded = 0;
  while (d <= end) {
    const { awarded } = await evaluateBadges(pool, seasonId, d);
    totalAwarded += awarded;
    d = addDays(d, 1);
  }
  console.log(`[badges] backfill ${seasonId}: ${start}..${end}, ${totalAwarded} awards`);
  return { totalAwarded };
}

module.exports = { evaluateBadges, backfillBadges, emitFeed };
