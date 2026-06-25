import { z } from 'zod';

export const createGroupBody = z.object({
  name: z.string().trim().min(1, 'Give the group a name').max(80),
});

// Either add an existing account by email, or a name-only placeholder person.
export const addMemberBody = z.union([
  z.object({
    email: z
      .string()
      .email()
      .transform((value) => value.trim().toLowerCase()),
  }),
  z.object({
    name: z.string().trim().min(1, 'Give them a name').max(80),
  }),
]);

export const renameGroupBody = z.object({
  name: z.string().trim().min(1, 'Give the group a name').max(80),
});

export type CreateGroupBody = z.infer<typeof createGroupBody>;
export type AddMemberBody = z.infer<typeof addMemberBody>;
export type RenameGroupBody = z.infer<typeof renameGroupBody>;
