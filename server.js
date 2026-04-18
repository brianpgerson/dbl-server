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
app.use(express.json({ limit: '2mb' }));
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large (max 2MB)' });
  }
  next(err);
});

// Share the DB pool with route handlers via app.set
const pool = getDbPool();
app.set('pool', pool);

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/teams', require('./routes/teams'));
app.use('/api/team', require('./routes/teams'));
app.use('/api/roster', require('./routes/roster'));
app.use('/api/leagues', require('./routes/leagues'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/draft', require('./routes/draft'));
app.use('/api/big-dongos', require('./routes/big-dongos'));
app.use('/api/badges', require('./routes/badges'));
app.use('/api/feed', require('./routes/feed'));
app.use('/api/status', require('./routes/status'));

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
