import { allocateCents } from './money.js';

export const SPLIT_METHODS = ['EQUAL', 'EXACT', 'PERCENT', 'SHARES'] as const;
export type SplitMethod = (typeof SPLIT_METHODS)[number];

export interface SplitParticipantInput {
  userId: string;
  /**
   * Meaning depends on the method:
   * - EXACT: cents this participant owes
   * - PERCENT: basis points (100 = 1%), all participants must sum to 10000
   * - SHARES: a positive integer weight
   * - EQUAL: ignored
   */
  value?: number;
}

export interface SplitShare {
  userId: string;
  owedCents: number;
}

/** Shared browser/server seed for previewed items whose expense IDs do not exist yet. */
export function quickSplitSeed(itemIndex: number): string {
  return `qs:${itemIndex}`;
}

export class SplitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SplitError';
  }
}

function requireValue(participant: SplitParticipantInput, label: string): number {
  if (participant.value === undefined) {
    throw new SplitError(`Missing ${label} for a participant`);
  }
  return participant.value;
}

function attach(participants: readonly SplitParticipantInput[], cents: readonly number[]): SplitShare[] {
  return participants.map((p, i) => ({ userId: p.userId, owedCents: cents[i] ?? 0 }));
}

/** Return shares summing to totalCents or throw SplitError for invalid input. */
export function computeSplit(
  method: SplitMethod,
  totalCents: number,
  participants: readonly SplitParticipantInput[],
  /**
   * Stable per-expense value that decides who absorbs the odd cent on an uneven split. Pass the
   * expense id. Without it, the first participant absorbs it every time, which reliably makes the
   * group owner owe a cent more per uneven bill.
   */
  seed?: string,
  roundingBalances?: ReadonlyMap<string, number>,
): SplitShare[] {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
    throw new SplitError('Total must be a non-negative integer number of cents');
  }
  if (participants.length === 0) {
    throw new SplitError('A split needs at least one participant');
  }
  const ids = participants.map((p) => p.userId);
  if (new Set(ids).size !== ids.length) {
    throw new SplitError('Participants must be unique');
  }

  switch (method) {
    case 'EQUAL': {
      const weights = participants.map(() => 1);
      if (!roundingBalances) return attach(participants, allocateCents(totalCents, weights, seed));

      const order = ids.map((_, index) => index);
      order.sort((a, b) => (roundingBalances.get(ids[a]!) ?? 0) - (roundingBalances.get(ids[b]!) ?? 0));
      const ranked = allocateCents(totalCents, weights);
      const cents = weights.map(() => 0);
      order.forEach((index, rank) => (cents[index] = ranked[rank]!));
      return attach(participants, cents);
    }

    case 'SHARES': {
      const weights = participants.map((p) => requireValue(p, 'share'));
      if (weights.some((w) => !Number.isInteger(w) || w <= 0)) {
        throw new SplitError('Each share must be a positive integer');
      }
      return attach(participants, allocateCents(totalCents, weights, seed));
    }

    case 'PERCENT': {
      const bips = participants.map((p) => requireValue(p, 'percentage'));
      if (bips.some((b) => !Number.isInteger(b) || b < 0)) {
        throw new SplitError('Each percentage must be a non-negative whole number of basis points');
      }
      if (bips.reduce((sum, b) => sum + b, 0) !== 10000) {
        throw new SplitError('Percentages must add up to 100%');
      }
      return attach(participants, allocateCents(totalCents, bips, seed));
    }

    case 'EXACT': {
      const cents = participants.map((p) => requireValue(p, 'amount'));
      if (cents.some((c) => !Number.isSafeInteger(c) || c < 0)) {
        throw new SplitError('Each exact amount must be a non-negative integer number of cents');
      }
      if (cents.reduce((sum, c) => sum + c, 0) !== totalCents) {
        throw new SplitError('Exact amounts must add up to the total');
      }
      return attach(participants, cents);
    }

    default: {
      const never: never = method;
      throw new SplitError(`Unknown split method: ${String(never)}`);
    }
  }
}

/** Keep existing equal-split recipients first when editing a bill for the same people. */
export function computeEditedSplit(
  method: SplitMethod,
  totalCents: number,
  participants: readonly SplitParticipantInput[],
  saved: { id: string; splitMethod: string; splits: readonly SplitShare[] },
): SplitShare[] {
  const previous = new Map(saved.splits.map((share) => [share.userId, -share.owedCents]));
  const keepPriority =
    method === 'EQUAL' &&
    saved.splitMethod === 'EQUAL' &&
    previous.size === participants.length &&
    participants.every(({ userId }) => previous.has(userId));
  return computeSplit(method, totalCents, participants, saved.id, keepPriority ? previous : undefined);
}
