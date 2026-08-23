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
  // Receipt photos. Objects are keyed "<groupId>/<expenseId>", so the key is derivable from the
  // expense and nothing is ever stored for a form somebody abandoned.
  RECEIPTS: R2Bucket;
  // Receipt OCR via Claude vision. Unset = zero-cost mock extractor.
  ANTHROPIC_API_KEY?: string;
}
