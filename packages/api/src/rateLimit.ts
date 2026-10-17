import type { MiddlewareHandler } from 'hono';
import type { Env, RateLimiter } from './env.js';

/** Native per-IP limits fail open when the binding or client-IP header is absent.
 * Include message in a refusal so the browser can explain it. */
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
