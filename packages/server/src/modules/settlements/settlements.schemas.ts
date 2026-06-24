import { z } from 'zod';

export const recordSettlementBody = z.object({
  fromUserId: z.string().min(1),
  toUserId: z.string().min(1),
  amountCents: z.number().int().positive(),
});

export type RecordSettlementBody = z.infer<typeof recordSettlementBody>;
