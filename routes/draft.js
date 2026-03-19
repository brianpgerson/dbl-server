const express = require('express');
const { authenticateToken, requireCommissioner, assertCommissionerOfSeason } = require('../middleware/auth');

const router = express.Router();

// Load draft with FOR UPDATE lock, assert caller is commissioner of its league.
// Must be called inside a transaction.
async function loadDraftForUpdate(client, req, draftId) {
  const r = await client.query('SELECT * FROM drafts WHERE id = $1 FOR UPDATE', [draftId]);
  if (r.rows.length === 0) {
    const err = new Error('Draft not found');
    err.status = 404;
    throw err;
  }
  const draft = r.rows[0];
  await assertCommissionerOfSeason(client, req, draft.season_id);
  return draft;
}

// ============================================================================
// PUBLIC: Draft board (anyone can view)
// ============================================================================

// Get draft status and board for a league
router.get('/season/:seasonId', async (req, res) => {
  const pool = req.app.get('pool');
  try {
    const draftResult = await pool.query(
      'SELECT * FROM drafts WHERE season_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.params.seasonId]
    );

    if (draftResult.rows.length === 0) {
      return res.json({ draft: null });
    }

    const draft = draftResult.rows[0];

    // Get draft order
    const orderResult = await pool.query(`
      SELECT dro.order_position, dro.team_id, t.name as team_name, t.manager_name
      FROM draft_order dro
      JOIN teams t ON dro.team_id = t.id
      WHERE dro.draft_id = $1
      ORDER BY dro.order_position
    `, [draft.id]);

    // Get all picks (made and pending)
    const picksResult = await pool.query(`
      SELECT dp.pick_number, dp.round, dp.team_id, dp.player_id, dp.position, dp.picked_at,
             t.name as team_name, t.manager_name,
             p.name as player_name, p.primary_position
      FROM draft_picks dp
      JOIN teams t ON dp.team_id = t.id
      LEFT JOIN players p ON dp.player_id = p.id
      WHERE dp.draft_id = $1
      ORDER BY dp.pick_number
    `, [draft.id]);

    // Figure out who is on the clock
    const currentPick = picksResult.rows.find(p => p.player_id === null);

    res.json({
      draft: {
        id: draft.id,
        status: draft.status,
        draft_type: draft.draft_type,
        rounds: draft.rounds,
        current_pick: draft.current_pick,
        total_picks: picksResult.rows.length
      },
      order: orderResult.rows,
      picks: picksResult.rows,
      on_the_clock: currentPick ? {
        pick_number: currentPick.pick_number,
        round: currentPick.round,
        team_name: currentPick.team_name,
        manager_name: currentPick.manager_name,
        team_id: currentPick.team_id
      } : null
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get filled positions for a team
router.get('/:draftId/filled-positions/:teamId', async (req, res) => {
  const pool = req.app.get('pool');
  try {
    const result = await pool.query(
      'SELECT position FROM draft_picks WHERE draft_id = $1 AND team_id = $2 AND player_id IS NOT NULL',
      [req.params.draftId, req.params.teamId]
    );
    res.json(result.rows.map(r => r.position));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get available players (not yet drafted in this draft)
router.get('/:draftId/available', async (req, res) => {
  const pool = req.app.get('pool');
  const { q, position, active_only } = req.query;

  try {
    let query = `
      SELECT p.id, p.name, p.primary_position, p.current_mlb_team_id, p.status
      FROM players p
      WHERE p.id NOT IN (
        SELECT player_id FROM draft_picks WHERE draft_id = $1 AND player_id IS NOT NULL
      )
    `;
    const params = [req.params.draftId];

    if (active_only !== 'false') {
      query += ` AND p.status = 'Active'`;
    }

    if (q && q.length >= 2) {
      params.push(`%${q}%`);
      query += ` AND p.name ILIKE $${params.length}`;
    }

    if (position) {
      params.push(position);
      query += ` AND p.primary_position = $${params.length}`;
    }

    query += ` ORDER BY p.name LIMIT 50`;

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ============================================================================
// COMMISSIONER: Draft management
// ============================================================================

router.use(authenticateToken, requireCommissioner);

// Create a new draft
router.post('/', async (req, res) => {
  const pool = req.app.get('pool');
  const { season_id, draft_type, rounds } = req.body;

  if (!season_id) {
    return res.status(400).json({ error: 'season_id required' });
  }

  try {
    await assertCommissionerOfSeason(pool, req, season_id);

    const existing = await pool.query('SELECT id FROM drafts WHERE season_id = $1', [season_id]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'A draft already exists for this season' });
    }

    const result = await pool.query(
      'INSERT INTO drafts (season_id, draft_type, rounds) VALUES ($1, $2, $3) RETURNING *',
      [season_id, draft_type || 'snake', rounds || 11]
    );
    res.json({ success: true, draft: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A draft already exists for this season' });
    console.error(err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Set draft order
router.post('/:draftId/order', async (req, res) => {
  const pool = req.app.get('pool');
  const { order } = req.body; // Array of { team_id, order_position }

  if (!order || !Array.isArray(order) || order.length === 0) {
    return res.status(400).json({ error: 'order array required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const draftId = req.params.draftId;
    const draft = await loadDraftForUpdate(client, req, draftId);

    if (draft.status !== 'setup') {
      throw new Error('Cannot change draft order after the draft has started');
    }

    // Verify every team in the order belongs to this draft's season,
    // and every team in the season is present (no one left off the clock)
    const teamIds = order.map(e => e.team_id);
    const teamCheck = await client.query(
      'SELECT id FROM teams WHERE season_id = $1',
      [draft.season_id]
    );
    const seasonTeamIds = new Set(teamCheck.rows.map(r => r.id));
    for (const tid of teamIds) {
      if (!seasonTeamIds.has(tid)) {
        throw new Error(`Team ${tid} does not belong to this draft's season`);
      }
    }
    if (teamIds.length !== seasonTeamIds.size) {
      throw new Error(`Draft order must include all ${seasonTeamIds.size} teams in the season (got ${teamIds.length})`);
    }

    // Clear existing order
    await client.query('DELETE FROM draft_order WHERE draft_id = $1', [draftId]);

    // Insert new order
    for (const entry of order) {
      await client.query(
        'INSERT INTO draft_order (draft_id, team_id, order_position) VALUES ($1, $2, $3)',
        [draftId, entry.team_id, entry.order_position]
      );
    }

    // Generate pick slots based on draft type and order
    await client.query('DELETE FROM draft_picks WHERE draft_id = $1', [draftId]);

    const teamCount = order.length;
    let pickNumber = 1;

    for (let round = 1; round <= draft.rounds; round++) {
      // Snake draft: odd rounds go forward, even rounds go backward
      const isReversed = draft.draft_type === 'snake' && round % 2 === 0;
      const sortedOrder = [...order].sort((a, b) =>
        isReversed
          ? b.order_position - a.order_position
          : a.order_position - b.order_position
      );

      for (const entry of sortedOrder) {
        await client.query(
          'INSERT INTO draft_picks (draft_id, pick_number, round, team_id) VALUES ($1, $2, $3, $4)',
          [draftId, pickNumber, round, entry.team_id]
        );
        pickNumber++;
      }
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      total_picks: pickNumber - 1,
      message: `Draft order set with ${teamCount} teams x ${draft.rounds} rounds = ${pickNumber - 1} picks`
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(err.status || 400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Start the draft
router.post('/:draftId/start', async (req, res) => {
  const pool = req.app.get('pool');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const draft = await loadDraftForUpdate(client, req, req.params.draftId);

    if (draft.status !== 'setup') {
      throw new Error(`Draft is already ${draft.status}`);
    }

    const orderCheck = await client.query(
      'SELECT COUNT(*) as c FROM draft_order WHERE draft_id = $1',
      [draft.id]
    );
    if (parseInt(orderCheck.rows[0].c) === 0) {
      throw new Error('Cannot start draft: draft order has not been set');
    }

    const result = await client.query(
      "UPDATE drafts SET status = 'active', current_pick = 1, updated_at = NOW() WHERE id = $1 RETURNING *",
      [draft.id]
    );

    await client.query('COMMIT');
    res.json({ success: true, draft: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(err.status || 400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Make a pick (commissioner inputs a draft selection)
router.post('/:draftId/pick', async (req, res) => {
  const pool = req.app.get('pool');
  const { player_id, position, expected_pick_number } = req.body;

  if (!player_id || !position) {
    return res.status(400).json({ error: 'player_id and position required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const draftId = req.params.draftId;
    const draft = await loadDraftForUpdate(client, req, draftId);

    if (draft.status !== 'active') {
      throw new Error('Draft is not active');
    }

    // If client sent what pick it thinks it's making, verify we agree (catches lost-response retries)
    if (expected_pick_number != null && expected_pick_number !== draft.current_pick) {
      throw new Error(`Draft has moved on — you were making pick #${expected_pick_number} but it's now pick #${draft.current_pick}`);
    }

    // Check if player is already drafted
    const alreadyDrafted = await client.query(
      'SELECT id FROM draft_picks WHERE draft_id = $1 AND player_id = $2',
      [draftId, player_id]
    );
    if (alreadyDrafted.rows.length > 0) {
      throw new Error('Player has already been drafted');
    }

    // Get the current pick slot
    const currentPickResult = await client.query(
      'SELECT * FROM draft_picks WHERE draft_id = $1 AND pick_number = $2',
      [draftId, draft.current_pick]
    );
    if (currentPickResult.rows.length === 0) throw new Error('No pick slot found');
    const pickSlot = currentPickResult.rows[0];

    // Validate position against roster template and this team's fill state
    const templateResult = await client.query(
      'SELECT count FROM roster_templates WHERE season_id = $1 AND position = $2',
      [draft.season_id, position]
    );
    if (templateResult.rows.length === 0) {
      throw new Error(`Position "${position}" is not in this season's roster template`);
    }
    const slotLimit = templateResult.rows[0].count;
    const filledResult = await client.query(
      'SELECT COUNT(*) as c FROM draft_picks WHERE draft_id = $1 AND team_id = $2 AND position = $3 AND player_id IS NOT NULL',
      [draftId, pickSlot.team_id, position]
    );
    if (parseInt(filledResult.rows[0].c) >= slotLimit) {
      throw new Error(`${position} is already filled for this team (${slotLimit}/${slotLimit})`);
    }

    // Record the pick — guard against overwriting a filled slot
    const updateResult = await client.query(
      'UPDATE draft_picks SET player_id = $1, position = $2, picked_at = NOW() WHERE id = $3 AND player_id IS NULL',
      [player_id, position, pickSlot.id]
    );
    if (updateResult.rowCount === 0) {
      throw new Error('Pick slot is already filled — draft state may have drifted');
    }

    // Also create the team_roster entry
    const today = new Date().toISOString().split('T')[0];
    const rosterStatus = position === 'BEN' ? 'BENCH' : 'STARTER';
    await client.query(
      `INSERT INTO team_rosters (team_id, player_id, position, drafted_position, status, reason, effective_date)
       VALUES ($1, $2, $3, $3, $4, 'DRAFTED', $5)`,
      [pickSlot.team_id, player_id, position, rosterStatus, today]
    );

    // Advance current pick
    const nextPick = draft.current_pick + 1;
    const totalPicks = await client.query(
      'SELECT COUNT(*) as count FROM draft_picks WHERE draft_id = $1',
      [draftId]
    );

    if (nextPick > parseInt(totalPicks.rows[0].count, 10)) {
      // Draft is complete
      await client.query(
        "UPDATE drafts SET status = 'complete', current_pick = $1, updated_at = NOW() WHERE id = $2",
        [draft.current_pick, draftId]
      );
    } else {
      await client.query(
        'UPDATE drafts SET current_pick = $1, updated_at = NOW() WHERE id = $2',
        [nextPick, draftId]
      );
    }

    const playerResult = await client.query('SELECT name FROM players WHERE id = $1', [player_id]);

    await client.query('COMMIT');

    res.json({
      success: true,
      pick: {
        pick_number: pickSlot.pick_number,
        round: pickSlot.round,
        player_name: playerResult.rows[0]?.name,
        position: position,
        team_id: pickSlot.team_id
      },
      draft_complete: nextPick > parseInt(totalPicks.rows[0].count, 10)
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(err.status || 400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Undo the last pick
router.post('/:draftId/undo', async (req, res) => {
  const pool = req.app.get('pool');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const draftId = req.params.draftId;
    await loadDraftForUpdate(client, req, draftId);

    // Find the last made pick
    const lastPickResult = await client.query(
      'SELECT * FROM draft_picks WHERE draft_id = $1 AND player_id IS NOT NULL ORDER BY pick_number DESC LIMIT 1',
      [draftId]
    );

    if (lastPickResult.rows.length === 0) {
      throw new Error('No picks to undo');
    }

    const lastPick = lastPickResult.rows[0];

    // Remove the roster entry
    await client.query(
      "DELETE FROM team_rosters WHERE team_id = $1 AND player_id = $2 AND reason = 'DRAFTED'",
      [lastPick.team_id, lastPick.player_id]
    );

    // Clear the pick
    await client.query(
      'UPDATE draft_picks SET player_id = NULL, position = NULL, picked_at = NULL WHERE id = $1',
      [lastPick.id]
    );

    // Set current pick back
    await client.query(
      "UPDATE drafts SET current_pick = $1, status = 'active', updated_at = NOW() WHERE id = $2",
      [lastPick.pick_number, draftId]
    );

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `Undid pick #${lastPick.pick_number}`,
      current_pick: lastPick.pick_number
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(err.status || 400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Edit an existing pick (change position and/or player)
router.put('/:draftId/pick/:pickNumber', async (req, res) => {
  const pool = req.app.get('pool');
  const { position, player_id } = req.body;

  if (!position && !player_id) {
    return res.status(400).json({ error: 'position or player_id required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const draftId = req.params.draftId;
    const pickNumber = req.params.pickNumber;
    const draft = await loadDraftForUpdate(client, req, draftId);

    const pickResult = await client.query(
      'SELECT * FROM draft_picks WHERE draft_id = $1 AND pick_number = $2',
      [draftId, pickNumber]
    );
    if (pickResult.rows.length === 0) throw new Error('Pick not found');
    const pick = pickResult.rows[0];
    if (!pick.player_id) throw new Error('Cannot edit an empty pick');

    const newPosition = position || pick.position;
    const newPlayerId = player_id || pick.player_id;

    // If changing player, check the new player isn't already drafted
    if (player_id && player_id !== pick.player_id) {
      const alreadyDrafted = await client.query(
        'SELECT id FROM draft_picks WHERE draft_id = $1 AND player_id = $2',
        [draftId, player_id]
      );
      if (alreadyDrafted.rows.length > 0) {
        throw new Error('That player has already been drafted');
      }
    }

    // If changing position, validate against template and fill state (excluding this pick)
    if (newPosition !== pick.position) {
      const templateResult = await client.query(
        'SELECT count FROM roster_templates WHERE season_id = $1 AND position = $2',
        [draft.season_id, newPosition]
      );
      if (templateResult.rows.length === 0) {
        throw new Error(`Position "${newPosition}" is not in this season's roster template`);
      }
      const slotLimit = templateResult.rows[0].count;
      const filledResult = await client.query(
        'SELECT COUNT(*) as c FROM draft_picks WHERE draft_id = $1 AND team_id = $2 AND position = $3 AND player_id IS NOT NULL AND id != $4',
        [draftId, pick.team_id, newPosition, pick.id]
      );
      if (parseInt(filledResult.rows[0].c) >= slotLimit) {
        throw new Error(`${newPosition} is already filled for this team (${slotLimit}/${slotLimit})`);
      }
    }

    // Update the draft pick
    await client.query(
      'UPDATE draft_picks SET position = $1, player_id = $2 WHERE id = $3',
      [newPosition, newPlayerId, pick.id]
    );

    // Update the roster entry — remove old, add new
    await client.query(
      "DELETE FROM team_rosters WHERE team_id = $1 AND player_id = $2 AND reason = 'DRAFTED'",
      [pick.team_id, pick.player_id]
    );
    const rosterStatus = newPosition === 'BEN' ? 'BENCH' : 'STARTER';
    const today = new Date().toISOString().split('T')[0];
    await client.query(
      `INSERT INTO team_rosters (team_id, player_id, position, drafted_position, status, reason, effective_date)
       VALUES ($1, $2, $3, $3, $4, 'DRAFTED', $5)`,
      [pick.team_id, newPlayerId, newPosition, rosterStatus, today]
    );

    const playerResult = await client.query('SELECT name FROM players WHERE id = $1', [newPlayerId]);
    const oldPlayerResult = player_id && player_id !== pick.player_id
      ? await client.query('SELECT name FROM players WHERE id = $1', [pick.player_id])
      : null;

    await client.query('COMMIT');

    let message = '';
    if (oldPlayerResult) {
      message = `Pick #${pickNumber}: ${oldPlayerResult.rows[0]?.name} → ${playerResult.rows[0]?.name} (${newPosition})`;
    } else {
      message = `${playerResult.rows[0]?.name}: ${pick.position} → ${newPosition}`;
    }

    res.json({ success: true, message, pick: { pick_number: parseInt(pickNumber, 10), position: newPosition } });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(err.status || 400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Cancel/delete a draft entirely (reset to pre-draft state)
router.delete('/:draftId', async (req, res) => {
  const pool = req.app.get('pool');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const draftId = req.params.draftId;
    await loadDraftForUpdate(client, req, draftId);

    // Remove roster entries created by this draft — match both team and player
    // so we don't nuke the same player's DRAFTED rows from other seasons
    await client.query(
      `DELETE FROM team_rosters tr
       USING draft_picks dp
       WHERE dp.draft_id = $1
         AND dp.player_id IS NOT NULL
         AND tr.team_id = dp.team_id
         AND tr.player_id = dp.player_id
         AND tr.reason = 'DRAFTED'`,
      [draftId]
    );

    // Delete picks and order
    await client.query('DELETE FROM draft_picks WHERE draft_id = $1', [draftId]);
    await client.query('DELETE FROM draft_order WHERE draft_id = $1', [draftId]);
    await client.query('DELETE FROM drafts WHERE id = $1', [draftId]);

    await client.query('COMMIT');
    res.json({ success: true, message: 'Draft cancelled and reset' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Trigger manual HR sync
router.post('/sync-hrs', async (req, res) => {
  try {
    const fetchHomeRuns = require('../scripts/fetch-home-runs');
    const { getActiveLeague, formatDate } = require('../helpers/league');
    const pool = req.app.get('pool');
    const league = await getActiveLeague(pool);
    if (!league) return res.status(404).json({ error: 'No active league' });

    const todayStr = new Date().toISOString().split('T')[0];
    const leagueStart = formatDate(league.start_date);
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const startDate = threeDaysAgo.toISOString().split('T')[0] < leagueStart ? leagueStart : threeDaysAgo.toISOString().split('T')[0];

    await fetchHomeRuns(startDate, todayStr);
    res.json({ success: true, message: `HR sync complete (${startDate} to ${todayStr})` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
