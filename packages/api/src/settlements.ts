import { namedTransfers } from '@owewell/shared';
import type { PaymentMethod } from '@owewell/core';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { DB } from './db/client.js';
import { requireMembership } from './groups.js';
import { computeBalances, getBalances } from './balances.js';
import { groupMembers, groups, settlements } from './db/schema.js';

export type SettlementErrorCode =
  'INVALID_PARTICIPANT' | 'SAME_PARTY' | 'NOT_FOUND' | 'STALE_SUGGESTION' | 'LEGACY_PAYMENT_REVIEW';

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
  method?: PaymentMethod | undefined;
  /** Client-chosen id, so a payment recorded offline and sent later is logged exactly once. */
  clientId?: string | undefined;
  suggestedVersion?: number | undefined;
  reviewRequired?: true | undefined;
}

function settlementView(row: typeof settlements.$inferSelect): SettlementView {
  return {
    id: row.id,
    fromUserId: row.fromPersonId,
    toUserId: row.toPersonId,
    amountCents: row.amountCents,
    method: (row.method as PaymentMethod | null) ?? null,
    createdAt: row.createdAt,
  };
}

function settlementByClientId(db: DB, groupId: string, clientId: string) {
  return db
    .select()
    .from(settlements)
    .where(and(eq(settlements.groupId, groupId), eq(settlements.clientId, clientId)))
    .get();
}

/** Record a payment between two members. */
export async function recordSettlement(
  db: DB,
  personId: string,
  groupId: string,
  input: RecordSettlementInput,
): Promise<SettlementView> {
  await requireMembership(db, personId, groupId);

  // Payments append a historical fact; retain the client ID so outbox replay cannot record it twice.
  if (input.clientId) {
    const already = await settlementByClientId(db, groupId, input.clientId);
    if (already) return settlementView(already);
  }

  if (input.reviewRequired) {
    throw new SettlementError(
      'LEGACY_PAYMENT_REVIEW',
      'Review this older payment before sending it to the ledger.',
    );
  }
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
    for (const balance of await computeBalances(db, groupId)) {
      if (balance.former && balance.netCents !== 0) ids.add(balance.userId);
    }
    if (!ids.has(input.fromUserId) || !ids.has(input.toUserId)) {
      throw new SettlementError(
        'INVALID_PARTICIPANT',
        'Both people must be members of the group or appear in its ledger.',
      );
    }
  }

  const id = crypto.randomUUID();
  const createdAt = new Date();
  const insert = db.insert(settlements);
  const write =
    input.suggestedVersion === undefined
      ? insert.values({
          id,
          groupId,
          fromPersonId: input.fromUserId,
          toPersonId: input.toUserId,
          amountCents: input.amountCents,
          method: input.method ?? null,
          createdById: personId,
          createdAt,
          clientId: input.clientId ?? null,
        })
      : insert.select(
          db
            .select({
              id: sql`${id}`.as('id'),
              groupId: groups.id,
              fromPersonId: sql`${input.fromUserId}`.as('from_person_id'),
              toPersonId: sql`${input.toUserId}`.as('to_person_id'),
              amountCents: sql`${input.amountCents}`.as('amount_cents'),
              method: sql`${input.method ?? null}`.as('method'),
              createdById: sql`${personId}`.as('created_by_id'),
              createdAt: sql`${Math.floor(createdAt.getTime() / 1000)}`.as('created_at'),
              clientId: sql`${input.clientId ?? null}`.as('client_id'),
            })
            .from(groups)
            .where(and(eq(groups.id, groupId), eq(groups.ledgerVersion, input.suggestedVersion))),
        );
  const [created] = await write
    .onConflictDoNothing({ target: [settlements.groupId, settlements.clientId] })
    .returning();
  if (created) return settlementView(created);
  const existing = input.clientId && (await settlementByClientId(db, groupId, input.clientId));
  if (existing) return settlementView(existing);
  if (input.suggestedVersion !== undefined) {
    throw new SettlementError(
      'STALE_SUGGESTION',
      'Group balances changed. Review them before recording this payment.',
    );
  }
  throw new Error('Could not read the recorded payment.');
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

export async function deleteSettlement(
  db: DB,
  personId: string,
  groupId: string,
  settlementId: string,
): Promise<void> {
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
export async function getSuggestedPayments(
  db: DB,
  personId: string,
  groupId: string,
): Promise<SuggestedPayment[]> {
  const balances = await getBalances(db, personId, groupId);
  return namedTransfers(balances);
}
