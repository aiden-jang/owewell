import { describe, expect, test } from 'vitest';
import { pulseLabel, spendingPulse } from './spendingPulse';

const now = new Date(2026, 7, 11);

describe('spendingPulse', () => {
  test('compares the current and previous calendar months', () => {
    const pulse = spendingPulse([
      { date: '2026-08-03', amountCents: 15000 },
      { date: '2026-08-10', amountCents: 5000 },
      { date: '2026-07-20', amountCents: 10000 },
    ], now);
    expect(pulse).toEqual({ currentCents: 20000, previousCents: 10000, change: 'up', percent: 100 });
    expect(pulseLabel(pulse!)).toBe('100% more than last month');
  });

  test('reports a complete drop when this month has no spend', () => {
    const pulse = spendingPulse([{ date: '2026-07-20', amountCents: 8000 }], now);
    expect(pulse).toMatchObject({ change: 'down', percent: -100 });
  });

  test('does not invent a percentage without a prior-month baseline', () => {
    const pulse = spendingPulse([{ date: '2026-08-01', amountCents: 2500 }], now);
    expect(pulse).toMatchObject({ change: 'new', percent: null });
    expect(pulseLabel(pulse!)).toBe('nothing last month');
  });

  test('ignores older months and returns null when both comparison months are empty', () => {
    expect(spendingPulse([{ date: '2026-06-30', amountCents: 9999 }], now)).toBeNull();
  });

  test('handles the January boundary', () => {
    const pulse = spendingPulse([
      { date: '2027-01-02', amountCents: 7500 },
      { date: '2026-12-31', amountCents: 10000 },
    ], new Date(2027, 0, 5));
    expect(pulse).toMatchObject({ change: 'down', percent: -25 });
  });
});
