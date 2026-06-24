import { z } from 'zod';

export const registerBody = z.object({
  email: z
    .string()
    .email()
    .transform((value) => value.trim().toLowerCase()),
  password: z.string().min(8, 'Use at least 8 characters').max(128),
  displayName: z
    .string()
    .min(1)
    .max(80)
    .transform((value) => value.trim()),
});

export const loginBody = z.object({
  email: z
    .string()
    .email()
    .transform((value) => value.trim().toLowerCase()),
  password: z.string().min(1).max(128),
});

export type RegisterBody = z.infer<typeof registerBody>;
export type LoginBody = z.infer<typeof loginBody>;
