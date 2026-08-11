import { simplifyDebts } from '@owewell/shared';
import type { PaymentMethod } from '@owewell/core';
import { and, desc, eq } from 'drizzle-orm';
import type { DB } from './db/client.js';
import { requireMembership } from './groups.js';
import { getBalances } from './expenses.js';
import { groupMembers, groups, settlements } from './db/schema.js';

export type SettlementErrorCode = 'INVALID_PARTICIPANT' | 'SAME_PARTY' | 'NOT_FOUND';

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
  method: PaymentMethod | null;
  createdAt: Date;
}

export interface SuggestedPayment {
  fromUserId: string;
  fromName: string;
  toUserId: string;
  toName: string;
  amountCents: number;
}

export interface RecordSettlementInput {
  fromUserId: string;
  toUserId: string;
  amountCents: number;
  method?: PaymentMethod;
}

export async function recordSettlement(
  db: DB,
  personId: string,
  groupId: string,
  input: RecordSettlementInput,
): Promise<SettlementView> {
  await requireMembership(db, personId, groupId);

  if (input.fromUserId === input.toUserId) {
    throw new SettlementError('SAME_PARTY', 'A payment needs two different people.');
  }
  const rows = await db
    .select({ personId: groupMembers.personId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))
    .all();
  const ids = new Set(rows.map((r) => r.personId));
  if (!ids.has(input.fromUserId) || !ids.has(input.toUserId)) {
    throw new SettlementError('INVALID_PARTICIPANT', 'Both people must be members of the group.');
  }

  const id = crypto.randomUUID();
  const createdAt = new Date();
  await db.insert(settlements).values({
    id,
    groupId,
    fromPersonId: input.fromUserId,
    toPersonId: input.toUserId,
    amountCents: input.amountCents,
    method: input.method ?? null,
    createdById: personId,
    createdAt,
  });
  const remaining = await getBalances(db, personId, groupId);
  if (remaining.every((balance) => balance.netCents === 0)) {
    await db.update(groups).set({ settleBy: null }).where(eq(groups.id, groupId));
  }
  return {
    id,
    fromUserId: input.fromUserId,
    toUserId: input.toUserId,
    amountCents: input.amountCents,
    method: input.method ?? null,
    createdAt,
  };
}

export async function listSettlements(db: DB, personId: string, groupId: string): Promise<SettlementView[]> {
  await requireMembership(db, personId, groupId);
  const rows = await db
    .select()
    .from(settlements)
    .where(eq(settlements.groupId, groupId))
    .orderBy(desc(settlements.createdAt))
    .all();
  return rows.map((r) => ({
    id: r.id,
    fromUserId: r.fromPersonId,
    toUserId: r.toPersonId,
    amountCents: r.amountCents,
    method: (r.method as PaymentMethod | null) ?? null,
    createdAt: r.createdAt,
  }));
}

export async function deleteSettlement(db: DB, personId: string, groupId: string, settlementId: string): Promise<void> {
  await requireMembership(db, personId, groupId);
  const row = await db
    .select({ id: settlements.id })
    .from(settlements)
    .where(and(eq(settlements.id, settlementId), eq(settlements.groupId, groupId)))
    .get();
  if (!row) throw new SettlementError('NOT_FOUND', 'That payment no longer exists.');
  await db.delete(settlements).where(eq(settlements.id, settlementId));
}

/** The shortest set of "who should pay whom" to clear the current balances. */
export async function getSuggestedPayments(db: DB, personId: string, groupId: string): Promise<SuggestedPayment[]> {
  const balances = await getBalances(db, personId, groupId);
  const nameByPerson = new Map(balances.map((b) => [b.userId, b.displayName]));
  const transfers = simplifyDebts(balances.map((b) => ({ userId: b.userId, netCents: b.netCents })));
  return transfers.map((t) => ({
    fromUserId: t.fromUserId,
    fromName: nameByPerson.get(t.fromUserId) ?? 'Someone',
    toUserId: t.toUserId,
    toName: nameByPerson.get(t.toUserId) ?? 'Someone',
    amountCents: t.amountCents,
  }));
}
