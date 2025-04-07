const { Pool } = require('pg');
require('dotenv').config({ path: '../.env' });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/dong_bong_league'
});

async function showPlayerHRs() {
  try {
    // Get all players on rosters with HR counts
    const query = `
      WITH all_rosters AS (
        SELECT 
          p.id as player_id, p.name, t.id as team_id, t.name as team_name,
          tr.position, tr.effective_date, tr.end_date
        FROM players p
        JOIN team_rosters tr ON p.id = tr.player_id
        JOIN teams t ON tr.team_id = t.id
      )
      SELECT 
        r.name as player_name, 
        r.team_name,
        r.position,
        COALESCE(SUM(pgs.home_runs), 0) as total_hrs,
        COALESCE(COUNT(s.id), 0) as counted_hrs
      FROM all_rosters r
      LEFT JOIN player_game_stats pgs ON r.player_id = pgs.player_id
      LEFT JOIN scores s ON (s.game_id = pgs.game_id AND s.team_id = r.team_id AND s.position = r.position AND s.date = pgs.date)
      WHERE r.end_date IS NULL
      GROUP BY r.name, r.team_name, r.position
      ORDER BY total_hrs DESC, counted_hrs DESC
    `;
    
    const result = await pool.query(query);
    
    console.log('Player Home Run Counts:');
    console.log('=======================');
    console.log('Player Name         | Team            | Pos | Total HRs | Counted HRs');
    console.log('-------------------- ----------------  ---- ----------- ------------');
    
    result.rows.forEach(row => {
      console.log(
        `${row.player_name.padEnd(20)} | ${row.team_name.padEnd(15)} | ${row.position.padEnd(3)} | ${String(row.total_hrs).padEnd(9)} | ${row.counted_hrs}`
      );
    });
    
    console.log('\nNote: Total HRs = all HRs hit by player, Counted HRs = HRs that count for scoring (player was starter)');
    
  } catch (error) {
    console.error('Error getting player stats:', error);
  } finally {
    pool.end();
  }
}

showPlayerHRs();