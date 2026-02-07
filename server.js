const express = require('express');
const cors = require('cors');
const { getDbPool } = require('./db');
const { startCronJobs } = require('./cron');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'https://dong-bong-league.com',
  credentials: true
}));
app.use(express.json());

// Share the DB pool with route handlers via app.set
const pool = getDbPool();
app.set('pool', pool);

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/teams', require('./routes/teams'));
app.use('/api/team', require('./routes/teams'));
app.use('/api/roster', require('./routes/roster'));
app.use('/api/leagues', require('./routes/leagues'));

// Keep /api/race as a convenience alias (frontend uses this)
const leaguesRouter = require('./routes/leagues');
app.use('/api', leaguesRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  startCronJobs(pool);
});
