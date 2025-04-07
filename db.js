const { Pool } = require('pg');
require('dotenv').config();

const getDbPool = () => {
  return new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/dong_bong_league',
    ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('herokuapp.com') 
      ? { rejectUnauthorized: false } 
      : false
  });
};

module.exports = { getDbPool };