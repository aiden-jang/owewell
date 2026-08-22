import { describe, expect, it } from 'vitest';
import { todayStr } from './format';
import { budgetDetail, budgetLine, budgetTone, tripBudget } from './tripBudget';
import { currencyFormatter } from '@owewell/shared';

/** Every assertion here is about the sentence, not the currency, so the formatter is a fixture. */
const usd = currencyFormatter('USD');

/* Half arithmetic, half tone. A budget bar that scolds is the easiest way to make this app feel
 * transactional, so the copy is asserted against its rules rather than exact strings. */

const day = (date: string, dollars: number) => ({ date, amountCents: Math.round(dollars * 100) });

describe('the arithmetic', () => {
  it('has nothing to say without a budget', () => {
    expect(tripBudget(null, [day('2026-08-01', 50)], 4)).toBeNull();
  });

  it('treats a zero or negative budget as no budget', () => {
    // A zero budget divides by zero for `used` and produces Infinity, which renders as a bar off the page.
    expect(tripBudget(0, [day('2026-08-01', 50)], 4)).toBeNull();
    expect(tripBudget(-500, [day('2026-08-01', 50)], 4)).toBeNull();
  });

  it('adds up what has been spent against it', () => {
    const budget = tripBudget(100_000, [day('2026-08-01', 300), day('2026-08-02', 200)], 4, new Date('2026-08-02T12:00:00Z'));
    expect(budget?.spentCents).toBe(50_000);
    expect(budget?.remainingCents).toBe(50_000);
    expect(budget?.used).toBeCloseTo(0.5);
  });

  it('goes negative rather than clamping, because going past the number is a real thing that happens', () => {
    const budget = tripBudget(10_000, [day('2026-08-01', 130)], 2, new Date('2026-08-01T12:00:00Z'));
    expect(budget?.remainingCents).toBe(-3_000);
    expect(budget?.used).toBeCloseTo(1.3);
  });

  it('divides by the people, not the payers', () => {
    // Four people on a trip where one person has paid for everything still spent it four ways.
    const budget = tripBudget(100_000, [day('2026-08-01', 400)], 4, new Date('2026-08-01T12:00:00Z'));
    expect(budget?.perPersonCents).toBe(10_000);
  });

  it('survives a group of one without dividing by zero', () => {
    const budget = tripBudget(10_000, [day('2026-08-01', 50)], 0, new Date('2026-08-01T12:00:00Z'));
    expect(budget?.perPersonCents).toBeNull();
  });

  it('has no daily rate on the first day, since it would just be the total again', () => {
    const budget = tripBudget(100_000, [day('2026-08-01', 300)], 4, new Date('2026-08-01T18:00:00Z'));
    expect(budget?.days).toBe(1);
    expect(budget?.perDayCents).toBeNull();
  });

  it('counts days inclusively, so a Monday-to-Wednesday trip is three days and not two', () => {
    const budget = tripBudget(
      100_000,
      [day('2026-08-03', 300), day('2026-08-05', 300)],
      4,
      new Date('2026-08-05T18:00:00Z'),
    );
    expect(budget?.days).toBe(3);
    expect(budget?.perDayCents).toBe(20_000);
  });

  // A group made three weeks before the trip would dilute the daily rate with three weeks of nothing.
  it('measures from the first expense, not from whenever the group was made', () => {
    const budget = tripBudget(
      100_000,
      [day('2026-08-10', 200), day('2026-08-11', 200)],
      4,
      new Date('2026-08-11T18:00:00Z'),
    );
    expect(budget?.days).toBe(2);
    expect(budget?.perDayCents).toBe(20_000);
  });

  /*
   * Expense dates are local and "today" was read off toISOString(), which is UTC: from 8pm in the
   * Americas a trip starting this evening reported two days and halved its rate. Checked across the
   * whole clock so it holds wherever the tests run.
   */
  it('calls an expense dated today one day, at every hour of the local day', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const now = new Date(2026, 7, 1, hour, 30);
      const budget = tripBudget(100_000, [{ date: todayStr(now), amountCents: 10_000 }], 4, now);
      expect(budget?.days, `${hour}:30 local`).toBe(1);
      expect(budget?.perDayCents, `${hour}:30 local`).toBeNull();
    }
  });

  it('does not let a late-evening expense drift a day under UTC', () => {
    // Dates are compared as YYYY-MM-DD strings for exactly this reason: parsing 2026-08-01 as a local
    // Date in a negative offset lands on 31 July and adds a phantom day to every trip.
    const budget = tripBudget(100_000, [day('2026-08-01', 100)], 4, new Date('2026-08-01T23:59:00Z'));
    expect(budget?.days).toBe(1);
  });

  it('survives an expense dated in the future, which the date field allows', () => {
    // Somebody paying for tomorrow's ferry today. An unclamped count reaches zero and the daily rate
    // divides by it, so the group is told it is spending Infinity a day.
    const budget = tripBudget(
      100_000,
      [day('2026-08-14', 200)],
      4,
      new Date(2026, 7, 12, 12, 0),
    );
    expect(budget?.days).toBe(1);
    expect(budget?.perDayCents).toBeNull();
    expect(budget?.spentCents).toBe(20_000);
  });

  it('ignores a malformed date rather than reporting a trip of NaN days', () => {
    const budget = tripBudget(100_000, [{ date: 'not-a-date', amountCents: 10_000 }], 4, new Date('2026-08-01T12:00:00Z'));
    expect(budget?.days).toBe(1);
    expect(budget?.spentCents).toBe(10_000);
  });
});

