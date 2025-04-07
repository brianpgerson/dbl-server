const { Pool } = require('pg');
require('dotenv').config();

const getDbPool = () => {
  // For Heroku, use SSL; for local, don't
  const isProduction = process.env.NODE_ENV === 'production';
  
  return new Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/dong_bong_league',
    ssl: isProduction ? { rejectUnauthorized: false } : false
  });
};

module.exports = { getDbPool };