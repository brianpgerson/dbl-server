const { MLB_TEAM_ABBREVIATIONS } = require('../../helpers/mlb');

describe('MLB_TEAM_ABBREVIATIONS', () => {
  test('has all 30 MLB teams', () => {
    const teamCount = Object.keys(MLB_TEAM_ABBREVIATIONS).length;
    expect(teamCount).toBe(30);
  });

  test('maps known teams correctly', () => {
    expect(MLB_TEAM_ABBREVIATIONS[147]).toBe('NYY');
    expect(MLB_TEAM_ABBREVIATIONS[119]).toBe('LAD');
    expect(MLB_TEAM_ABBREVIATIONS[144]).toBe('ATL');
    expect(MLB_TEAM_ABBREVIATIONS[146]).toBe('MIA');
    expect(MLB_TEAM_ABBREVIATIONS[158]).toBe('MIL');
    expect(MLB_TEAM_ABBREVIATIONS[141]).toBe('TOR');
  });

  test('has no duplicate abbreviations', () => {
    const abbrs = Object.values(MLB_TEAM_ABBREVIATIONS);
    const unique = new Set(abbrs);
    expect(unique.size).toBe(abbrs.length);
  });
});
