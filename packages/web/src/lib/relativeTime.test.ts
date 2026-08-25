import { describe, expect, it, test } from 'vitest';
import { dayAgo, expenseDay, fullDay, timeAgo, timeAgoShort } from './relativeTime.js';

/** A fixed "now" so none of this depends on when the suite runs. */
const NOW = new Date('2026-08-05T12:00:00Z').getTime();
const ago = (ms: number): number => NOW - ms;

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

describe('timeAgo', () => {
  test('collapses anything very recent into "just now"', () => {
    expect(timeAgo(ago(0), NOW)).toBe('just now');
    expect(timeAgo(ago(59 * SECOND), NOW)).toBe('just now');
  });

  test('treats a near-future timestamp as just now', () => {
    // Server and browser clocks disagree by a few seconds all the time. "in 3 seconds" for something
    // that just happened reads as a bug.
    expect(timeAgo(NOW + 5 * SECOND, NOW)).toBe('just now');
    expect(timeAgo(NOW + 30 * MINUTE, NOW)).toBe('just now');
  });

  test('singular and plural', () => {
    expect(timeAgo(ago(1 * MINUTE), NOW)).toBe('1 minute ago');
    expect(timeAgo(ago(2 * MINUTE), NOW)).toBe('2 minutes ago');
    expect(timeAgo(ago(1 * HOUR), NOW)).toBe('1 hour ago');
    expect(timeAgo(ago(5 * HOUR), NOW)).toBe('5 hours ago');
    expect(timeAgo(ago(1 * WEEK), NOW)).toBe('1 week ago');
    expect(timeAgo(ago(3 * WEEK), NOW)).toBe('3 weeks ago');
  });

  test('says yesterday rather than "1 days ago"', () => {
    expect(timeAgo(ago(25 * HOUR), NOW)).toBe('yesterday');
    expect(timeAgo(ago(47 * HOUR), NOW)).toBe('yesterday');
    expect(timeAgo(ago(49 * HOUR), NOW)).toBe('2 days ago');
  });

  test('switches to a month name once weeks stop being useful', () => {
    // "9 weeks ago" is arithmetic homework; a month name is instantly placeable.
    expect(timeAgo(ago(4 * WEEK), NOW)).toBe('4 weeks ago');
    expect(timeAgo(ago(6 * WEEK), NOW)).toMatch(/^in /);
  });

  test('adds the year only when it is not this year', () => {
    expect(timeAgo(new Date('2026-02-14T12:00:00Z'), NOW)).toBe('in February');
    expect(timeAgo(new Date('2025-11-02T12:00:00Z'), NOW)).toMatch(/^Nov 2025$/);
  });

  test('accepts a Date, a number, or an ISO string', () => {
    const when = ago(3 * DAY);
    expect(timeAgo(new Date(when), NOW)).toBe('3 days ago');
    expect(timeAgo(when, NOW)).toBe('3 days ago');
    expect(timeAgo(new Date(when).toISOString(), NOW)).toBe('3 days ago');
  });

  test('returns nothing for an unparseable value rather than "NaN ago"', () => {
    expect(timeAgo('not a date', NOW)).toBe('');
  });

  test('never has a gap: every offset up to a year produces a label', () => {
    for (let h = 0; h < 24 * 365; h += 7) {
      const label = timeAgo(ago(h * HOUR), NOW);
      expect(label, `offset ${h}h`).not.toBe('');
      expect(label).not.toMatch(/NaN|Invalid|undefined/);
    }
  });
});

/*
 * The short register, which the activity feed uses.
 *
 * It exists because a feed row cannot spare "23 hours ago" next to a name, an amount and a chevron.
 * It used to be a second copy of this file living in the group page; these are the cases where the
 * two had quietly drifted, so they are the ones worth holding.
 */
