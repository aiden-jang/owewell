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
