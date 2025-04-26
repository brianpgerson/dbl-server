const axios = require('axios');
const { getDbPool } = require('../db');

const MLB_API_BASE = 'https://statsapi.mlb.com/api/v1';

async function syncPlayerStatus() {
  const pool = getDbPool();
  
  try {
    console.log(`[${new Date().toISOString()}] Starting player status sync...`);
    
    // Get all MLB team IDs we care about
    const teamResult = await pool.query(`
      SELECT DISTINCT current_mlb_team_id 
      FROM players 
      WHERE current_mlb_team_id IS NOT NULL
    `);
    
    const teamIds = teamResult.rows.map(row => row.current_mlb_team_id);
    console.log(`Found ${teamIds.length} teams to check`);
    
    // For each team, get 40-man roster with status (includes injured players)
    for (const teamId of teamIds) {
      try {
        const rosterUrl = `${MLB_API_BASE}/teams/${teamId}/roster/40Man?hydrate=person(status)`;
        const response = await axios.get(rosterUrl);
        
        for (const player of response.data.roster) {
          const mlbId = player.person.id;
          const statusDesc = player.status.description;
          
          // Map MLB status descriptions to our simplified statuses
          let status = 'Active';
          if (statusDesc.includes('IL') || statusDesc.includes('Injured')) {
            status = 'IL';
            console.log(`Found IL player: ${player.person.fullName} (${statusDesc})`);
          } else if (statusDesc === 'DTD' || statusDesc.toLowerCase().includes('day-to-day')) {
            status = 'DTD';
            console.log(`Found DTD player: ${player.person.fullName} (${statusDesc})`);
          }
          
          // Update player status in database
          const result = await pool.query(
            'UPDATE players SET status = $1 WHERE mlb_id = $2 RETURNING *',
            [status, mlbId]
          );
          
          if (result.rowCount > 0 && status !== 'Active') {
            console.log(`Updated status for ${player.person.fullName}: ${status}`);
          }
        }
        
        console.log(`Updated status for team ${teamId}`);
      } catch (err) {
        console.error(`Error fetching roster for team ${teamId}:`, err.message);
      }
    }
    
    console.log(`[${new Date().toISOString()}] Player status sync completed`);
  } catch (error) {
    console.error('Error syncing player status:', error);
  } finally {
    if (require.main === module) {
      pool.end();
    }
  }
}

// Export for module import
module.exports = syncPlayerStatus;

// Run if called directly from command line
if (require.main === module) {
  syncPlayerStatus();
}