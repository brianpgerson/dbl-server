const express = require('express');
const axios = require('axios');
const { authenticateToken, requireTeamAccess } = require('../middleware/auth');

const router = express.Router();

// Get current roster for a team
router.get('/:teamId', async (req, res) => {
  const pool = req.app.get('pool');
  try {
    const query = `
      SELECT
        p.id as player_id, p.name, p.primary_position, p.mlb_id,
        tr.position, tr.drafted_position, tr.status as roster_status, tr.reason,
        p.status as player_status
      FROM team_rosters tr
      JOIN players p ON tr.player_id = p.id
      WHERE tr.team_id = $1
      AND tr.end_date IS NULL
      ORDER BY
        CASE tr.position
          WHEN 'BEN' THEN 'ZZZ'
          ELSE tr.position
        END
    `;
    const result = await pool.query(query, [req.params.teamId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Make a roster move (bench/activate player)
router.post('/move', authenticateToken, async (req, res) => {
  const pool = req.app.get('pool');
  const { teamId, playerId, newPosition, reason, effectiveDate } = req.body;

  if (!teamId || !playerId || !newPosition || !effectiveDate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const playerQuery = `
      SELECT position, drafted_position, status FROM team_rosters
      WHERE team_id = $1 AND player_id = $2 AND end_date IS NULL
    `;
    const playerResult = await client.query(playerQuery, [teamId, playerId]);
    if (playerResult.rows.length === 0) {
      throw new Error('Player not found on team');
    }

    const player = playerResult.rows[0];

    if (newPosition === 'BEN') {
      await client.query(
        `UPDATE team_rosters SET end_date = $1
         WHERE team_id = $2 AND player_id = $3 AND end_date IS NULL`,
        [effectiveDate, teamId, playerId]
      );
      await client.query(
        `INSERT INTO team_rosters (team_id, player_id, position, drafted_position, status, reason, effective_date)
         VALUES ($1, $2, 'BEN', $3, 'BENCH', $4, $5)`,
        [teamId, playerId, player.drafted_position, reason || 'Injury', effectiveDate]
      );
    } else {
      if (player.drafted_position !== newPosition && player.drafted_position !== 'BEN') {
        throw new Error('Players can only return to their drafted position');
      }

      const occupiedCheck = await client.query(
        `SELECT player_id FROM team_rosters WHERE team_id = $1 AND position = $2 AND status = 'STARTER' AND end_date IS NULL`,
        [teamId, newPosition]
      );

      if (occupiedCheck.rows.length > 0) {
        throw new Error('Position is already occupied by another player');
      }

      await client.query(
        `UPDATE team_rosters SET end_date = $1
         WHERE team_id = $2 AND player_id = $3 AND end_date IS NULL`,
        [effectiveDate, teamId, playerId]
      );
      await client.query(
        `INSERT INTO team_rosters (team_id, player_id, position, drafted_position, status, reason, effective_date)
         VALUES ($1, $2, $3, $4, 'STARTER', NULL, $5)`,
        [teamId, playerId, newPosition, player.drafted_position, effectiveDate]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, message: 'Roster move completed' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Swap two players' positions
router.post('/swap', authenticateToken, async (req, res) => {
  const pool = req.app.get('pool');
  const { teamId, player1Id, player2Id, reason, effectiveDate } = req.body;

  if (!teamId || !player1Id || !player2Id) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (effectiveDate && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    return res.status(400).json({ error: 'effectiveDate must be in YYYY-MM-DD format' });
  }

  const team = parseInt(teamId, 10);
  const p1 = parseInt(player1Id, 10);
  const p2 = parseInt(player2Id, 10);

  // Check authorization
  const canManageTeam = req.user.teamIds.includes(team);
  let canCommissionTeam = false;
  if (!canManageTeam && req.user.commissionerLeagueIds && req.user.commissionerLeagueIds.length > 0) {
    const teamLeagueResult = await pool.query(
      'SELECT s.league_id FROM teams t JOIN seasons s ON t.season_id = s.id WHERE t.id = $1', [team]
    );
    if (teamLeagueResult.rows.length > 0) {
      canCommissionTeam = req.user.commissionerLeagueIds.includes(teamLeagueResult.rows[0].league_id);
    }
  }
  if (!canManageTeam && !canCommissionTeam) {
    return res.status(403).json({ error: 'Not authorized to manage this team' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const playersQuery = `
      SELECT tr.player_id, tr.position, tr.drafted_position, tr.status,
             p.mlb_id, p.name, p.current_mlb_team_id
      FROM team_rosters tr
      JOIN players p ON tr.player_id = p.id
      WHERE tr.team_id = $1 AND (tr.player_id = $2 OR tr.player_id = $3)
      AND tr.end_date IS NULL
    `;
    const playersResult = await client.query(playersQuery, [team, p1, p2]);

    if (playersResult.rows.length !== 2) {
      throw new Error('One or both players not found on team');
    }

    const player1 = playersResult.rows.find(p => p.player_id === p1);
    const player2 = playersResult.rows.find(p => p.player_id === p2);

    // Validate position compatibility
    if (player2.position !== 'BEN' && player1.drafted_position !== 'BEN' && player1.drafted_position !== player2.position) {
      throw new Error('Drafted starters can only return to their original position');
    }
    if (player1.position !== 'BEN' && player2.drafted_position !== 'BEN' && player2.drafted_position !== player1.position) {
      throw new Error('Drafted starters can only return to their original position');
    }

    // Determine effective date
    const today = new Date().toISOString().split('T')[0];
    let calculatedEffectiveDate = today;
    let playersWithActiveGames = [];

    if (effectiveDate) {
      calculatedEffectiveDate = effectiveDate;
    } else {
      const scheduleUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${today}&gameType=R&fields=dates,date,games,gamePk,teams,team,id,status,statusCode`;
      const scheduleResponse = await axios.get(scheduleUrl);

      if (scheduleResponse.data.dates.length > 0) {
        const games = scheduleResponse.data.dates[0].games;
        for (const game of games) {
          if (['F', 'P', 'I'].includes(game.status.statusCode)) {
            const homeTeamId = game.teams.home.team.id;
            const awayTeamId = game.teams.away.team.id;

            if (player1.current_mlb_team_id === homeTeamId || player1.current_mlb_team_id === awayTeamId) {
              playersWithActiveGames.push(player1);
            }
            if (player2.current_mlb_team_id === homeTeamId || player2.current_mlb_team_id === awayTeamId) {
              playersWithActiveGames.push(player2);
            }
          }
        }
      }

      if (playersWithActiveGames.length > 0) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        calculatedEffectiveDate = tomorrow.toISOString().split('T')[0];
      }
    }

    // End current entries
    await client.query(
      'UPDATE team_rosters SET end_date = $1 WHERE team_id = $2 AND player_id = $3 AND end_date IS NULL',
      [calculatedEffectiveDate, team, p1]
    );
    await client.query(
      'UPDATE team_rosters SET end_date = $1 WHERE team_id = $2 AND player_id = $3 AND end_date IS NULL',
      [calculatedEffectiveDate, team, p2]
    );

    // Create new entries
    await client.query(
      `INSERT INTO team_rosters (team_id, player_id, position, drafted_position, status, reason, effective_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [team, p1, player2.position, player1.drafted_position,
       player2.position === 'BEN' ? 'BENCH' : 'STARTER', player2.position === 'BEN' ? reason : null, calculatedEffectiveDate]
    );
    await client.query(
      `INSERT INTO team_rosters (team_id, player_id, position, drafted_position, status, reason, effective_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [team, p2, player1.position, player2.drafted_position,
       player1.position === 'BEN' ? 'BENCH' : 'STARTER', player1.position === 'BEN' ? reason : null, calculatedEffectiveDate]
    );

    await client.query('COMMIT');

    let message;
    if (effectiveDate) {
      message = `Players swapped successfully - effective ${calculatedEffectiveDate}`;
    } else if (calculatedEffectiveDate === today) {
      message = 'Players swapped successfully - effective immediately';
    } else {
      const affectedPlayers = playersWithActiveGames.map(p => p.name).join(', ');
      message = `Players swapped successfully - change will be effective ${calculatedEffectiveDate} (${affectedPlayers} already playing today)`;
    }
    res.json({ success: true, message, effectiveDate: calculatedEffectiveDate });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
