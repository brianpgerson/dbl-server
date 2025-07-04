const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const fetchHomeRuns = require('./scripts/fetch-home-runs');
const syncMlbData = require('./scripts/sync-mlb-data');
const syncPlayerStatus = require('./scripts/sync-player-status');
const axios = require('axios');
const { getDbPool } = require('./db');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const pool = getDbPool();

// JWT middleware for protected routes
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Get current roster with status for a team
app.get('/api/roster/:teamId', async (req, res) => {
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
app.post('/api/roster/swap', authenticateToken, async (req, res) => {
  const { teamId, player1Id, player2Id, reason, effectiveDate } = req.body;
  
  if (!teamId || !player1Id || !player2Id) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Validate effectiveDate format if provided
  if (effectiveDate && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    return res.status(400).json({ error: 'effectiveDate must be in YYYY-MM-DD format' });
  }
  
  // Convert IDs to integers in case they come in as strings
  const team = parseInt(teamId);
  const p1 = parseInt(player1Id);
  const p2 = parseInt(player2Id);
  
  // Check if user has permission to manage this team
  // First check if user manages this specific team
  const canManageTeam = req.user.teamIds.includes(team);
  
  // If not, check if user is commissioner for this team's league
  let canCommissionTeam = false;
  if (!canManageTeam && req.user.commissionerLeagues.length > 0) {
    const teamLeagueQuery = `SELECT league_id FROM teams WHERE id = $1`;
    const teamLeagueResult = await pool.query(teamLeagueQuery, [team]);
    if (teamLeagueResult.rows.length > 0) {
      const teamLeague = teamLeagueResult.rows[0].league_id;
      canCommissionTeam = req.user.commissionerLeagues.includes(teamLeague);
    }
  }
  
  if (!canManageTeam && !canCommissionTeam) {
    return res.status(403).json({ error: 'Not authorized to manage this team' });
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
      WHERE tr.team_id = $1 AND (tr.player_id = $2 OR tr.player_id = $3) 
      AND tr.end_date IS NULL
    `;
    console.log(`Swapping players: Team=${team}, Player1=${p1}, Player2=${p2}`);  
    const playersResult = await client.query(playersQuery, [team, p1, p2]);
    console.log(`Query results: Found ${playersResult.rows.length} players`);
    if (playersResult.rows.length > 0) {
      console.log(`Found players: ${playersResult.rows.map(p => `${p.name} (${p.player_id})`).join(', ')}`);
    }
    if (playersResult.rows.length !== 2) {
      throw new Error('One or both players not found on team');
    }
    
    const player1 = playersResult.rows.find(p => p.player_id === p1);
    const player2 = playersResult.rows.find(p => p.player_id === p2);
    
    // Validate the swap
    // When moving TO bench, we don't need position validation
    if (player2.position !== 'BEN' && player1.drafted_position !== 'BEN' && player1.drafted_position !== player2.position) {
      throw new Error('Drafted starters can only return to their original position');
    }
    // When moving FROM bench, we don't need position validation
    if (player1.position !== 'BEN' && player2.drafted_position !== 'BEN' && player2.drafted_position !== player1.position) {
      throw new Error('Drafted starters can only return to their original position');
    }
    
    // Determine effective date - use provided date or calculate based on game status
    const today = new Date().toISOString().split('T')[0];
    let calculatedEffectiveDate = today;
    let playersWithActiveGames = [];
    
    // If effectiveDate is provided, use it directly
    if (effectiveDate) {
      calculatedEffectiveDate = effectiveDate;
    } else {
      // Calculate effective date based on current MLB game status
      const scheduleUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${today}&gameType=R&fields=dates,date,games,gamePk,teams,team,id,status,statusCode`;
      const scheduleResponse = await axios.get(scheduleUrl);
      
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
        calculatedEffectiveDate = tomorrow.toISOString().split('T')[0];
        console.log(`Players already playing today: ${playersWithActiveGames.map(p => p.name).join(', ')}`);
      }
    }
    
    // Execute the swap by ending current entries and creating new ones
    // First, end the current entries
    await client.query(
      `UPDATE team_rosters SET end_date = $1 
       WHERE team_id = $2 AND player_id = $3 AND end_date IS NULL`,
      [calculatedEffectiveDate, team, p1]  
    );
    
    await client.query(
      `UPDATE team_rosters SET end_date = $1
       WHERE team_id = $2 AND player_id = $3 AND end_date IS NULL`,
      [calculatedEffectiveDate, team, p2]
    );
    
    // Then create new entries
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
    
    // Return success with right message based on effective date
    let message;
    if (effectiveDate) {
      // Custom effective date provided
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
          tr.position, tr.drafted_position, tr.status as roster_status,
          p.status as player_status
        FROM team_rosters tr
        JOIN players p ON tr.player_id = p.id
        WHERE tr.team_id = $1
        AND tr.end_date IS NULL
      ),
      player_hrs AS (
        SELECT 
          tr.player_id,
          COUNT(s.id) as hr_count
        FROM team_rosters tr
        JOIN scores s ON s.team_id = tr.team_id 
          AND s.position = tr.position
          AND s.date >= tr.effective_date
          AND (tr.end_date IS NULL OR s.date < tr.end_date)
        WHERE tr.team_id = $1
        AND tr.status = 'STARTER'
        GROUP BY tr.player_id
      )
      SELECT 
        r.player_id, r.name, r.position, r.roster_status, r.player_status,
        COALESCE(ph.hr_count, 0)::integer as hr_count
      FROM current_roster r
      LEFT JOIN player_hrs ph ON ph.player_id = r.player_id
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

// Auth routes
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    // Find user by email
    const userQuery = `
      SELECT u.id, u.email, u.password_hash,
             array_agg(ut.team_id) as team_ids,
             array_agg(t.name) as team_names,
             array_agg(ut.role) as roles,
             array_agg(ut.league_id) as league_ids
      FROM users u
      LEFT JOIN user_teams ut ON u.id = ut.user_id
      LEFT JOIN teams t ON ut.team_id = t.id
      WHERE u.email = $1
      GROUP BY u.id, u.email, u.password_hash
    `;
    
    const result = await pool.query(userQuery, [email.toLowerCase()]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    
    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Generate JWT token
    const roles = user.roles.filter(role => role !== null);
    const leagueIds = user.league_ids.filter(id => id !== null);
    const commissionerLeagues = leagueIds.filter((leagueId, index) => 
      roles[index] === 'commissioner'
    );
    
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email,
        teamIds: user.team_ids.filter(id => id !== null), // Remove null values
        leagueIds: leagueIds,
        commissionerLeagues: commissionerLeagues
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        teams: user.team_ids.filter(id => id !== null).map((id, index) => ({
          id: id,
          name: user.team_names[index]
        }))
      }
    });
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
      // Get all season data from opening day to today
      const openingDay = '2025-03-27';  // Season start
      const todayStr = new Date().toISOString().split('T')[0];
      
      await fetchHomeRuns(openingDay, todayStr);
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
  
  // Player status sync every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    console.log(`[${new Date().toISOString()}] Running player status sync...`);
    try {
      await syncPlayerStatus();
      console.log(`[${new Date().toISOString()}] Player status sync completed successfully`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Player status sync error:`, error.message);
    }
  });
  
  // Also run player status sync once at startup
  syncPlayerStatus();
});