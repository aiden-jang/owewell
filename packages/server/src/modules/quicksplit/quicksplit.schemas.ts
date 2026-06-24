import { z } from 'zod';

const participant = z.object({
  name: z.string().trim().min(1).max(80),
  // EXACT: cents, PERCENT: basis points, SHARES: weight; omitted for EQUAL.
  value: z.number().int().nonnegative().optional(),
  isPayer: z.boolean().optional(),
  // Marks which person is the saving user (maps to their real account, not a placeholder).
  isYou: z.boolean().optional(),
});

export const createQuickSplitBody = z.object({
  description: z.string().trim().max(140).default('Quick split'),
  amountCents: z.number().int().positive(),
  splitMethod: z.enum(['EQUAL', 'EXACT', 'PERCENT', 'SHARES']),
  participants: z.array(participant).min(1),
});

export type CreateQuickSplitBody = z.infer<typeof createQuickSplitBody>;
