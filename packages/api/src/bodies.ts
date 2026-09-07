import { z } from 'zod';
import { EXPENSE_CATEGORY_KEYS, PAYMENT_METHODS } from '@owewell/core';

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const category = z.enum(EXPENSE_CATEGORY_KEYS as [string, ...string[]]).optional();
// A line of context, not a document. Empty string clears it, which is what an emptied field sends.
export const note = z.string().trim().max(280).nullish();
export const createExpenseBody = z.object({
  description: z.string().trim().min(1).max(140),
  amountCents: z.number().int().positive(),
  payerId: z.string().min(1),
  splitMethod: z.enum(['EQUAL', 'EXACT', 'PERCENT', 'SHARES']),
  participants: z.array(z.object({ userId: z.string().min(1), value: z.number().int().optional() })).min(1),
  category,
  note,
  // Opaque to us; the browser generates it. Bounded so it cannot be used as a smuggled payload.
  clientId: z.string().min(8).max(64).optional(),
  // Only meaningful on an edit: the version the change was written against.
  expectedVersion: z.number().int().positive().optional(),
  date: isoDate.optional(),
});

export const itemizedBody = z.object({
  description: z.string().trim().min(1).max(140),
  payerId: z.string().min(1),
  taxCents: z.number().int().nonnegative().default(0),
  tipCents: z.number().int().nonnegative().default(0),
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(140),
        amountCents: z.number().int().positive(),
        participantIds: z.array(z.string().min(1)).min(1),
        payerId: z.string().min(1).optional(),
      }),
    )
    .min(1),
  category,
  note,
  clientId: z.string().min(8).max(64).optional(),
  // Only meaningful on an edit: the version the change was written against.
  expectedVersion: z.number().int().positive().optional(),
  date: isoDate.optional(),
});

export const recordSettlementBody = z.object({
  fromUserId: z.string().min(1),
  toUserId: z.string().min(1),
  amountCents: z.number().int().positive(),
  method: z.enum(PAYMENT_METHODS).optional(),
  clientId: z.string().min(8).max(64).optional(),
});

export const quickSplitBody = z.object({
  people: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(80),
        isPayer: z.boolean().optional(),
        isYou: z.boolean().optional(),
      }),
    )
    .min(2)
    .max(50),
  items: z
    .array(
      z.object({
        description: z.string().trim().max(140).default(''),
        amountCents: z.number().int().positive(),
        splitMethod: z.enum(['EQUAL', 'EXACT', 'PERCENT', 'SHARES']),
        // Per-person values aligned to `people`; null for EQUAL / no value.
        values: z.array(z.number().int().nullable()).optional(),
        // Index into `people` of who paid for this item; omitted → default payer.
        payerIndex: z.number().int().nonnegative().optional(),
      }),
    )
    .min(1)
    .max(50),
});
