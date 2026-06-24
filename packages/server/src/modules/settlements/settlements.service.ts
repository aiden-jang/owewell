import { simplifyDebts } from '@owe-well/shared';
import type { PrismaClient } from '@prisma/client';
import { requireMembership } from '../groups/groups.service.js';
import { getBalances } from '../expenses/expenses.service.js';
import { emitGroupChanged } from '../../realtime/bus.js';

export type SettlementErrorCode = 'INVALID_PARTICIPANT' | 'SAME_PARTY';

export class SettlementError extends Error {
  constructor(
    readonly code: SettlementErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SettlementError';
  }
}

export interface SettlementView {
  id: string;
  fromUserId: string;
  toUserId: string;
  amountCents: number;
  createdAt: Date;
}

export interface SuggestedPayment {
  fromUserId: string;
  fromName: string;
  toUserId: string;
  toName: string;
  amountCents: number;
}

interface SettlementRow {
  id: string;
  fromUserId: string;
  toUserId: string;
  amountCents: number;
  createdAt: Date;
}

function toView(row: SettlementRow): SettlementView {
  return {
    id: row.id,
    fromUserId: row.fromUserId,
    toUserId: row.toUserId,
    amountCents: row.amountCents,
    createdAt: row.createdAt,
  };
}

export async function recordSettlement(
  prisma: PrismaClient,
  userId: string,
  groupId: string,
  input: { fromUserId: string; toUserId: string; amountCents: number },
): Promise<SettlementView> {
  await requireMembership(prisma, userId, groupId);

  if (input.fromUserId === input.toUserId) {
    throw new SettlementError('SAME_PARTY', 'A payment needs two different people.');
  }

  const members = await prisma.groupMember.findMany({ where: { groupId }, select: { userId: true } });
  const ids = new Set(members.map((m) => m.userId));
  if (!ids.has(input.fromUserId) || !ids.has(input.toUserId)) {
    throw new SettlementError('INVALID_PARTICIPANT', 'Both people must be members of the group.');
  }

  const settlement = await prisma.settlement.create({
    data: {
      groupId,
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      amountCents: input.amountCents,
      createdById: userId,
    },
  });
  emitGroupChanged(groupId);
  return toView(settlement);
}

export async function listSettlements(
  prisma: PrismaClient,
  userId: string,
  groupId: string,
): Promise<SettlementView[]> {
  await requireMembership(prisma, userId, groupId);
  const rows = await prisma.settlement.findMany({
    where: { groupId },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toView);
}

/** The shortest set of "who should pay whom" to clear the current balances. */
export async function getSuggestedPayments(
  prisma: PrismaClient,
  userId: string,
  groupId: string,
): Promise<SuggestedPayment[]> {
  const balances = await getBalances(prisma, userId, groupId);
  const nameByUser = new Map(balances.map((b) => [b.userId, b.displayName]));
  const transfers = simplifyDebts(balances.map((b) => ({ userId: b.userId, netCents: b.netCents })));
  return transfers.map((t) => ({
    fromUserId: t.fromUserId,
    fromName: nameByUser.get(t.fromUserId) ?? 'Someone',
    toUserId: t.toUserId,
    toName: nameByUser.get(t.toUserId) ?? 'Someone',
    amountCents: t.amountCents,
  }));
}
