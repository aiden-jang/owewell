import { allocateCents } from './money.js';
import { SplitError, type SplitShare } from './split.js';

export interface ItemizedItem {
  amountCents: number;
  participantIds: readonly string[];
}

export interface ItemizedInput {
  items: readonly ItemizedItem[];
  taxCents?: number;
  tipCents?: number;
}

function assertNonNegativeInt(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SplitError(`${label} must be a non-negative integer number of cents`);
  }
}

/**
 * Split an itemized receipt. Each line item is divided equally among the people on
 * it; tax and tip are then spread across everyone in proportion to what they ordered
 * (falling back to an even split if the items somehow total zero). The returned
 * shares always sum to items + tax + tip, to the penny.
 */
export function computeItemizedSplit(input: ItemizedInput): SplitShare[] {
  const { items, taxCents = 0, tipCents = 0 } = input;

  if (items.length === 0) {
    throw new SplitError('An itemized split needs at least one item');
  }
  assertNonNegativeInt(taxCents, 'Tax');
  assertNonNegativeInt(tipCents, 'Tip');

  const subtotalByUser = new Map<string, number>();
  let itemsTotal = 0;

  for (const item of items) {
    assertNonNegativeInt(item.amountCents, 'Item amount');
    if (item.participantIds.length === 0) {
      throw new SplitError('Every item needs at least one person on it');
    }
    if (new Set(item.participantIds).size !== item.participantIds.length) {
      throw new SplitError('An item lists the same person twice');
    }

    itemsTotal += item.amountCents;
    const shares = allocateCents(
      item.amountCents,
      item.participantIds.map(() => 1),
    );
    item.participantIds.forEach((userId, i) => {
      subtotalByUser.set(userId, (subtotalByUser.get(userId) ?? 0) + (shares[i] ?? 0));
    });
  }

  const users = [...subtotalByUser.keys()];
  const extra = taxCents + tipCents;

  let extraShares: number[];
  if (extra === 0) {
    extraShares = users.map(() => 0);
  } else if (itemsTotal === 0) {
    extraShares = allocateCents(extra, users.map(() => 1));
  } else {
    extraShares = allocateCents(
      extra,
      users.map((userId) => subtotalByUser.get(userId) ?? 0),
    );
  }

  return users.map((userId, i) => ({
    userId,
    owedCents: (subtotalByUser.get(userId) ?? 0) + (extraShares[i] ?? 0),
  }));
}
