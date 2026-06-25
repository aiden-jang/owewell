import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  // Absolute path to the built web app (packages/web/dist). Set in production to
  // serve the SPA from the same origin as the API; unset in dev/test.
  WEB_DIR: z.string().optional(),
  // Public base URL, used to build links in emails (e.g. password reset).
  APP_URL: z.string().url().default('http://localhost:5173'),
});

export type Env = z.infer<typeof EnvSchema>;

/** Validate the process environment once, failing loudly with a readable message. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
