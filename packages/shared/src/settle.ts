export interface NetBalance {
  userId: string;
  /** Positive: owed to them. Negative: they owe. The set must sum to zero. */
  netCents: number;
}

export interface Transfer {
  fromUserId: string;
  toUserId: string;
  amountCents: number;
}

export class SettleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettleError';
  }
}

/** Greedily match the largest debtor and creditor using positive whole cents.
 * The transfers clear all balances but need not be the theoretical minimum. */
export function simplifyDebts(balances: readonly NetBalance[]): Transfer[] {
  const total = balances.reduce((sum, b) => sum + b.netCents, 0);
  if (total !== 0) {
    throw new SettleError(`Balances must net to zero, got ${total}`);
  }

  const creditors = balances
    .filter((b) => b.netCents > 0)
    .map((b) => ({ userId: b.userId, amount: b.netCents }))
    .sort((a, b) => b.amount - a.amount);
  const debtors = balances
    .filter((b) => b.netCents < 0)
    .map((b) => ({ userId: b.userId, amount: -b.netCents }))
    .sort((a, b) => b.amount - a.amount);

  const transfers: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    if (!debtor || !creditor) break;

    const pay = Math.min(debtor.amount, creditor.amount);
    if (pay > 0) {
      transfers.push({ fromUserId: debtor.userId, toUserId: creditor.userId, amountCents: pay });
    }
    debtor.amount -= pay;
    creditor.amount -= pay;
    if (debtor.amount === 0) i += 1;
    if (creditor.amount === 0) j += 1;
  }

  return transfers;
}
