import { computeItemizedSplit, computeSplit, type SplitMethod } from '@owe-well/shared';
import type { PrismaClient, SplitMethod as DbSplitMethod } from '@prisma/client';
import { requireMembership } from '../groups/groups.service.js';
import { emitGroupChanged } from '../../realtime/bus.js';

export type ExpenseErrorCode =
  | 'INVALID_PAYER'
  | 'INVALID_PARTICIPANT'
  | 'INVALID_SPLIT'
  | 'NOT_FOUND';

export class ExpenseError extends Error {
  constructor(
    readonly code: ExpenseErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ExpenseError';
  }
}

export interface CreateExpenseInput {
  description: string;
  amountCents: number;
  payerId: string;
  splitMethod: SplitMethod;
  participants: { userId: string; value?: number }[];
}

export interface ExpenseSplitView {
  userId: string;
  owedCents: number;
}

export interface ExpenseView {
  id: string;
  description: string;
  amountCents: number;
  payerId: string;
  splitMethod: DbSplitMethod;
  createdAt: Date;
  splits: ExpenseSplitView[];
}

export interface MemberBalance {
  userId: string;
  displayName: string;
  /** Positive: the group owes them. Negative: they owe the group. Always sums to zero. */
  netCents: number;
}

interface ExpenseRow {
  id: string;
  description: string;
  amountCents: number;
  payerId: string;
  splitMethod: DbSplitMethod;
  createdAt: Date;
  splits: { userId: string; owedCents: number }[];
}

function toExpenseView(expense: ExpenseRow): ExpenseView {
  return {
    id: expense.id,
    description: expense.description,
    amountCents: expense.amountCents,
    payerId: expense.payerId,
    splitMethod: expense.splitMethod,
    createdAt: expense.createdAt,
    splits: expense.splits.map((s) => ({ userId: s.userId, owedCents: s.owedCents })),
  };
}

async function groupMemberIds(prisma: PrismaClient, groupId: string): Promise<Set<string>> {
  const members = await prisma.groupMember.findMany({ where: { groupId }, select: { userId: true } });
  return new Set(members.map((m) => m.userId));
}

export async function createExpense(
  prisma: PrismaClient,
  userId: string,
  groupId: string,
  input: CreateExpenseInput,
): Promise<ExpenseView> {
  await requireMembership(prisma, userId, groupId);

  const memberIds = await groupMemberIds(prisma, groupId);
  if (!memberIds.has(input.payerId)) {
    throw new ExpenseError('INVALID_PAYER', 'The payer must be a member of the group.');
  }
  if (input.participants.some((p) => !memberIds.has(p.userId))) {
    throw new ExpenseError('INVALID_PARTICIPANT', 'Every participant must be a member of the group.');
  }

  let shares;
  try {
    shares = computeSplit(input.splitMethod, input.amountCents, input.participants);
  } catch (err) {
    throw new ExpenseError('INVALID_SPLIT', err instanceof Error ? err.message : 'Invalid split.');
  }

  const valueByUser = new Map(input.participants.map((p) => [p.userId, p.value]));

  const expense = await prisma.expense.create({
    data: {
      groupId,
      payerId: input.payerId,
      createdById: userId,
      description: input.description,
      amountCents: input.amountCents,
      splitMethod: input.splitMethod,
      splits: {
        create: shares.map((s) => ({
          userId: s.userId,
          owedCents: s.owedCents,
          inputValue: valueByUser.get(s.userId) ?? null,
        })),
      },
    },
    include: { splits: true },
  });

  emitGroupChanged(groupId);
  return toExpenseView(expense);
}

export interface CreateItemizedExpenseInput {
  description: string;
  payerId: string;
  taxCents: number;
  tipCents: number;
  items: { name: string; amountCents: number; participantIds: string[] }[];
}

