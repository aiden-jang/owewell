import type { MiddlewareHandler } from 'hono';
import type { Env, RateLimiter } from './env.js';

/**
 * Per-IP rate limiting, keyed on Cloudflare's own client-IP header.
 *
 * Degrades open when the binding or client-IP header is absent. Local Wrangler may supply
 * the native binding; integration tests retain it with independent caller IPs. A limiter that closed instead would make the whole API unusable offline, and
 * the failure would look like a bug in whatever you were building at the time.
 *
 * `message` is the field the web client shows; without it a 429 surfaces as "Request failed (429)".
 */
export function perIp(
  pick: (env: Env) => RateLimiter | undefined,
  message: string,
): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const limiter = pick(c.env);
    const ip = c.req.header('CF-Connecting-IP');
    if (limiter && ip) {
      const { success } = await limiter.limit({ key: ip });
      if (!success) return c.json({ error: 'TOO_MANY_REQUESTS', message }, 429);
    }
    await next();
  };
}
