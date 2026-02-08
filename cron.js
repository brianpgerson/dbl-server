const cron = require('node-cron');
const fetchHomeRuns = require('./scripts/fetch-home-runs');
const syncMlbData = require('./scripts/sync-mlb-data');
const syncPlayerStatus = require('./scripts/sync-player-status');
const { getActiveSeason, formatDate } = require('./helpers/league');

function startCronJobs(pool) {
  console.log('Starting cron services...');

  const runHRFetch = async (fullSync = false) => {
    const now = new Date();
    console.log(`[${now.toISOString()}] Running HR fetch (${fullSync ? 'full' : 'recent'})...`);

    try {
      const season = await getActiveSeason(pool);
      if (!season) {
        console.log('No season found, skipping HR fetch');
        return;
      }
      const todayStr = new Date().toISOString().split('T')[0];
      const leagueStart = formatDate(season.start_date);
      const leagueEnd = formatDate(season.end_date);

      if (todayStr < leagueStart || todayStr > leagueEnd) {
        console.log(`Outside season window (${leagueStart} to ${leagueEnd}), skipping HR fetch`);
        return;
      }

      let startDate;
      if (fullSync) {
        startDate = leagueStart;
      } else {
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        const threeDaysStr = threeDaysAgo.toISOString().split('T')[0];
        startDate = threeDaysStr < leagueStart ? leagueStart : threeDaysStr;
      }

      await fetchHomeRuns(startDate, todayStr);
      console.log(`[${new Date().toISOString()}] HR fetch completed successfully`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] HR fetch error:`, error.message);
    }
  };

  // Run full sync at startup
  runHRFetch(true);

  // Schedule hourly (recent days only)
  cron.schedule('0 * * * *', () => runHRFetch(false));
  console.log('HR data will be fetched hourly.');

  // Full MLB data sync daily at 4am
  cron.schedule('0 4 * * *', async () => {
    console.log(`[${new Date().toISOString()}] Running daily MLB data sync...`);
    try {
      await syncMlbData();
      console.log(`[${new Date().toISOString()}] MLB data sync completed successfully`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] MLB data sync error:`, error.message);
    }
  });

  // Player status sync every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    console.log(`[${new Date().toISOString()}] Running player status sync...`);
    try {
      await syncPlayerStatus();
      console.log(`[${new Date().toISOString()}] Player status sync completed successfully`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] Player status sync error:`, error.message);
    }
  });

  // Also run player status sync once at startup
  syncPlayerStatus();
}

module.exports = { startCronJobs };
