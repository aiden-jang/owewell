import { describe, expect, test } from 'vitest';
import fc from 'fast-check';
import {
  cadenceLabel,
  daysInMonth,
  dueOccurrences,
  formatYmd,
  MAX_PROPOSALS,
  nextOccurrenceAfter,
  parseYmd,
  RecurringError,
  type RecurringRule,
} from './recurring.js';

const monthly = (startsOn: string, lastHandledOn: string | null = null): RecurringRule => ({
  cadence: 'monthly',
  startsOn,
  lastHandledOn,
});
const weekly = (startsOn: string, lastHandledOn: string | null = null): RecurringRule => ({
  cadence: 'weekly',
  startsOn,
  lastHandledOn,
});

describe('date handling', () => {
  test('rejects anything that is not a real calendar date', () => {
    for (const bad of ['2026-13-01', '2026-00-05', '2026-02-30', '2026-2-1', '20260201', '', 'today']) {
      expect(() => parseYmd(bad)).toThrow(RecurringError);
    }
  });

  test('accepts February 29 only in a leap year', () => {
    expect(parseYmd('2028-02-29').d).toBe(29);
    expect(() => parseYmd('2027-02-29')).toThrow(RecurringError);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28); // divisible by 100, not 400
  });
});

describe('monthly rules', () => {
  test('comes due on the same day each month', () => {
    const { dates } = dueOccurrences(monthly('2026-01-01'), '2026-03-01');
    expect(dates).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
  });

  /*
   * The bug this whole module is shaped around.
   *
   * Stepping "one month on" from the previous occurrence makes a rule set for the 31st drift down the
   * calendar permanently the first time it meets February: 31 Jan, 28 Feb, 28 Mar, and by summer the
   * rent is due on the 28th forever. Anchoring on the start day means February borrows the 28th once
   * and March gets its 31st back.
   */
  test('borrows a shorter month without drifting afterwards', () => {
    const { dates } = dueOccurrences(monthly('2026-01-31'), '2026-05-31');
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });

  test('uses the 29th in a leap February', () => {
    const { dates } = dueOccurrences(monthly('2028-01-31'), '2028-03-31');
    expect(dates).toEqual(['2028-01-31', '2028-02-29', '2028-03-31']);
  });

  test('rolls over the year end', () => {
    const { dates } = dueOccurrences(monthly('2026-11-15', '2026-11-15'), '2027-01-15');
    expect(dates).toEqual(['2026-12-15', '2027-01-15']);
  });

  test('proposes nothing before it starts', () => {
    expect(dueOccurrences(monthly('2026-09-01'), '2026-08-31').dates).toEqual([]);
  });

  test('proposes nothing when this month is already handled', () => {
    expect(dueOccurrences(monthly('2026-01-01', '2026-03-01'), '2026-03-15').dates).toEqual([]);
  });
});

describe('weekly rules', () => {
  test('comes due every seven days', () => {
    const { dates } = dueOccurrences(weekly('2026-08-04'), '2026-08-25');
    expect(dates).toEqual(['2026-08-04', '2026-08-11', '2026-08-18', '2026-08-25']);
  });

  test('crosses a month boundary without slipping a weekday', () => {
    const { dates } = dueOccurrences(weekly('2026-08-25'), '2026-09-08');
    expect(dates).toEqual(['2026-08-25', '2026-09-01', '2026-09-08']);
    const weekdays = new Set(dates.map((d) => new Date(`${d}T00:00:00Z`).getUTCDay()));
    expect(weekdays.size).toBe(1);
  });
});

describe('coming back after a long time away', () => {
  test('caps the proposals and says it dropped some', () => {
    // Two years of unopened rent should not greet somebody with 24 cards.
    const result = dueOccurrences(monthly('2024-01-01'), '2026-01-01');
    expect(result.dates).toHaveLength(MAX_PROPOSALS);
    expect(result.truncated).toBe(true);
  });

  test('keeps the newest, because an old one is archaeology and this month is a bill', () => {
    const result = dueOccurrences(monthly('2024-01-01'), '2026-01-01');
    expect(result.dates.at(-1)).toBe('2026-01-01');
    expect(result.dates[0]).toBe('2025-08-01');
  });

  test('does not claim truncation when everything fits', () => {
    expect(dueOccurrences(monthly('2026-01-01'), '2026-02-01').truncated).toBe(false);
  });

  test('terminates on a rule that started decades ago', () => {
    const result = dueOccurrences(monthly('1970-01-31'), '2026-08-11');
    expect(result.dates).toHaveLength(MAX_PROPOSALS);
  });
});

