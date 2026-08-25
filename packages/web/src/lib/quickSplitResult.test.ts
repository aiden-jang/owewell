import { describe, expect, it } from 'vitest';
import { computeQuickSplit } from './quickSplitResult';
import type { DraftItem, DraftPerson } from './quickSplitDraft';

/**
 * The only money math in this app that runs in the browser.
 *
 * `@owewell/shared` covers the primitives and the group page gets its numbers from the server, so
 * this path — a whole split computed client-side and shown as an answer — shipped with no tests at
 * all while it lived inline in a nine-hundred-line render.
 *
 * The cases that matter are the ones where the preview could disagree with what saving produces:
 * the odd cent, a payer who is no longer in the split, and a half-typed form.
 */

const p = (id: string, name: string): DraftPerson => ({ id, name });
const item = (over: Partial<DraftItem> = {}): DraftItem => ({
  id: 'i1', description: 'Dinner', amount: '30', values: {}, method: 'EQUAL', payerId: '', ...over,
});

const run = (over: Partial<Parameters<typeof computeQuickSplit>[0]> = {}) =>
  computeQuickSplit({
    people: [p('a', 'Alice'), p('b', 'Bob'), p('c', 'Cara')],
    items: [item()],
    payerId: 'a', youId: 'a', splitPayers: false,
    ...over,
  });

describe('an ordinary split', () => {
  it('names the fewest transfers that settle it', () => {
    const r = run();
    expect(r.grandTotal).toBe(3_000);
    expect(r.transfers).toHaveLength(2);
    expect(r.transfers?.every((t) => t.toUserId === 'a')).toBe(true);
  });

  it('tells the payer their own share, which the transfer list cannot', () => {
    // Alice paid all $30 and appears in no transfer, so this is the only place her $10 shows up.
    expect(run().yourShareCents).toBe(1_000);
  });

  it('adds up to the total, odd cent included', () => {
    const r = run({ items: [item({ amount: '10' })] });
    const owed = Object.values(r.sharesByPerson ?? {});
    expect(owed.reduce((a, b) => a + b, 0)).toBe(1_000);
    // $10 three ways cannot be equal; largest-remainder puts the extra cent somewhere, once.
    expect(owed.sort()).toEqual([333, 333, 334]);
  });
});

describe('what it refuses to answer', () => {
  it.each([
    ['no items with an amount', { items: [item({ amount: '' })] }],
    ['an amount that is not a number', { items: [item({ amount: 'abc' })] }],
    ['nobody named yet', { people: [p('a', ''), p('b', '')] }],
    ['a percent split that is not a number', { items: [item({ method: 'PERCENT' as const, values: { a: 'half' } })] }],
  ])('returns no transfers for %s', (_label, over) => {
    expect(run(over).transfers).toBeNull();
  });

  // A half-typed form is the normal state of this screen, so it shows nothing rather than an error.
  it('keeps the running total even when there is no answer yet', () => {
    const r = run({ items: [item({ amount: '30' }), item({ id: 'i2', amount: '' })] });
    expect(r.grandTotal).toBe(3_000);
    expect(r.transfers).not.toBeNull();
  });
});

describe('who counts as the payer', () => {
  it('falls back to the first named person when the selection is blank', () => {
    expect(run({ payerId: '' }).effectivePayerId).toBe('a');
  });

  /*
   * The case that would otherwise diverge from saving: somebody picks a payer, then removes them.
   * The save path falls back to the default payer, so the preview has to as well.
   */
  it('falls back when the chosen payer has been removed', () => {
    const r = run({ payerId: 'gone' });
    expect(r.effectivePayerId).toBe('a');
    expect(r.transfers?.every((t) => t.toUserId === 'a')).toBe(true);
  });

  it('honours a per-item payer when items are paid separately', () => {
    const r = run({
      splitPayers: true,
      items: [item({ amount: '30', payerId: 'b' })],
    });
    // Bob fronted it, so everyone owes Bob.
    expect(r.transfers?.every((t) => t.toUserId === 'b')).toBe(true);
  });

  it('ignores a per-item payer who is no longer in the split', () => {
    const r = run({ splitPayers: true, items: [item({ amount: '30', payerId: 'gone' })] });
    expect(r.transfers?.every((t) => t.toUserId === 'a')).toBe(true);
  });
});

/*
 * The seed is taken from the item's position among the items that will actually be SENT, not its
 * index in the array. Blank rows are dropped on save, so counting them here would hand the odd cent
 * to a different person than the saved group does.
 */
describe('the odd cent, against what saving will do', () => {
  it('does not shift when a blank row sits above a real one', () => {
    const withBlank = run({ items: [item({ id: 'blank', amount: '' }), item({ id: 'real', amount: '10' })] });
    const withoutBlank = run({ items: [item({ id: 'real', amount: '10' })] });
    expect(withBlank.sharesByPerson).toEqual(withoutBlank.sharesByPerson);
  });
});
