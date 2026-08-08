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
  /**
   * Decides who absorbs the odd cent. Pass the expense id.
   *
   * Same reasoning as `computeSplit`'s seed, and it matters more here: a receipt is many small
   * amounts rather than one, so an unseeded run hands the leftover to the first person on every
   * uneven item *and* the tax and tip on top. Whoever happens to be listed first quietly pays a few
   * cents extra on every itemized bill.
   */
  seed?: string;
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
  const { items, taxCents = 0, tipCents = 0, seed } = input;
  // Per item, not one seed for the whole receipt: a single offset would land the leftover on the
  // same seat of every item, which is the bias this is here to remove, just rotated once.
  const itemSeed = (i: number): string | undefined => (seed === undefined ? undefined : `${seed}:${i}`);

  if (items.length === 0) {
    throw new SplitError('An itemized split needs at least one item');
  }
  assertNonNegativeInt(taxCents, 'Tax');
  assertNonNegativeInt(tipCents, 'Tip');

  const subtotalByUser = new Map<string, number>();
  let itemsTotal = 0;

  for (const [itemIndex, item] of items.entries()) {
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
      itemSeed(itemIndex),
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
    extraShares = allocateCents(extra, users.map(() => 1), seed === undefined ? undefined : `${seed}:extra`);
  } else {
    extraShares = allocateCents(
      extra,
      users.map((userId) => subtotalByUser.get(userId) ?? 0),
      seed === undefined ? undefined : `${seed}:extra`,
    );
  }

  return users.map((userId, i) => ({
    userId,
    owedCents: (subtotalByUser.get(userId) ?? 0) + (extraShares[i] ?? 0),
  }));
}

export interface ItemizedPayerItem {
  amountCents: number;
  /** Who paid for this line item. */
  payerId: string;
}

export interface ItemizedPaymentInput {
  items: readonly ItemizedPayerItem[];
  taxCents?: number;
  tipCents?: number;
}

export interface PayerShare {
  userId: string;
  paidCents: number;
}

/**
 * The credit side of a per-item-payer receipt: how much each distinct payer
 * actually put in. It's the sum of the items they paid for, plus a proportional
 * share of tax + tip (spread by their item subtotal, evenly if items total zero).
 * Mirrors computeItemizedSplit's rounding so credits and debits both sum to
 * items + tax + tip, to the penny.
 */
export function computeItemizedPayers(input: ItemizedPaymentInput): PayerShare[] {
  const { items, taxCents = 0, tipCents = 0 } = input;

  if (items.length === 0) {
    throw new SplitError('An itemized split needs at least one item');
  }
  assertNonNegativeInt(taxCents, 'Tax');
  assertNonNegativeInt(tipCents, 'Tip');

  const subtotalByPayer = new Map<string, number>();
  let itemsTotal = 0;
  for (const item of items) {
    assertNonNegativeInt(item.amountCents, 'Item amount');
    itemsTotal += item.amountCents;
    subtotalByPayer.set(item.payerId, (subtotalByPayer.get(item.payerId) ?? 0) + item.amountCents);
  }

  const payers = [...subtotalByPayer.keys()];
  const extra = taxCents + tipCents;

  let extraShares: number[];
  if (extra === 0) {
    extraShares = payers.map(() => 0);
  } else if (itemsTotal === 0) {
    extraShares = allocateCents(extra, payers.map(() => 1));
  } else {
    extraShares = allocateCents(
      extra,
      payers.map((p) => subtotalByPayer.get(p) ?? 0),
    );
  }

  return payers.map((userId, i) => ({
    userId,
    paidCents: (subtotalByPayer.get(userId) ?? 0) + (extraShares[i] ?? 0),
  }));
}
