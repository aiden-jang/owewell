import { describe, expect, it } from 'vitest';
import { changedFields, correctionLine, isCorrection, type ExpenseSnapshot } from './corrections';

/*
 * The tone matters as much as the diff here. An edit trail that reads as an accusation stops people
 * fixing their own typos, which leaves the group with wrong numbers and a suspicious-feeling app.
 */

const base: ExpenseSnapshot = {
  description: 'Dinner',
  amountCents: 4000,
  payerId: 'alice',
  splitMethod: 'EQUAL',
};
const after = (over: Partial<ExpenseSnapshot>): ExpenseSnapshot => ({ ...base, ...over });

describe('what counts as a correction', () => {
  it('says nothing when nothing changed', () => {
    // Re-saving the form untouched is not a correction, and a row for it is pure noise.
    expect(isCorrection(base, after({}))).toBe(false);
    expect(changedFields(base, after({}))).toEqual([]);
  });

  it('catches the four that move money or meaning', () => {
    expect(changedFields(base, after({ amountCents: 8000 }))).toEqual(['amount']);
    expect(changedFields(base, after({ description: 'Lunch' }))).toEqual(['description']);
    expect(changedFields(base, after({ payerId: 'bob' }))).toEqual(['payer']);
    expect(changedFields(base, after({ splitMethod: 'EXACT' }))).toEqual(['split']);
  });

  it('reports several at once, in a fixed order', () => {
    // Fixed so the sentence reads the same way twice, rather than following object key order.
    const changed = changedFields(base, after({ amountCents: 8000, payerId: 'bob', description: 'Lunch' }));
    expect(changed).toEqual(['amount', 'description', 'payer']);
  });

  it('ignores whitespace in the description', () => {
    // Trimming happens on save, so an untrimmed resubmit would otherwise log a change nobody made.
    expect(isCorrection(base, after({ description: '  Dinner ' }))).toBe(false);
  });

  it('treats a one-cent change as a correction', () => {
    // Small edits are exactly the ones worth a trace: they are the least likely to be noticed.
    expect(changedFields(base, after({ amountCents: 4001 }))).toEqual(['amount']);
  });
});

describe('how it reads', () => {
  const lines = [
    correctionLine(['amount'], 'Sam', '$40.00'),
    correctionLine(['description'], 'Sam', null),
    correctionLine(['payer'], 'Sam', null),
    correctionLine(['split'], 'Sam', null),
    correctionLine(['amount', 'payer'], 'Sam', '$40.00'),
    correctionLine([], 'Sam', null),
  ];

  it('names the person and the change', () => {
    expect(correctionLine(['amount'], 'Sam', '$40.00')).toBe('Sam changed the amount from $40.00.');
  });

  it('shows the old amount, since that is the actual question', () => {
    expect(correctionLine(['amount'], 'Sam', '$40.00')).toContain('$40.00');
  });

  it('reads properly when several things changed at once', () => {
    expect(correctionLine(['amount', 'payer'], 'Sam', '$40.00')).toBe(
      'Sam changed the amount from $40.00, and the payer.',
    );
    expect(correctionLine(['description', 'payer', 'split'], 'Sam', null)).toBe(
      'Sam changed the description, payer and split.',
    );
  });

  it('still says something sensible without an old amount to show', () => {
    // The formatter is the caller's, so a missing one must degrade rather than print "null".
    const line = correctionLine(['amount'], 'Sam', null);
    expect(line).not.toMatch(/null|undefined/);
    expect(line).toContain('amount');
  });

  /*
   * The rule this exists for.
   *
   * Almost every edit is somebody fixing their own typo. Copy that treats each one as suspicious would
   * make people stop correcting real mistakes, and the group ends up with wrong numbers instead.
   */
  it('never accuses anybody', () => {
    const accusing = /unauthorised|unauthorized|warning|alert|suspicious|without permission|tamper|illegal/i;
    for (const line of lines) expect(line, line).not.toMatch(accusing);
  });

  it('does not shout, and uses no em dashes', () => {
    for (const line of lines) {
      expect(line, line).not.toContain('!');
      expect(line, line).not.toMatch(/—/);
    }
  });

  it('always says who', () => {
    for (const line of lines) expect(line, line).toContain('Sam');
  });
});
