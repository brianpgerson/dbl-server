const axios = require('axios');

const MLB_API_BASE = 'https://statsapi.mlb.com/api/v1';

// MLB team ID to abbreviation mapping (verified against statsapi.mlb.com)
const MLB_TEAM_ABBREVIATIONS = {
  108: 'LAA', 109: 'AZ',  110: 'BAL', 111: 'BOS', 112: 'CHC', 113: 'CIN', 114: 'CLE', 115: 'COL',
  116: 'DET', 117: 'HOU', 118: 'KC',  119: 'LAD', 120: 'WSH', 121: 'NYM', 133: 'ATH', 134: 'PIT',
  135: 'SD',  136: 'SEA', 137: 'SF',  138: 'STL', 139: 'TB',  140: 'TEX', 141: 'TOR', 142: 'MIN',
  143: 'PHI', 144: 'ATL', 145: 'CWS', 146: 'MIA', 147: 'NYY', 158: 'MIL'
};

// Get today's game data for a set of MLB team IDs
async function getTodaysGameData(playerMlbTeamIds) {
  try {
    const today = new Date().toISOString().split('T')[0];
    const scheduleUrl = `${MLB_API_BASE}/schedule?sportId=1&date=${today}&gameType=R&fields=dates,date,games,gamePk,teams,team,id,name,status,statusCode,detailedState,gameDate`;

    const scheduleResponse = await axios.get(scheduleUrl);
    const gameData = {};

    if (scheduleResponse.data.dates && scheduleResponse.data.dates.length > 0) {
      const games = scheduleResponse.data.dates[0].games;

      games.forEach(game => {
        const homeTeamId = game.teams.home.team.id;
        const awayTeamId = game.teams.away.team.id;
        const homeTeamAbbr = MLB_TEAM_ABBREVIATIONS[homeTeamId] || 'UNK';
        const awayTeamAbbr = MLB_TEAM_ABBREVIATIONS[awayTeamId] || 'UNK';
        const status = game.status.statusCode;
        const detailedState = game.status.detailedState;

        const gameDate = new Date(game.gameDate);
        const gameTime = gameDate.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: 'America/Los_Angeles'
        });

        let gameInfo = '';
        let gameStatus = 'scheduled';

        if (status === 'S' || status === 'P') {
          gameInfo = `${gameTime}`;
          gameStatus = 'scheduled';
        } else if (status === 'I' || status === 'MA') {
          gameInfo = 'Live';
          gameStatus = 'live';
        } else if (status === 'F' || status === 'FT') {
          gameInfo = 'Final';
          gameStatus = 'final';
        } else if (status === 'D' || status === 'DR') {
          gameInfo = 'Delayed';
          gameStatus = 'delayed';
        } else if (status === 'PO') {
          gameInfo = 'PPD';
          gameStatus = 'postponed';
        } else {
          gameInfo = detailedState || status;
          gameStatus = 'other';
        }

        if (playerMlbTeamIds.includes(homeTeamId)) {
          gameData[homeTeamId] = { text: `vs ${awayTeamAbbr} ${gameInfo}`, status: gameStatus };
        }
        if (playerMlbTeamIds.includes(awayTeamId)) {
          gameData[awayTeamId] = { text: `@${homeTeamAbbr} ${gameInfo}`, status: gameStatus };
        }
      });
    }

    return gameData;
  } catch (error) {
    console.error('Error fetching game data:', error);
    return {};
  }
}

module.exports = { MLB_API_BASE, MLB_TEAM_ABBREVIATIONS, getTodaysGameData };
