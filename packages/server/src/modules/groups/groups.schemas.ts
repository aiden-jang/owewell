import { z } from 'zod';

export const createGroupBody = z.object({
  name: z.string().trim().min(1, 'Give the group a name').max(80),
});

export const addMemberBody = z.object({
  email: z
    .string()
    .email()
    .transform((value) => value.trim().toLowerCase()),
});

export type CreateGroupBody = z.infer<typeof createGroupBody>;
export type AddMemberBody = z.infer<typeof addMemberBody>;