export async function createItemizedExpense(
  prisma: PrismaClient,
  userId: string,
  groupId: string,
  input: CreateItemizedExpenseInput,
): Promise<ExpenseView> {
  await requireMembership(prisma, userId, groupId);

  const memberIds = await groupMemberIds(prisma, groupId);
  if (!memberIds.has(input.payerId)) {
    throw new ExpenseError('INVALID_PAYER', 'The payer must be a member of the group.');
  }
  const everyone = new Set(input.items.flatMap((item) => item.participantIds));
  if ([...everyone].some((id) => !memberIds.has(id))) {
    throw new ExpenseError('INVALID_PARTICIPANT', 'Everyone on an item must be a group member.');
  }

  let shares;
  try {
    shares = computeItemizedSplit({
      items: input.items.map((item) => ({
        amountCents: item.amountCents,
        participantIds: item.participantIds,
      })),
      taxCents: input.taxCents,
      tipCents: input.tipCents,
    });
  } catch (err) {
    throw new ExpenseError('INVALID_SPLIT', err instanceof Error ? err.message : 'Invalid split.');
  }

  const amountCents =
    input.items.reduce((sum, item) => sum + item.amountCents, 0) + input.taxCents + input.tipCents;

  const expense = await prisma.expense.create({
    data: {
      groupId,
      payerId: input.payerId,
      createdById: userId,
      description: input.description,
      amountCents,
      splitMethod: 'ITEMIZED',
      taxCents: input.taxCents,
      tipCents: input.tipCents,
      splits: { create: shares.map((s) => ({ userId: s.userId, owedCents: s.owedCents })) },
      items: {
        create: input.items.map((item) => ({
          name: item.name,
          amountCents: item.amountCents,
          shares: { create: item.participantIds.map((uid) => ({ userId: uid })) },
        })),
      },
    },
    include: { splits: true },
  });

  emitGroupChanged(groupId);
  return toExpenseView(expense);
}

/** Soft-delete an expense. Any member can remove an expense from the shared ledger. */
export async function deleteExpense(
  prisma: PrismaClient,
  userId: string,
  groupId: string,
  expenseId: string,
): Promise<void> {
  await requireMembership(prisma, userId, groupId);
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, groupId, deletedAt: null },
    select: { id: true },
  });
  if (!expense) {
    throw new ExpenseError('NOT_FOUND', 'That expense is already gone.');
  }
  await prisma.expense.update({ where: { id: expenseId }, data: { deletedAt: new Date() } });
  emitGroupChanged(groupId);
}

export async function listExpenses(
  prisma: PrismaClient,
  userId: string,
  groupId: string,
): Promise<ExpenseView[]> {
  await requireMembership(prisma, userId, groupId);
  const expenses = await prisma.expense.findMany({
    where: { groupId, deletedAt: null },
    include: { splits: true },
    orderBy: { createdAt: 'desc' },
  });
  return expenses.map(toExpenseView);
}

/**
 * Net position per member from all live expenses: a payer is credited the full
 * amount they fronted, and every participant is debited their share. The result
 * always sums to zero. (Settlements fold in during the settle-up phase.)
 */
export async function getBalances(
  prisma: PrismaClient,
  userId: string,
  groupId: string,
): Promise<MemberBalance[]> {
  await requireMembership(prisma, userId, groupId);

  const members = await prisma.groupMember.findMany({
    where: { groupId },
    include: { user: true },
    orderBy: { joinedAt: 'asc' },
  });
  const net = new Map<string, number>(members.map((m) => [m.userId, 0]));

  const expenses = await prisma.expense.findMany({
    where: { groupId, deletedAt: null },
    include: { splits: true },
  });
  for (const expense of expenses) {
    net.set(expense.payerId, (net.get(expense.payerId) ?? 0) + expense.amountCents);
    for (const split of expense.splits) {
      net.set(split.userId, (net.get(split.userId) ?? 0) - split.owedCents);
    }
  }

  // A recorded payment moves the payer toward zero (they settled a debt) and the
  // recipient toward zero (they were repaid).
  const settlements = await prisma.settlement.findMany({
    where: { groupId },
    select: { fromUserId: true, toUserId: true, amountCents: true },
  });
  for (const s of settlements) {
    net.set(s.fromUserId, (net.get(s.fromUserId) ?? 0) + s.amountCents);
    net.set(s.toUserId, (net.get(s.toUserId) ?? 0) - s.amountCents);
  }

  return members.map((m) => ({
    userId: m.userId,
    displayName: m.user.displayName,
    netCents: net.get(m.userId) ?? 0,
  }));
}
