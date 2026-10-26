import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearQuickSplitDraft,
  readQuickSplitDraft,
  writeQuickSplitDraft,
  type DraftItem,
  type DraftPerson,
} from './quickSplitDraft';

/**
 * What it takes to trust a draft off disk.
 *
 * This is the one piece of quick split with no account behind it: the value comes from
 * localStorage, which anything on the origin can write and an older build of this app definitely
 * did. Every branch below is a shape that must be refused rather than half-restored, and none of it
 * had a test while it lived inside a thousand-line page component.
 */

const KEY = 'owewell:quick-split-draft';

const person = (id: string, name: string): DraftPerson => ({ id, name });
const item = (over: Partial<DraftItem> = {}): DraftItem => ({
  id: 'i1',
  description: 'Dinner',
  amount: '80',
  values: {},
  method: 'EQUAL',
  payerId: 'p1',
  ...over,
});

const store = (draft: unknown): void => localStorage.setItem(KEY, JSON.stringify(draft));
const valid = {
  version: 1,
  savedAt: Date.now(),
  people: [person('p1', 'You'), person('p2', 'Mara')],
  items: [item()],
  payerId: 'p1',
  splitPayers: false,
  youId: 'p1',
};

beforeEach(() => localStorage.clear());

describe('restoring a draft', () => {
  it('returns one that is intact', () => {
    store(valid);
    expect(readQuickSplitDraft()?.people).toHaveLength(2);
  });

  it('round-trips what it wrote', () => {
    writeQuickSplitDraft({
      people: valid.people,
      items: valid.items,
      payerId: 'p1',
      splitPayers: true,
      youId: 'p2',
    });
    expect(readQuickSplitDraft()).toMatchObject({ splitPayers: true, youId: 'p2' });
  });

  it('forgets one on clear', () => {
    store(valid);
    clearQuickSplitDraft();
    expect(readQuickSplitDraft()).toBeNull();
  });
});

describe('drafts it refuses', () => {
  it.each([
    ['nothing stored', null],
    ['a future version', { ...valid, version: 2 }],
    ['no timestamp', { ...valid, savedAt: 'yesterday' }],
    ['people that is not a list', { ...valid, people: 'two' }],
    ['items that is not a list', { ...valid, items: {} }],
  ])('refuses %s', (_label, draft) => {
    if (draft !== null) store(draft);
    expect(readQuickSplitDraft()).toBeNull();
  });

  // A week. The clock is injectable so this does not depend on wall time.
  it('refuses one older than a week', () => {
    const eightDays = 8 * 24 * 60 * 60 * 1000;
    store({ ...valid, savedAt: Date.now() - eightDays });
    expect(readQuickSplitDraft()).toBeNull();
    expect(readQuickSplitDraft(Date.now() - eightDays + 1000)).not.toBeNull();
  });

  /*
   * The half-valid cases, which are the reason this validates field by field rather than casting.
   * A draft that restores one of two people looks like it worked and quietly loses somebody.
   */
  it('refuses a draft whose people do not survive checking', () => {
    store({ ...valid, people: [person('p1', 'You'), { id: 'p2' }] });
    expect(readQuickSplitDraft()).toBeNull();
  });

  it('refuses the whole bill if an item has an unknown split method', () => {
    store({ ...valid, items: [item(), item({ id: 'i2', method: 'VIBES' as never })] });
    expect(readQuickSplitDraft()).toBeNull();
  });

  it.each([
    ['one invalid person among three', { people: [...valid.people, { id: 'p3' }] }],
    ['duplicate people', { people: [...valid.people, person('p2', 'Another Mara')] }],
    ['duplicate items', { items: [item(), item()] }],
    ['an empty person ID', { people: [person('', 'You'), person('p2', 'Mara')] }],
    ['array values', { items: [item({ values: ['50', '50'] as never })] }],
  ])('refuses %s without silently changing the bill', (_label, fields) => {
    store({ ...valid, ...fields });
    expect(readQuickSplitDraft()).toBeNull();
  });

  it('refuses when nothing usable is left', () => {
    store({ ...valid, items: [item({ method: 'VIBES' as never })] });
    expect(readQuickSplitDraft()).toBeNull();
  });

  it('survives a value that is not JSON at all', () => {
    localStorage.setItem(KEY, 'not json {');
    expect(readQuickSplitDraft()).toBeNull();
  });
});
