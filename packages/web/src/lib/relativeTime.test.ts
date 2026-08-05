import { describe, expect, test } from 'vitest';
import { timeAgo } from './relativeTime.js';

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
