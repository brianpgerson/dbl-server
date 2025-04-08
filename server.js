const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const fetchHomeRuns = require('./scripts/fetch-home-runs');
const syncMlbData = require('./scripts/sync-mlb-data');
const axios = require('axios');
const { getDbPool } = require('./db');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const pool = getDbPool();

// Get current roster with status for a team
app.get('/api/roster/:teamId', async (req, res) => {
  try {
    const query = `
      SELECT 
        p.id as player_id, p.name, p.primary_position, p.mlb_id,
        tr.position, tr.drafted_position, tr.status, tr.reason
      FROM team_rosters tr
      JOIN players p ON tr.player_id = p.id
      WHERE tr.team_id = $1
      AND tr.end_date IS NULL
      ORDER BY 
        CASE tr.position
          WHEN 'BEN' THEN 'ZZZ' -- Sort bench players last
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
app.post('/api/roster/move', async (req, res) => {
  const { teamId, playerId, newPosition, reason, effectiveDate } = req.body;
  
  if (!teamId || !playerId || !newPosition || !effectiveDate) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Get current player status
    const playerQuery = `
      SELECT position, drafted_position, status FROM team_rosters
      WHERE team_id = $1 AND player_id = $2
    `;
    const playerResult = await client.query(playerQuery, [teamId, playerId]);
    if (playerResult.rows.length === 0) {
      throw new Error('Player not found on team');
    }
    
    const player = playerResult.rows[0];
    
    // Validate the move
    if (newPosition === 'BEN') {
      // Moving to bench - needs to retain drafted_position
      // End current entry
      await client.query(
        `UPDATE team_rosters SET end_date = $1
         WHERE team_id = $2 AND player_id = $3 AND end_date IS NULL`,
        [effectiveDate, teamId, playerId]
      );
      // Create new entry
      await client.query(
        `INSERT INTO team_rosters (team_id, player_id, position, drafted_position, status, reason, effective_date)
         VALUES ($1, $2, 'BEN', $3, 'BENCH', $4, $5)`,
        [teamId, playerId, player.drafted_position, reason || 'Injury', effectiveDate]
      );
    } else {
      // Activating from bench or moving positions
      if (player.drafted_position !== newPosition && player.drafted_position !== 'BEN') {
        // Trying to put a drafted starter in the wrong position
        throw new Error('Players can only return to their drafted position');
      }
      
      // Check if position is occupied
      const occupiedCheck = await client.query(
        `SELECT player_id FROM team_rosters WHERE team_id = $1 AND position = $2 AND status = 'STARTER' AND end_date IS NULL`,
        [teamId, newPosition]
      );
      
      if (occupiedCheck.rows.length > 0) {
        throw new Error('Position is already occupied by another player');
      }
      
      // End current entry
      await client.query(
        `UPDATE team_rosters SET end_date = $1
         WHERE team_id = $2 AND player_id = $3 AND end_date IS NULL`,
        [effectiveDate, teamId, playerId]
      );
      // Create new entry
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
app.post('/api/roster/swap', async (req, res) => {
  const { teamId, player1Id, player2Id, reason } = req.body;
  
  if (!teamId || !player1Id || !player2Id) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Get both players' current status with MLB IDs and team IDs
    const playersQuery = `
      SELECT tr.player_id, tr.position, tr.drafted_position, tr.status, 
             p.mlb_id, p.name, p.current_mlb_team_id
      FROM team_rosters tr
      JOIN players p ON tr.player_id = p.id
      WHERE tr.team_id = $1 AND tr.player_id IN ($2, $3)
    `;
    const playersResult = await client.query(playersQuery, [teamId, player1Id, player2Id]);
    if (playersResult.rows.length !== 2) {
      throw new Error('One or both players not found on team');
    }
    
    const player1 = playersResult.rows.find(p => p.player_id === player1Id);
    const player2 = playersResult.rows.find(p => p.player_id === player2Id);
    
    // Validate the swap
    // When moving TO bench, we don't need position validation
    if (player2.position !== 'BEN' && player1.drafted_position !== 'BEN' && player1.drafted_position !== player2.position) {
      throw new Error('Drafted starters can only return to their original position');
    }
    // When moving FROM bench, we don't need position validation
    if (player1.position !== 'BEN' && player2.drafted_position !== 'BEN' && player2.drafted_position !== player1.position) {
      throw new Error('Drafted starters can only return to their original position');
    }
    
    // Check if either player's team has games in progress/completed today
    const today = new Date().toISOString().split('T')[0];
    const scheduleUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${today}&gameType=R&fields=dates,date,games,gamePk,teams,team,id,status,statusCode`;
    const scheduleResponse = await axios.get(scheduleUrl);
    
    let playersWithActiveGames = [];
    let effectiveDate = today;
    
    // Get team IDs from the database - no API call needed
    const player1TeamId = player1.current_mlb_team_id;
    const player2TeamId = player2.current_mlb_team_id;
    
    // Check if any games for players' teams are active/completed
    if (scheduleResponse.data.dates.length > 0) {
      const games = scheduleResponse.data.dates[0].games;
      for (const game of games) {
        if (['F', 'P', 'I'].includes(game.status.statusCode)) {
          const homeTeamId = game.teams.home.team.id;
          const awayTeamId = game.teams.away.team.id;
          
          if (player1TeamId === homeTeamId || player1TeamId === awayTeamId) {
            playersWithActiveGames.push(player1);
          }
          
          if (player2TeamId === homeTeamId || player2TeamId === awayTeamId) {
            playersWithActiveGames.push(player2);
          }
        }
      }
    }
    
    // If any games active/complete, set effective date to tomorrow
    if (playersWithActiveGames.length > 0) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      effectiveDate = tomorrow.toISOString().split('T')[0];
      console.log(`Players already playing today: ${playersWithActiveGames.map(p => p.name).join(', ')}`);
    }
    
    // Execute the swap by ending current entries and creating new ones
    // First, end the current entries
    await client.query(
      `UPDATE team_rosters SET end_date = $1 
       WHERE team_id = $2 AND player_id = $3 AND end_date IS NULL`,
      [effectiveDate, teamId, player1Id]  
    );
    
    await client.query(
      `UPDATE team_rosters SET end_date = $1
       WHERE team_id = $2 AND player_id = $3 AND end_date IS NULL`,
      [effectiveDate, teamId, player2Id]
    );
    
    // Then create new entries
    await client.query(
      `INSERT INTO team_rosters (team_id, player_id, position, drafted_position, status, reason, effective_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [teamId, player1Id, player2.position, player1.drafted_position, 
       player2.position === 'BEN' ? 'BENCH' : 'STARTER', player2.position === 'BEN' ? reason : null, effectiveDate]  
    );
    
    await client.query(
      `INSERT INTO team_rosters (team_id, player_id, position, drafted_position, status, reason, effective_date) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [teamId, player2Id, player1.position, player2.drafted_position,
       player1.position === 'BEN' ? 'BENCH' : 'STARTER', player1.position === 'BEN' ? reason : null, effectiveDate]
    );
    
    await client.query('COMMIT');
    
    // Return success with right message based on effective date
    let message;
    if (effectiveDate === today) {
      message = 'Players swapped successfully - effective immediately';
    } else {
      const affectedPlayers = playersWithActiveGames.map(p => p.name).join(', ');
      message = `Players swapped successfully - change will be effective ${effectiveDate} (${affectedPlayers} already playing today)`;
    }
    res.json({ success: true, message, effectiveDate });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }
});

