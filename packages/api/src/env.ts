/** Bindings + vars declared in wrangler.toml / secrets, surfaced to the Worker. */
export interface Env {
  // owewell's own data (people, groups, expenses, settlements).
  DB: D1Database;
  // Base URL of the shared auth service (e.g. https://accounts.aidenjang.com); the API
  // validates the caller's session against it. Local dev: http://localhost:34100.
  AUTH_URL: string;
  // Per-group WebSocket fan-out (GroupRoom Durable Object, one instance per group).
  REALTIME: DurableObjectNamespace;
  // The built web SPA (apps/owewell/web/dist), served from this same Worker so the UI and
  // the /owewell/* API share one origin.
  ASSETS: Fetcher;
  // Per-IP limiters. Both optional: local `wrangler dev` and the test worker do not provide
  // them, and the API degrades to unlimited rather than refusing everyone.
  // A ceiling across the whole API, sized so only a script ever meets it.
  API_LIMITER?: RateLimiter;
  // Much tighter, on the one unauthenticated endpoint. A share request spends both.
  SHARE_LIMITER?: RateLimiter;
}

/** Cloudflare's native rate-limit binding. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}
