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
