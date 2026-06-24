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

/**
 * Turn a split definition into the exact cents each participant owes.
 *
 * Whatever the method, the returned shares always sum back to `totalCents`
 * (EQUAL/SHARES/PERCENT lean on the largest-remainder allocator; EXACT is
 * validated to sum exactly). Throws SplitError on any invalid input.
 */
export function computeSplit(
  method: SplitMethod,
  totalCents: number,
  participants: readonly SplitParticipantInput[],
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
    case 'EQUAL':
      return attach(participants, allocateCents(totalCents, participants.map(() => 1)));

    case 'SHARES': {
      const weights = participants.map((p) => requireValue(p, 'share'));
      if (weights.some((w) => !Number.isInteger(w) || w <= 0)) {
        throw new SplitError('Each share must be a positive integer');
      }
      return attach(participants, allocateCents(totalCents, weights));
    }

    case 'PERCENT': {
      const bips = participants.map((p) => requireValue(p, 'percentage'));
      if (bips.some((b) => !Number.isInteger(b) || b < 0)) {
        throw new SplitError('Each percentage must be a non-negative whole number of basis points');
      }
      if (bips.reduce((sum, b) => sum + b, 0) !== 10000) {
        throw new SplitError('Percentages must add up to 100%');
      }
      return attach(participants, allocateCents(totalCents, bips));
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
