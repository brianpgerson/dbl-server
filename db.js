const { Pool } = require('pg');
require('dotenv').config();

const getDbPool = () => {
  // Check if we're on Heroku
  const isHeroku = process.env.DATABASE_URL && process.env.DATABASE_URL.includes('herokuapp.com');
  
  return new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/dong_bong_league',
    ssl: isHeroku ? { rejectUnauthorized: false } : false
  });
};

module.exports = { getDbPool };