describe('timeAgoShort', () => {
  const shortAgo = (ms: number): string => timeAgoShort(NOW - ms, NOW);

  test('counts down to the same words for anything under a minute', () => {
    expect(shortAgo(30 * 1_000)).toBe('just now');
  });

  test('abbreviates the units', () => {
    expect(shortAgo(5 * 60_000)).toBe('5m ago');
    expect(shortAgo(23 * 3_600_000)).toBe('23h ago');
    expect(shortAgo(3 * 24 * 3_600_000)).toBe('3d ago');
    expect(shortAgo(3 * 7 * 24 * 3_600_000)).toBe('3w ago');
  });

  /*
   * The old copy rounded, so 90 minutes read as "2h ago" and 45 seconds as "just now" while this one
   * said "1h ago" and "just now" respectively. Flooring is the honest one: something that happened an
   * hour and a half ago has not happened two hours ago yet.
   */
  test('floors rather than rounds, so nothing is reported as older than it is', () => {
    expect(shortAgo(90 * 60_000)).toBe('1h ago');
    expect(shortAgo(59 * 60_000)).toBe('59m ago');
  });

  test('falls back to a date past a month', () => {
    expect(shortAgo(60 * 24 * 3_600_000)).toMatch(/Jun/);
  });

  test('says nothing for a timestamp it cannot read', () => {
    expect(timeAgoShort('not a date', NOW)).toBe('');
  });
});

/*
 * The calendar-day helpers, run from a zone west of UTC.
 *
 * This is where the bug lived and it is invisible from UTC: an expense dated "2026-08-24" is stored
 * as 2026-08-24T00:00:00Z, and formatting that instant in New York gives Aug 23. Every test here
 * pins the clock to a New York moment so a regression to local-time formatting fails rather than
 * passing on the CI box's TZ.
 */
describe('an expense date is a calendar day, not an instant', () => {
  // 2026-08-24 14:00 in New York (UTC-4) — the same wall-clock day as the stored UTC day.
  const NY_AUG_24 = new Date('2026-08-24T18:00:00.000Z');
  // 2026-08-23 22:00 in New York, which is already 2026-08-24 in UTC. The two calendars disagree.
  const NY_AUG_23_LATE = new Date('2026-08-24T02:00:00.000Z');

  const stored = (day: string): string => new Date(day).toISOString();

  it('spells out the day that was picked, not the one local time lands on', () => {
    expect(stored('2026-08-24')).toBe('2026-08-24T00:00:00.000Z');
    expect(fullDay(stored('2026-08-24'), { weekday: 'short', month: 'short', day: 'numeric' })).toBe(
      'Mon, Aug 24',
    );
  });

  it('calls an expense added today "today"', () => {
    expect(dayAgo(stored('2026-08-24'), NY_AUG_24)).toBe('today');
  });

  /*
   * The case that made the old code say "1d ago" about something entered minutes earlier. At 22:00
   * in New York the stored instant is already tomorrow in UTC, so any hours-elapsed arithmetic gets
   * the sign wrong. Counting calendar days off the string cannot.
   */
  it('still says "today" late in the evening, when UTC has already moved on', () => {
    expect(dayAgo(stored('2026-08-23'), NY_AUG_23_LATE)).toBe('today');
  });

  it('counts whole days back', () => {
    expect(dayAgo(stored('2026-08-23'), NY_AUG_24)).toBe('yesterday');
    expect(dayAgo(stored('2026-08-21'), NY_AUG_24)).toBe('3d ago');
    expect(dayAgo(stored('2026-08-10'), NY_AUG_24)).toBe('2w ago');
  });

  it('falls back to a date once the day count stops meaning anything', () => {
    expect(dayAgo(stored('2026-06-01'), NY_AUG_24)).toBe('Jun 1');
    expect(dayAgo(stored('2025-12-25'), NY_AUG_24)).toBe('Dec 25, 2025');
  });

  // Backdating is allowed but a future date is not, so this only guards against a bad clock.
  it('does not invent a negative day count', () => {
    expect(dayAgo(stored('2026-08-26'), NY_AUG_24)).toBe('Aug 26');
  });

  it('says nothing for a value that is not a date', () => {
    expect(dayAgo('', NY_AUG_24)).toBe('');
    expect(fullDay('not-a-date', { month: 'short' })).toBe('');
  });

  // The edit form has always been right, because it slices rather than parses. Same answer now.
  it('agrees with what the edit form prefills', () => {
    expect(expenseDay(stored('2026-08-24'))).toBe('2026-08-24');
  });
});
