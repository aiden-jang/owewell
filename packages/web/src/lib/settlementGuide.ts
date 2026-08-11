import type { Balance } from './groups';
import type { SuggestedPayment } from './settlements';

export interface SettlementStepImpact {
  payment: SuggestedPayment;
  clearedNames: string[];
  remainingCents: number;
  remainingTransfers: number;
  percentOfOutstanding: number;
}

/** Explain what recording one of the generated transfers would do to the current ledger. */
export function settlementStepImpact(
  payment: SuggestedPayment,
  balances: Balance[],
  suggestions: SuggestedPayment[],
): SettlementStepImpact {
  const byId = new Map(balances.map((balance) => [balance.userId, balance]));
  const from = byId.get(payment.fromUserId);
  const to = byId.get(payment.toUserId);
  const clears = [
    from && from.netCents !== 0 && from.netCents + payment.amountCents === 0
      ? { name: from.displayName, role: 'payer' }
      : null,
    to && to.netCents !== 0 && to.netCents - payment.amountCents === 0
      ? { name: to.displayName, role: 'recipient' }
      : null,
  ].filter((entry): entry is { name: string; role: string } => entry !== null);
  const duplicateNames = clears.length > 1 && new Set(clears.map((entry) => entry.name)).size !== clears.length;
  const outstanding = balances.reduce((sum, balance) => sum + Math.max(0, balance.netCents), 0);

  return {
    payment,
    clearedNames: clears.map((entry) => duplicateNames ? `${entry.name} (${entry.role})` : entry.name),
    remainingCents: Math.max(0, outstanding - payment.amountCents),
    remainingTransfers: Math.max(0, suggestions.length - 1),
    percentOfOutstanding: outstanding > 0 ? Math.min(100, Math.round((payment.amountCents / outstanding) * 100)) : 0,
  };
}

/**
 * Pick the payment that removes the most people from the mental checklist.
 * Dollar impact breaks a tie, then the API order keeps the answer stable.
 */
export function bestSettlementStep(
  balances: Balance[],
  suggestions: SuggestedPayment[],
): SettlementStepImpact | null {
  const impacts = suggestions.map((payment) => settlementStepImpact(payment, balances, suggestions));
  return impacts.reduce<SettlementStepImpact | null>((best, candidate) => {
    if (!best) return candidate;
    if (candidate.clearedNames.length !== best.clearedNames.length) {
      return candidate.clearedNames.length > best.clearedNames.length ? candidate : best;
    }
    return candidate.payment.amountCents > best.payment.amountCents ? candidate : best;
  }, null);
}
