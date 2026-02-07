const express = require('express');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// ============================================================================
// PUBLIC: Draft board (anyone can view)
// ============================================================================

// Get draft status and board for a league
router.get('/league/:leagueId', async (req, res) => {
  const pool = req.app.get('pool');
  try {
    const draftResult = await pool.query(
      'SELECT * FROM drafts WHERE league_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.params.leagueId]
    );

    if (draftResult.rows.length === 0) {
      return res.json({ draft: null });
    }

    const draft = draftResult.rows[0];

    // Get draft order
    const orderResult = await pool.query(`
      SELECT do.order_position, do.team_id, t.name as team_name, t.manager_name
      FROM draft_order do
      JOIN teams t ON do.team_id = t.id
      WHERE do.draft_id = $1
      ORDER BY do.order_position
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

// ============================================================================
// COMMISSIONER: Draft management
// ============================================================================

// Create a new draft
router.post('/', authenticateToken, async (req, res) => {
  const pool = req.app.get('pool');
  const { league_id, draft_type, rounds } = req.body;

  if (!league_id) {
    return res.status(400).json({ error: 'league_id required' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO drafts (league_id, draft_type, rounds) VALUES ($1, $2, $3) RETURNING *',
      [league_id, draft_type || 'snake', rounds || 11]
    );
    res.json({ success: true, draft: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Set draft order
router.post('/:draftId/order', authenticateToken, async (req, res) => {
  const pool = req.app.get('pool');
  const { order } = req.body; // Array of { team_id, order_position }

  if (!order || !Array.isArray(order) || order.length === 0) {
    return res.status(400).json({ error: 'order array required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const draftId = req.params.draftId;

    // Get draft info
    const draftResult = await client.query('SELECT * FROM drafts WHERE id = $1', [draftId]);
    if (draftResult.rows.length === 0) {
      throw new Error('Draft not found');
    }
    const draft = draftResult.rows[0];

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
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Start the draft
router.post('/:draftId/start', authenticateToken, async (req, res) => {
  const pool = req.app.get('pool');
  try {
    const result = await pool.query(
      "UPDATE drafts SET status = 'active', current_pick = 1, updated_at = NOW() WHERE id = $1 RETURNING *",
      [req.params.draftId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Draft not found' });
    }
    res.json({ success: true, draft: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Make a pick (commissioner inputs a draft selection)
router.post('/:draftId/pick', authenticateToken, async (req, res) => {
  const pool = req.app.get('pool');
  const { player_id, position } = req.body;

  if (!player_id || !position) {
    return res.status(400).json({ error: 'player_id and position required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const draftId = req.params.draftId;

    // Get draft
    const draftResult = await client.query('SELECT * FROM drafts WHERE id = $1', [draftId]);
    if (draftResult.rows.length === 0) throw new Error('Draft not found');
    const draft = draftResult.rows[0];

    if (draft.status !== 'active') {
      throw new Error('Draft is not active');
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

    // Record the pick
    await client.query(
      'UPDATE draft_picks SET player_id = $1, position = $2, picked_at = NOW() WHERE id = $3',
      [player_id, position, pickSlot.id]
    );

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

    await client.query('COMMIT');

    // Get player name for response
    const playerResult = await pool.query('SELECT name FROM players WHERE id = $1', [player_id]);

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
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Undo the last pick
router.post('/:draftId/undo', authenticateToken, async (req, res) => {
  const pool = req.app.get('pool');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const draftId = req.params.draftId;
    const draftResult = await client.query('SELECT * FROM drafts WHERE id = $1', [draftId]);
    if (draftResult.rows.length === 0) throw new Error('Draft not found');
    const draft = draftResult.rows[0];

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
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Get available players (not yet drafted in this draft)
router.get('/:draftId/available', async (req, res) => {
  const pool = req.app.get('pool');
  const { q, position } = req.query;

  try {
    let query = `
      SELECT p.id, p.name, p.primary_position, p.current_mlb_team_id, p.status
      FROM players p
      WHERE p.id NOT IN (
        SELECT player_id FROM draft_picks WHERE draft_id = $1 AND player_id IS NOT NULL
      )
    `;
    const params = [req.params.draftId];

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

module.exports = router;
