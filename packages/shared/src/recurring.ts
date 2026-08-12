/**
 * A rule proposes, never creates: silent generation starts an argument that being right about the
 * schedule does not win. Plain year-month-day, never a Date, or the 1st lands on the 30th for half a group.
 */

export type Cadence = 'weekly' | 'monthly';

export const CADENCES: readonly Cadence[] = ['weekly', 'monthly'];

/** A calendar date with no time and no zone. */
export interface Ymd {
  y: number;
  m: number;
  d: number;
}

export class RecurringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecurringError';
  }
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseYmd(iso: string): Ymd {
  const match = ISO.exec(iso);
  if (!match) throw new RecurringError(`Not a YYYY-MM-DD date: ${iso}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12) throw new RecurringError(`No month ${m}`);
  if (d < 1 || d > daysInMonth(y, m)) throw new RecurringError(`No day ${d} in ${y}-${m}`);
  return { y, m, d };
}

export function formatYmd({ y, m, d }: Ymd): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function daysInMonth(y: number, m: number): number {
  // Day 0 of the next month is the last day of this one, and Date.UTC handles the leap-year rule.
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Ordering only. Not a timestamp, and never handed to anything that formats it. */
function ordinal({ y, m, d }: Ymd): number {
  return Date.UTC(y, m - 1, d);
}

export function compareYmd(a: Ymd, b: Ymd): number {
  return ordinal(a) - ordinal(b);
}

function addDays(date: Ymd, days: number): Ymd {
  const shifted = new Date(ordinal(date) + days * 86_400_000);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth() + 1, d: shifted.getUTCDate() };
}

/** Measured from the anchor, never the previous date: stepping "one month on" makes a 31st rule drift
 *  permanently (31 Jan, 28 Feb, 28 Mar) until rent is due on the 28th forever. */
function monthlyOccurrence(startY: number, startM: number, anchorDay: number, n: number): Ymd {
  const absolute = startM - 1 + n;
  const y = startY + Math.floor(absolute / 12);
  const m = (absolute % 12) + 1;
  return { y, m, d: Math.min(anchorDay, daysInMonth(y, m)) };
}

export interface RecurringRule {
  cadence: Cadence;
  /** First date the rule applies, and the anchor every later occurrence is measured from. */
  startsOn: string;
  /** Skipping advances this too. A skip that left it alone re-proposes the same month forever. */
  lastHandledOn: string | null;
}

/** Two years away should not return twenty-four rent proposals. `truncated` says the older ones were
 *  dropped rather than pretending they never came due. */
export const MAX_PROPOSALS = 6;

export interface DueOccurrences {
  /** Dates that are due and not yet handled, oldest first. */
  dates: string[];
  /** True when older overdue occurrences were dropped to stay under the cap. */
  truncated: boolean;
}

/** Newest first past the cap: a two-year-old rent proposal is archaeology, this month's is a bill. */
export function dueOccurrences(rule: RecurringRule, today: string): DueOccurrences {
  const now = parseYmd(today);
  const start = parseYmd(rule.startsOn);
  const handled = rule.lastHandledOn ? parseYmd(rule.lastHandledOn) : null;

  if (compareYmd(start, now) > 0) return { dates: [], truncated: false };

  const all: Ymd[] = [];
  // Bounded by the cap plus what it takes to walk past `handled`, so a rule that started in 1970
  // cannot spin: the loop stops at the first occurrence after today.
  const LOOP_LIMIT = 5000;
  for (let n = 0; n < LOOP_LIMIT; n++) {
    const occurrence =
      rule.cadence === 'weekly' ? addDays(start, n * 7) : monthlyOccurrence(start.y, start.m, start.d, n);
    if (compareYmd(occurrence, now) > 0) break;
    if (handled && compareYmd(occurrence, handled) <= 0) continue;
    all.push(occurrence);
  }

  const truncated = all.length > MAX_PROPOSALS;
  return { dates: all.slice(-MAX_PROPOSALS).map(formatYmd), truncated };
}

/** About the schedule, not the group's inbox: independent of what has been handled. */
export function nextOccurrenceAfter(rule: Pick<RecurringRule, 'cadence' | 'startsOn'>, from: string): string {
  const after = parseYmd(from);
  const start = parseYmd(rule.startsOn);
  if (compareYmd(start, after) > 0) return rule.startsOn;

  const LOOP_LIMIT = 5000;
  for (let n = 0; n < LOOP_LIMIT; n++) {
    const occurrence =
      rule.cadence === 'weekly' ? addDays(start, n * 7) : monthlyOccurrence(start.y, start.m, start.d, n);
    if (compareYmd(occurrence, after) > 0) return formatYmd(occurrence);
  }
  throw new RecurringError('Could not find the next occurrence');
}

/** "every month on the 1st", "every week on Tuesday" — how a rule reads in a sentence. */
export function cadenceLabel(rule: Pick<RecurringRule, 'cadence' | 'startsOn'>): string {
  const start = parseYmd(rule.startsOn);
  if (rule.cadence === 'weekly') {
    const weekday = new Date(ordinal(start)).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    return `every week on ${weekday}`;
  }
  return `every month on the ${withOrdinalSuffix(start.d)}`;
}

function withOrdinalSuffix(day: number): string {
  // 11th, 12th and 13th are the exceptions that catch every naive version of this.
  if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`;
  const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[day % 10] ?? 'th';
  return `${day}${suffix}`;
}
