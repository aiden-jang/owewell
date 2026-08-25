import { todayStr } from './format';

/**
 * "3 days ago", "2 weeks ago", "in March".
 *
 * Deliberately vague and deliberately not `Intl.RelativeTimeFormat` alone. What matters on a dashboard
 * is "is this group still alive", so the useful answers are today / this week / a few weeks / a while
 * back. An exact "17 days ago" is precision nobody asked for, and a bare date makes you do the
 * arithmetic yourself.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * @param at   when it happened
 * @param now  injected so this is testable without freezing the clock
 */
export function timeAgo(at: Date | string | number, now: Date | number = Date.now()): string {
  const then = at instanceof Date ? at.getTime() : typeof at === 'string' ? Date.parse(at) : at;
  const nowMs = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(then)) return '';

  const diff = nowMs - then;

  // Clock skew between server and browser can put a fresh timestamp slightly in the future. "in 3
  // seconds" for something that just happened reads as a bug, so anything near-future is "just now".
  if (diff < MINUTE) return 'just now';

  if (diff < HOUR) {
    const mins = Math.floor(diff / MINUTE);
    return `${mins} ${mins === 1 ? 'minute' : 'minutes'} ago`;
  }
  if (diff < DAY) {
    const hours = Math.floor(diff / HOUR);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  if (diff < 2 * DAY) return 'yesterday';
  if (diff < WEEK) return `${Math.floor(diff / DAY)} days ago`;
  if (diff < 5 * WEEK) {
    const weeks = Math.floor(diff / WEEK);
    return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
  }

  // Past a month, a month name is friendlier than "9 weeks ago" and easier to place. The year only
  // appears once it isn't this year, so recent months stay short.
  const d = new Date(then);
  const sameYear = d.getFullYear() === new Date(nowMs).getFullYear();
  return sameYear
    ? `in ${d.toLocaleString(undefined, { month: 'long' })}`
    : `${d.toLocaleString(undefined, { month: 'short' })} ${d.getFullYear()}`;
}

/** The same answer, short enough for a dense row: "5m ago" rather than "5 minutes ago". */
export function timeAgoShort(at: Date | string | number, now: Date | number = Date.now()): string {
  const then = at instanceof Date ? at.getTime() : typeof at === 'string' ? Date.parse(at) : at;
  const nowMs = now instanceof Date ? now.getTime() : now;
  if (!Number.isFinite(then)) return '';

  const diff = nowMs - then;
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < WEEK) return `${Math.floor(diff / DAY)}d ago`;
  if (diff < 5 * WEEK) return `${Math.floor(diff / WEEK)}w ago`;

  // Past a month a date places it better than a count of weeks, and it stays about as short.
  const d = new Date(then);
  const sameYear = d.getFullYear() === new Date(nowMs).getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/*
 * An expense's date is a calendar day, not a moment.
 *
 * An <input type="date"> gives "2026-08-24" in the user's calendar and the API stores it as UTC
 * midnight. Formatting that instant in local time lands on the previous day anywhere west of UTC,
 * so a New York user adding an expense today sees yesterday's date on it.
 *
 * So these work on the date string and never build a Date from the stored instant. `slice(0, 10)`
 * recovers the day that was picked, whatever zone the reader is in.
 */

/** The stored day, as the YYYY-MM-DD the user originally chose. */
export function expenseDay(iso: string): string {
  return iso.slice(0, 10);
}

const dayNumber = (ymd: string): number =>
  Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / DAY;

/** "today" / "yesterday" / "3d ago", counted in whole days rather than elapsed hours. */
export function dayAgo(iso: string, now: Date | number = Date.now()): string {
  const day = expenseDay(iso);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  const today = todayStr(now instanceof Date ? now : new Date(now));
  const diff = dayNumber(today) - dayNumber(day);

  if (diff === 0) return 'today';
  if (diff === 1) return 'yesterday';
  if (diff < 0) return fullDay(iso, { month: 'short', day: 'numeric' });
  if (diff < 7) return `${diff}d ago`;
  if (diff < 35) return `${Math.floor(diff / 7)}w ago`;

  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  return fullDay(iso, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** The day spelled out. UTC, because that is the zone the picked day was stored in. */
export function fullDay(iso: string, options: Intl.DateTimeFormatOptions): string {
  const day = expenseDay(iso);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString(undefined, { ...options, timeZone: 'UTC' });
}
