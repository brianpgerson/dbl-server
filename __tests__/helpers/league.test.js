const { formatDate } = require('../../helpers/league');

describe('formatDate', () => {
  test('formats a Date object to YYYY-MM-DD', () => {
    expect(formatDate(new Date('2025-03-27'))).toBe('2025-03-27');
  });

  test('formats a date string to YYYY-MM-DD', () => {
    expect(formatDate('2025-09-30')).toBe('2025-09-30');
  });

  test('handles timezone offset correctly', () => {
    // pg returns dates at midnight UTC
    const pgDate = new Date('2025-03-27T00:00:00.000Z');
    expect(formatDate(pgDate)).toBe('2025-03-27');
  });
});
