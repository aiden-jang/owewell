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
  // Mount prefix for this app's API routes. Lets one backend host several apps
  // side by side (e.g. /owe-well, /wherever) without their routes colliding.
  API_PREFIX: z.string().default('/api'),
  // When the frontend is served from a different origin (e.g. owewell.aidenjang.com
  // calling api.aidenjang.com), set this to the shared parent so the session cookie
  // is sent across subdomains. Example: ".aidenjang.com". Unset for same-origin.
  COOKIE_DOMAIN: z.string().optional(),
  // Comma-separated browser origins allowed to call the API with credentials.
  // Required only in the split-origin deployment; unset means same-origin (no CORS).
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean)
        : [],
    ),
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