// Get all teams
app.get('/api/teams', async (req, res) => {
  try {
    const query = `
      SELECT id, name, manager_name FROM teams
      ORDER BY name
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get team roster with HR counts
app.get('/api/team/:id/roster-with-hrs', async (req, res) => {
  try {
    const query = `
      WITH current_roster AS (
        SELECT 
          p.id as player_id, p.name, p.primary_position, p.mlb_id,
          tr.position, tr.drafted_position, tr.status
        FROM team_rosters tr
        JOIN players p ON tr.player_id = p.id
        WHERE tr.team_id = $1
        AND tr.end_date IS NULL
      )
      SELECT 
        r.player_id, r.name, r.position, r.status,
        COALESCE(COUNT(s.id), 0)::integer as hr_count
      FROM current_roster r
      LEFT JOIN scores s ON s.team_id = $1 AND s.position = r.position
      GROUP BY r.player_id, r.name, r.position, r.status
      ORDER BY 
        CASE r.position
          WHEN 'BEN' THEN 'ZZZ' -- Sort bench players last
          ELSE r.position
        END,
        hr_count DESC
    `;
    const result = await pool.query(query, [req.params.id]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Get home run race data
app.get('/api/race', async (req, res) => {
  try {
    const query = `
      WITH daily_totals AS (
        SELECT 
          teams.id as team_id,
          teams.name as team_name,
          scores.date::date, -- Cast to date to remove time component
          COUNT(*) as daily_hrs
        FROM scores
        JOIN teams ON scores.team_id = teams.id
        GROUP BY teams.id, teams.name, scores.date::date
      ),
      running_totals AS (
        SELECT
          team_id,
          team_name,
          date,
          daily_hrs,
          SUM(daily_hrs) OVER (PARTITION BY team_name ORDER BY date) as total_hrs
        FROM daily_totals
      ),
      team_list AS (
        SELECT id, name 
        FROM teams 
        WHERE league_id = (SELECT id FROM leagues WHERE season_year = 2025 LIMIT 1)
      ),
      date_range AS (
        SELECT generate_series('2025-03-27'::date, CURRENT_DATE, '1 day'::interval)::date as date
      )
      SELECT
        t.name as team_name,
        d.date::text as date,
        COALESCE(r.daily_hrs, 0)::integer as daily_hrs,
        COALESCE(r.total_hrs, 0)::integer as total_hrs
      FROM team_list t
      CROSS JOIN date_range d
      LEFT JOIN running_totals r ON t.name = r.team_name AND d.date = r.date
      ORDER BY d.date, t.name
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  
  // Start HR fetch cron job hourly
  console.log('Starting HR fetch cron service...');
  
  // Function to run HR fetch
  const runHRFetch = async () => {
    const now = new Date();
    console.log(`[${now.toISOString()}] Running HR fetch...`);
    
    try {
      // Get yesterday and today to catch overnight games
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      const todayStr = new Date().toISOString().split('T')[0];
      
      await fetchHomeRuns(yesterdayStr, todayStr);
      console.log(`[${new Date().toISOString()}] HR fetch completed successfully`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] HR fetch error:`, error.message);
    }
  };
  
  // Run once at startup
  runHRFetch();
  
  // Schedule to run hourly
  cron.schedule('0 * * * *', runHRFetch);
  console.log('Cron service started. HR data will be fetched hourly.');
  
  // Full MLB data sync daily at 4am
  cron.schedule('0 4 * * *', async () => {
    console.log(`[${new Date().toISOString()}] Running daily MLB data sync...`);
    try {
      await syncMlbData();
      console.log(`[${new Date().toISOString()}] MLB data sync completed successfully`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] MLB data sync error:`, error.message);
    }
  });
});