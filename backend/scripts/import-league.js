const fs = require('fs');
const { Pool } = require('pg');
const { parse } = require('csv-parse/sync');
require('dotenv').config({ path: '../.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/dong_bong_league'
});

async function importLeague() {
  try {
    // Read CSV file
    const csvData = fs.readFileSync('../league.csv', 'utf8');
    const records = parse(csvData, { columns: true, skip_empty_lines: true });
    
    // Create a new league for 2025
    const leagueResult = await pool.query(
      'INSERT INTO leagues (name, season_year, start_date, end_date) VALUES ($1, $2, $3, $4) RETURNING id',
      ['Dong Bong League', 2025, '2025-03-27', '2025-09-30']
    );
    const leagueId = leagueResult.rows[0].id;
    console.log(`Created league with ID: ${leagueId}`);
    
    // Create roster template
    const positions = ['C', '1B', '2B', '3B', 'SS', 'LF', 'RF', 'CF', 'DH', 'BEN'];
    for (const position of positions) {
      const count = position === 'BEN' ? 2 : 1;
      await pool.query(
        'INSERT INTO roster_templates (league_id, position, count) VALUES ($1, $2, $3)',
        [leagueId, position, count]
      );
    }
    console.log('Roster template created');
    
    // Group players by manager
    const managerRosters = {};
    records.forEach(record => {
      if (!managerRosters[record.manager_name]) {
        managerRosters[record.manager_name] = [];
      }
      managerRosters[record.manager_name].push({
        position: record.position,
        player_name: record.player_name
      });
    });
    
    // Create teams and rosters
    for (const [managerName, players] of Object.entries(managerRosters)) {
      // Generate placeholder team name
      const teamName = `${managerName}'s Squad`;
      
      // Create team
      const teamResult = await pool.query(
        'INSERT INTO teams (league_id, name, manager_name) VALUES ($1, $2, $3) RETURNING id',
        [leagueId, teamName, managerName]
      );
      const teamId = teamResult.rows[0].id;
      console.log(`Created team "${teamName}" (ID: ${teamId})`);
      
      // Add players to roster
      for (const playerData of players) {
        // Find player ID by name
        const playerResult = await pool.query(
          'SELECT id FROM players WHERE name ILIKE $1',
          [`%${playerData.player_name}%`]
        );
        
        if (playerResult.rows.length === 0) {
          console.warn(`Player "${playerData.player_name}" not found in database, skipping`);
          continue;
        }
        
        const playerId = playerResult.rows[0].id;
        const status = playerData.position === 'BEN' ? 'BENCH' : 'STARTER';
        
        // Add to roster
        await pool.query(
          'INSERT INTO team_rosters (team_id, player_id, position, drafted_position, status, effective_date) VALUES ($1, $2, $3, $4, $5, $6)',
          [teamId, playerId, playerData.position, playerData.position, status, '2025-03-27']
        );
      }
      
      console.log(`Roster created for team "${teamName}"`);
    }
    
    console.log('League import complete!');
  } catch (error) {
    console.error('Error importing league data:', error);
  } finally {
    pool.end();
  }
}

importLeague();