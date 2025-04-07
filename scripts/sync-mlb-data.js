const axios = require('axios');
const { Pool } = require('pg');
require('dotenv').config({ path: '../.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/dong_bong_league',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

const MLB_API_BASE = 'https://statsapi.mlb.com/api/v1';

async function syncMlbData() {
  try {
    console.log('Starting MLB data sync...');
    
    // Get all teams from MLB API
    const teamsUrl = `${MLB_API_BASE}/teams?leagueIds=103,104&season=2025`;
    const teamsResponse = await axios.get(teamsUrl);
    const teams = teamsResponse.data.teams;
    console.log(`Found ${teams.length} MLB teams`);
    
    // Track all active MLB player IDs we find
    const activeMlbIds = new Set();
    const mlbPlayerData = {};
    
    // Process all teams
    for (const team of teams) {
      const rosterUrl = `${MLB_API_BASE}/teams/${team.id}/roster?rosterType=40Man&season=2025`;
      const rosterResponse = await axios.get(rosterUrl);
      const roster = rosterResponse.data.roster || [];
      
      // Process all players on this team
      for (const player of roster) {
        // Skip pitchers except Ohtani
        if (player.person.id === 660271 || player.person.fullName.includes('Ohtani') || 
            !['P', 'TWP', 'RP', 'SP'].includes(player.position.code)) {
          
          const mlbId = player.person.id;
          activeMlbIds.add(mlbId);
          
          mlbPlayerData[mlbId] = {
            name: player.person.fullName,
            primary_position: player.position.code,
            current_mlb_team_id: team.id
          };
        }
      }
      console.log(`Processed ${team.name} roster`);
    }
    
    // Get all existing players from our DB
    const existingPlayersQuery = 'SELECT id, mlb_id, name, primary_position, current_mlb_team_id FROM players';
    const existingPlayersResult = await pool.query(existingPlayersQuery);
    const existingPlayers = existingPlayersResult.rows;
    const existingMlbIds = new Set(existingPlayers.map(p => p.mlb_id));
    
    console.log(`Found ${activeMlbIds.size} active MLB players and ${existingPlayers.length} in our DB`);
    
    // Perform database operations
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      // 1. Update existing players
      for (const player of existingPlayers) {
        if (activeMlbIds.has(player.mlb_id)) {
          const updatedData = mlbPlayerData[player.mlb_id];
          
          // Only update if something changed
          if (player.name !== updatedData.name || 
              player.primary_position !== updatedData.primary_position ||
              player.current_mlb_team_id !== updatedData.current_mlb_team_id) {
            
            await client.query(
              'UPDATE players SET name = $1, primary_position = $2, current_mlb_team_id = $3, updated_at = NOW() WHERE id = $4',
              [updatedData.name, updatedData.primary_position, updatedData.current_mlb_team_id, player.id]
            );
          }
        }
      }
      
      // 2. Add new players
      for (const mlbId of activeMlbIds) {
        if (!existingMlbIds.has(mlbId)) {
          const newPlayer = mlbPlayerData[mlbId];
          await client.query(
            'INSERT INTO players (name, mlb_id, primary_position, current_mlb_team_id) VALUES ($1, $2, $3, $4)',
            [newPlayer.name, mlbId, newPlayer.primary_position, newPlayer.current_mlb_team_id]
          );
        }
      }
      
      await client.query('COMMIT');
      console.log('MLB data sync complete!');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error syncing MLB data:', error.message);
  } finally {
    pool.end();
  }
}

// Run if called directly
if (require.main === module) {
  syncMlbData();
}

module.exports = syncMlbData;