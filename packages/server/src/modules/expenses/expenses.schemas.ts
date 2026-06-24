import { z } from 'zod';

const participant = z.object({
  userId: z.string().min(1),
  // EXACT: cents, PERCENT: basis points, SHARES: weight; omitted for EQUAL.
  value: z.number().int().nonnegative().optional(),
});

export const createExpenseBody = z.object({
  description: z.string().trim().min(1, 'What was it for?').max(140),
  amountCents: z.number().int().positive(),
  payerId: z.string().min(1),
  splitMethod: z.enum(['EQUAL', 'EXACT', 'PERCENT', 'SHARES']),
  participants: z.array(participant).min(1),
});

export type CreateExpenseBody = z.infer<typeof createExpenseBody>;

const itemizedItem = z.object({
  name: z.string().trim().min(1).max(140),
  amountCents: z.number().int().positive(),
  participantIds: z.array(z.string().min(1)).min(1),
});

export const createItemizedExpenseBody = z.object({
  description: z.string().trim().min(1, 'What was it for?').max(140),
  payerId: z.string().min(1),
  taxCents: z.number().int().nonnegative().default(0),
  tipCents: z.number().int().nonnegative().default(0),
  items: z.array(itemizedItem).min(1),
});

export type CreateItemizedExpenseBody = z.infer<typeof createItemizedExpenseBody>;
