import { z } from 'zod';

export const createInviteBody = z.object({
  email: z
    .string()
    .email()
    .transform((value) => value.trim().toLowerCase())
    .optional(),
});

export type CreateInviteBody = z.infer<typeof createInviteBody>;
