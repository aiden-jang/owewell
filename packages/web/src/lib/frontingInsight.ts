import type { Balance } from '@owewell/core';

export interface FrontingShare {
  userId: string;
  displayName: string;
  paidCents: number;
  percent: number;
}

export interface FrontingInsight {
  shares: FrontingShare[];
  leader: FrontingShare;
  nextPayer: FrontingShare | null;
  concentrated: boolean;
}

/**
 * Describe who has physically fronted the group's expenses, independently of who ultimately owes.
 * This is a social-load hint, not another balance: settlements intentionally do not affect it.
 */
export function frontingInsight(balances: Balance[], expenseCount: number): FrontingInsight | null {
  const totalPaid = balances.reduce((sum, balance) => sum + Math.max(0, balance.paidCents), 0);
  const involved = balances.filter((balance) => balance.paidCents > 0 || balance.owedCents > 0);
  if (totalPaid <= 0 || involved.length < 2) return null;

  const shares = involved
    .map((balance) => ({
      userId: balance.userId,
      displayName: balance.displayName,
      paidCents: balance.paidCents,
      percent: (balance.paidCents / totalPaid) * 100,
    }))
    .sort((a, b) => b.paidCents - a.paidCents || a.displayName.localeCompare(b.displayName));
  const leader = shares[0]!;
  // Three expenses keeps a single dinner from producing advice. Sixty percent is meaningfully above
  // even for a pair, while the +20 point check keeps larger groups from being flagged too eagerly.
  const fairShare = 100 / involved.length;
  const concentrated = expenseCount >= 3 && leader.percent >= 60 && leader.percent - fairShare >= 20;
  const nextPayer = concentrated
    ? ([...shares]
        .filter((share) => share.userId !== leader.userId)
        .sort((a, b) => a.paidCents - b.paidCents || a.displayName.localeCompare(b.displayName))[0] ?? null)
    : null;

  return { shares, leader, nextPayer, concentrated };
}
