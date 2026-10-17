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
  /** Stable per-expense tie-break seed for item, tax, and tip remainders. */
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
    extraShares = allocateCents(
      extra,
      users.map(() => 1),
      seed === undefined ? undefined : `${seed}:extra`,
    );
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
  /** Stable credit tie-break seed; credits are recomputed on every balance read. */
  seed?: string;
}

export interface PayerShare {
  userId: string;
  paidCents: number;
}

/** Credit each payer their items plus proportional tax/tip; zero-subtotal receipts split extras evenly.
 * Credits and debits must both conserve the receipt total. */
export function computeItemizedPayers(input: ItemizedPaymentInput): PayerShare[] {
  const { items, taxCents = 0, tipCents = 0, seed } = input;
  const extraSeed = seed === undefined ? undefined : `${seed}:extra`;

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
    extraShares = allocateCents(
      extra,
      payers.map(() => 1),
      extraSeed,
    );
  } else {
    extraShares = allocateCents(
      extra,
      payers.map((p) => subtotalByPayer.get(p) ?? 0),
      extraSeed,
    );
  }

  return payers.map((userId, i) => ({
    userId,
    paidCents: (subtotalByPayer.get(userId) ?? 0) + (extraShares[i] ?? 0),
  }));
}