describe('the next one', () => {
  test('looks past today', () => {
    expect(nextOccurrenceAfter(monthly('2026-01-01'), '2026-03-01')).toBe('2026-04-01');
  });

  test('is the start date when the rule has not begun', () => {
    expect(nextOccurrenceAfter(monthly('2026-12-01'), '2026-08-11')).toBe('2026-12-01');
  });

  test('clamps like the schedule does', () => {
    expect(nextOccurrenceAfter(monthly('2026-01-31'), '2026-02-01')).toBe('2026-02-28');
  });
});

describe('how a rule reads', () => {
  test('names the weekday or the day of the month', () => {
    expect(cadenceLabel(weekly('2026-08-04'))).toBe('every week on Tuesday');
    expect(cadenceLabel(monthly('2026-08-01'))).toBe('every month on the 1st');
  });

  test('gets the awkward ordinals right', () => {
    const on = (d: number) => cadenceLabel(monthly(`2026-01-${String(d).padStart(2, '0')}`));
    expect(on(1)).toContain('1st');
    expect(on(2)).toContain('2nd');
    expect(on(3)).toContain('3rd');
    expect(on(4)).toContain('4th');
    // The three everybody's first version of this gets wrong.
    expect(on(11)).toContain('11th');
    expect(on(12)).toContain('12th');
    expect(on(13)).toContain('13th');
    expect(on(21)).toContain('21st');
    expect(on(22)).toContain('22nd');
    expect(on(23)).toContain('23rd');
  });
});

describe('invariants', () => {
  test('a monthly rule never drifts off its anchor day, whatever month it lands in', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2024, max: 2030 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 31 }),
        fc.integer({ min: 1, max: 40 }),
        (y, m, anchor, months) => {
          fc.pre(anchor <= daysInMonth(y, m));
          const startsOn = formatYmd({ y, m, d: anchor });
          const end = new Date(Date.UTC(y, m - 1 + months, 1));
          const today = formatYmd({
            y: end.getUTCFullYear(),
            m: end.getUTCMonth() + 1,
            d: daysInMonth(end.getUTCFullYear(), end.getUTCMonth() + 1),
          });

          for (const iso of dueOccurrences({ cadence: 'monthly', startsOn, lastHandledOn: null }, today).dates) {
            const { y: oy, m: om, d: od } = parseYmd(iso);
            // Either the anchor day, or the last day of a month too short to hold it. Never anything
            // in between, which is what drift looks like.
            expect(od === anchor || od === daysInMonth(oy, om)).toBe(true);
            expect(od).toBeLessThanOrEqual(anchor);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  test('occurrences come out in order and never repeat', () => {
    fc.assert(
      fc.property(fc.constantFrom('weekly' as const, 'monthly' as const), fc.integer({ min: 1, max: 28 }), (cadence, day) => {
        const { dates } = dueOccurrences(
          { cadence, startsOn: `2026-01-${String(day).padStart(2, '0')}`, lastHandledOn: null },
          '2026-06-30',
        );
        expect([...dates]).toEqual([...dates].sort());
        expect(new Set(dates).size).toBe(dates.length);
      }),
      { numRuns: 100 },
    );
  });

  test('handling the newest proposal always clears the queue', () => {
    fc.assert(
      fc.property(fc.constantFrom('weekly' as const, 'monthly' as const), fc.integer({ min: 1, max: 28 }), (cadence, day) => {
        const startsOn = `2026-01-${String(day).padStart(2, '0')}`;
        const today = '2026-05-15';
        const first = dueOccurrences({ cadence, startsOn, lastHandledOn: null }, today);
        if (first.dates.length === 0) return;
        // Accepting or skipping the latest must leave nothing behind, or the card never goes away.
        const after = dueOccurrences({ cadence, startsOn, lastHandledOn: first.dates.at(-1)! }, today);
        expect(after.dates).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });
});
