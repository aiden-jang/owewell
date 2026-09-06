import type { Balance } from './groups';
import type { Settlement, SuggestedPayment } from './settlements';

export interface ReceiptBalanceChange {
  userId: string;
  name: string;
  beforeCents: number;
  afterCents: number;
}

export interface SettlementReceiptData {
  settlement: Settlement;
  fromName: string;
  toName: string;
  changes: ReceiptBalanceChange[];
  clearedNames: string[];
  remainingTransfers: number;
  remainingCents: number;
}

/**
 * The receipt, or null once the payment it explains is gone.
 *
 * It is a snapshot of one payment against the balances of the moment it was recorded, so undoing that
 * payment leaves a card describing something that did not happen -- including its loudest line,
 * "Everyone is settled".
 */
export function liveReceipt(
  receipt: SettlementReceiptData | null,
  settlements: readonly Settlement[],
): SettlementReceiptData | null {
  if (!receipt) return null;
  return settlements.some((s) => s.id === receipt.settlement.id) ? receipt : null;
}

/** Turn a ledger refresh into a compact explanation of what one payment actually changed. */
export function buildSettlementReceipt(
  settlement: Settlement,
  before: Balance[],
  after: Balance[],
  remaining: SuggestedPayment[],
): SettlementReceiptData {
  const beforeById = new Map(before.map((balance) => [balance.userId, balance]));
  const afterById = new Map(after.map((balance) => [balance.userId, balance]));
  const participantIds = [settlement.fromUserId, settlement.toUserId];
  const changes = participantIds.map((userId) => {
    const earlier = beforeById.get(userId);
    const latest = afterById.get(userId);
    return {
      userId,
      name: latest?.displayName ?? earlier?.displayName ?? 'Someone',
      beforeCents: earlier?.netCents ?? 0,
      afterCents: latest?.netCents ?? 0,
    };
  });

  return {
    settlement,
    fromName: changes[0]?.name ?? 'Someone',
    toName: changes[1]?.name ?? 'Someone',
    changes,
    clearedNames: changes
      .filter((change) => change.beforeCents !== 0 && change.afterCents === 0)
      .map((change) => change.name),
    remainingTransfers: remaining.length,
    remainingCents: remaining.reduce((sum, payment) => sum + payment.amountCents, 0),
  };
}