describe('the tone, which is the actual feature', () => {
  const fine = tripBudget(100_000, [day('2026-08-01', 200)], 4, new Date('2026-08-01T12:00:00Z'))!;
  const close = tripBudget(100_000, [day('2026-08-01', 850)], 4, new Date('2026-08-01T12:00:00Z'))!;
  const past = tripBudget(100_000, [day('2026-08-01', 1_300)], 4, new Date('2026-08-01T12:00:00Z'))!;
  const lines = [budgetLine(fine, usd), budgetLine(close, usd), budgetLine(past, usd)];

  it('warns before the number rather than telling anybody off after it', () => {
    expect(budgetTone(fine)).toBe('fine');
    expect(budgetTone(close)).toBe('close');
    expect(budgetTone(past)).toBe('past');
  });

  it('treats landing exactly on the number as not yet past it', () => {
    const exact = tripBudget(100_000, [day('2026-08-01', 1_000)], 4, new Date('2026-08-01T12:00:00Z'))!;
    expect(exact.remainingCents).toBe(0);
    expect(budgetTone(exact)).toBe('close');
  });

  it('never scolds', () => {
    // The vocabulary of every budgeting app that made people stop opening it.
    const scolding = /over budget|exceed|overspent|too much|warning|alert|careful|slow down|blown|busted/i;
    for (const line of lines) expect(line, line).not.toMatch(scolding);
  });

  it('does not shout, and uses no em dashes', () => {
    for (const line of lines) {
      expect(line, line).not.toContain('!');
      expect(line, line).not.toMatch(/—/);
    }
  });

  it('says what is true when the group has gone past the number, without a verdict', () => {
    const line = budgetLine(past, usd);
    expect(line).toContain('$300.00'); // how far past, stated plainly
    expect(line).toContain('$1,000.00'); // and the number they set
  });

  it('formats money as money rather than leaking cents', () => {
    for (const line of lines) expect(line, line).not.toMatch(/\d{5,}/);
  });

  it('gives every state a distinct sentence', () => {
    expect(new Set(lines).size).toBe(lines.length);
  });

  it('turns a frightening group total into the number a person can act on', () => {
    const detail = budgetDetail(past, usd);
    expect(detail).toContain('$325.00 each');
  });

  it('leaves out the daily rate rather than printing a placeholder for it', () => {
    expect(budgetDetail(fine, usd)).toBe('$50.00 each so far');
  });

  it('has no detail line at all for a group of one on day one', () => {
    const alone = tripBudget(10_000, [day('2026-08-01', 50)], 0, new Date('2026-08-01T12:00:00Z'))!;
    expect(budgetDetail(alone, usd)).toBeNull();
  });
});
