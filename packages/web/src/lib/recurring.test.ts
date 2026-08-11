import { describe, expect, test } from 'vitest';
import { localToday } from './recurring';

/*
 * The whole reason the client sends its own date.
 *
 * The API runs in UTC. `new Date().toISOString().slice(0, 10)` on a phone in California at 8pm gives
 * tomorrow's date, so a rent rule anchored on the 1st would come due on the evening of the 31st for
 * everybody west of UTC, and a rule anchored on the 31st would skip a month. The device is the only
 * thing in the system that knows which day it is where the person is standing.
 */

describe('localToday', () => {
  test('reads the local calendar date, not UTC', () => {
    // 2026-08-12 07:30 UTC is still 2026-08-12 anywhere from UTC-7 eastwards, and the local getters
    // are what make that true rather than the ISO string.
    const morning = new Date(2026, 7, 12, 7, 30, 0);
    expect(localToday(morning)).toBe('2026-08-12');
  });

  test('does not roll forward late in the evening', () => {
    // 11:59pm local. toISOString() would already say the 13th for any negative UTC offset.
    const lateEvening = new Date(2026, 7, 12, 23, 59, 0);
    expect(localToday(lateEvening)).toBe('2026-08-12');
  });

  test('does not roll back early in the morning', () => {
    const veryEarly = new Date(2026, 7, 12, 0, 1, 0);
    expect(localToday(veryEarly)).toBe('2026-08-12');
  });

  test('pads month and day so it always matches YYYY-MM-DD', () => {
    // The API validates with a regex, so an unpadded 2026-1-5 is a 400 rather than a wrong answer.
    expect(localToday(new Date(2026, 0, 5, 12))).toBe('2026-01-05');
    expect(localToday(new Date(2026, 8, 30, 12))).toBe('2026-09-30');
  });

  test('handles a leap day and a year boundary', () => {
    expect(localToday(new Date(2028, 1, 29, 12))).toBe('2028-02-29');
    expect(localToday(new Date(2026, 11, 31, 23, 30))).toBe('2026-12-31');
    expect(localToday(new Date(2027, 0, 1, 0, 30))).toBe('2027-01-01');
  });

  test('agrees with the local getters across a whole year of local midnights', () => {
    for (let day = 0; day < 365; day++) {
      const at = new Date(2026, 0, 1 + day, 0, 30, 0);
      const expected = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(
        at.getDate(),
      ).padStart(2, '0')}`;
      expect(localToday(at)).toBe(expected);
    }
  });
});
