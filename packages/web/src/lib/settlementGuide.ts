import type { Balance } from './groups';
import type { SuggestedPayment } from './settlements';
import { simplifyDebts } from '@owewell/shared';

export interface SettlementStepImpact {
  payment: SuggestedPayment;
  clearedNames: string[];
  remainingCents: number;
  remainingTransfers: number;
  percentOfOutstanding: number;
}

export interface ProjectedBalance {
  userId: string;
  displayName: string;
  beforeCents: number;
  afterCents: number;
  becomesSettled: boolean;
}

export interface PaymentPlanPreview {
  touched: ProjectedBalance[];
  remaining: SuggestedPayment[];
  outstandingBeforeCents: number;
  outstandingAfterCents: number;
  direction: 'helpful' | 'overpay' | 'wrong-way';
}

/** Re-run the whole settle-up plan in memory after an arbitrary payment. */
export function previewPaymentPlan(
  payment: SuggestedPayment,
  balances: Balance[],
): PaymentPlanPreview | null {
  const from = balances.find(balance => balance.userId === payment.fromUserId);
  const to = balances.find(balance => balance.userId === payment.toUserId);
  if (!from || !to || from.userId === to.userId || payment.amountCents <= 0) return null;

  const projected = balances.map(balance => ({
    ...balance,
    netCents: balance.userId === from.userId
      ? balance.netCents + payment.amountCents
      : balance.userId === to.userId
        ? balance.netCents - payment.amountCents
        : balance.netCents,
  }));
  const names = new Map(balances.map(balance => [balance.userId, balance.displayName]));
  const remaining = simplifyDebts(projected.map(balance => ({ userId: balance.userId, netCents: balance.netCents })))
    .map(transfer => ({
      ...transfer,
      fromName: names.get(transfer.fromUserId) ?? 'Someone',
      toName: names.get(transfer.toUserId) ?? 'Someone',
    }));
  const usefulLimit = Math.min(Math.max(0, -from.netCents), Math.max(0, to.netCents));

  return {
    touched: projectBalancesAfterPayment(payment, balances),
    remaining,
    outstandingBeforeCents: balances.reduce((sum, balance) => sum + Math.max(0, balance.netCents), 0),
    outstandingAfterCents: projected.reduce((sum, balance) => sum + Math.max(0, balance.netCents), 0),
    direction: usefulLimit === 0
      ? 'wrong-way'
      : payment.amountCents > usefulLimit
        ? 'overpay'
        : 'helpful',
  };
}

/** Preview only the two balances a payment touches; no ledger state is mutated. */
export function projectBalancesAfterPayment(
  payment: SuggestedPayment,
  balances: Balance[],
): ProjectedBalance[] {
  return balances
    .filter(balance => balance.userId === payment.fromUserId || balance.userId === payment.toUserId)
    .map(balance => {
      const afterCents = balance.userId === payment.fromUserId
        ? balance.netCents + payment.amountCents
        : balance.netCents - payment.amountCents;
      return {
        userId: balance.userId,
        displayName: balance.displayName,
        beforeCents: balance.netCents,
        afterCents,
        becomesSettled: balance.netCents !== 0 && afterCents === 0,
      };
    });
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
