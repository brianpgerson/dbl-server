const axios = require('axios');
const { Pool } = require('pg');
require('dotenv').config({ path: '../.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/dong_bong_league'
});

const MLB_API_BASE = 'https://statsapi.mlb.com/api/v1';

async function fetchHomeRuns(startDate, endDate) {
  try {
    console.log(`Fetching home runs from ${startDate} to ${endDate}`);
    
    // Get all games in the date range
    const scheduleUrl = `${MLB_API_BASE}/schedule?sportId=1&startDate=${startDate}&endDate=${endDate}&gameType=R&fields=dates,date,games,gamePk,status,statusCode`;
    const scheduleResponse = await axios.get(scheduleUrl);
    
    // Get completed games
    const completedGames = [];
    scheduleResponse.data.dates.forEach(date => {
      date.games.forEach(game => {
        if (game.status.statusCode === 'F') { // Final game state
          completedGames.push(game.gamePk);
        }
      });
    });
    
    console.log(`Found ${completedGames.length} completed games`);
    
    // Get player IDs to filter
    const playersResult = await pool.query('SELECT id, mlb_id FROM players');
    const playerMlbIds = new Set(playersResult.rows.map(p => p.mlb_id));
    const playerIdMap = {};
    playersResult.rows.forEach(p => playerIdMap[p.mlb_id] = p.id);
    
    // For each game, get boxscore and find home runs
    const homeRuns = [];
    for (const gamePk of completedGames) {
      const boxscoreUrl = `${MLB_API_BASE}/game/${gamePk}/boxscore`;
      const boxscoreResponse = await axios.get(boxscoreUrl);
      const boxscore = boxscoreResponse.data;
      
      // Check both teams
      ['home', 'away'].forEach(teamType => {
        const players = boxscore.teams[teamType].players;
        Object.values(players).forEach(player => {
          const stats = player.stats?.batting;
          if (stats && stats.homeRuns > 0 && playerMlbIds.has(player.person.id)) {
            for (let i = 0; i < stats.homeRuns; i++) {
              homeRuns.push({
                player_id: playerIdMap[player.person.id],
                game_id: gamePk,
                date: scheduleResponse.data.dates.find(d => 
                  d.games.some(g => g.gamePk === gamePk)).date,
                inning: 0 // We don't have exact inning info from boxscore
              });
            }
          }
        });
      });
    }
    
    console.log(`Found ${homeRuns.length} home runs by fantasy players`);
    
    // Group home runs by player/game for upsert
    const hrsByGame = {};
    homeRuns.forEach(hr => {
      const key = `${hr.player_id}:${hr.game_id}`;
      if (!hrsByGame[key]) {
        hrsByGame[key] = { player_id: hr.player_id, game_id: hr.game_id, date: hr.date, count: 0 };
      }
      hrsByGame[key].count++;  
    });
    
    // Insert home run counts into database
    for (const key in hrsByGame) {
      const hr = hrsByGame[key];
      await pool.query(
        'INSERT INTO player_game_stats (player_id, game_id, date, home_runs) VALUES ($1, $2, $3, $4) ON CONFLICT (player_id, game_id) DO UPDATE SET home_runs = $4',
        [hr.player_id, hr.game_id, hr.date, hr.count]
      );
    }
    
    // Update scores table
    await updateScores(startDate, endDate);
    
    console.log('Home run import complete!');
  } catch (error) {
    console.error('Error fetching home runs:', error.message);
  } finally {
    // Only end the pool if we're running as standalone script
    if (require.main === module) {
      pool.end();
    }
  }
}

async function updateScores(startDate, endDate) {
  // Truncate existing scores for the date range to recalculate
  await pool.query('DELETE FROM scores WHERE date BETWEEN $1 AND $2', [startDate, endDate]);
  
  // Get all home runs in date range and calculate scoring
  const query = `
    WITH player_hrs AS (
      SELECT pgs.player_id, pgs.date, pgs.game_id, pgs.home_runs
      FROM player_game_stats pgs
      WHERE pgs.date BETWEEN $1 AND $2
    )
    SELECT ph.player_id, ph.date, ph.game_id, ph.home_runs,
           tr.team_id, tr.position, tr.status
    FROM player_hrs ph
    JOIN team_rosters tr ON ph.player_id = tr.player_id
    WHERE tr.effective_date <= ph.date
    AND (tr.end_date IS NULL OR tr.end_date > ph.date)
    AND tr.status = 'STARTER'
    ORDER BY ph.date
  `;
  
  const result = await pool.query(query, [startDate, endDate]);
  
  // Insert score records for each valid HR
  let scoreCount = 0;
  for (const row of result.rows) {
    // For each HR the player hit in this game
    for (let i = 0; i < row.home_runs; i++) {
      await pool.query(
        'INSERT INTO scores (game_id, team_id, position, date) VALUES ($1, $2, $3, $4)',
        [row.game_id, row.team_id, row.position, row.date]
      );
      scoreCount++;
    }
  }
  
  console.log(`Processed scoring for ${scoreCount} home runs`);
}

// Export function for module import
module.exports = fetchHomeRuns;

// Run if called directly from command line
if (require.main === module) {
  const startDate = process.argv[2] || '2025-03-27'; 
  const endDate = process.argv[3] || new Date().toISOString().split('T')[0]; // Today by default
  fetchHomeRuns(startDate, endDate);
}