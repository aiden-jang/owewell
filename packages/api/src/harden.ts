// Shared HTTP hardening for the Workers. Two pieces:
//   securityHeaders() — the response headers every web-facing Worker should set.
//   enforceSameOrigin() — a defense-in-depth CSRF guard for state-changing requests.
//
// Framework-agnostic core (securityHeaders / enforceSameOrigin) plus a ready-made Hono
// middleware (harden) — the plain-fetch Workers call the core helpers around their Response.

import type { MiddlewareHandler } from 'hono';

/**
 * Conservative Content-Security-Policy that our Vite SPAs run under without changes:
 *  - script-src 'self': prod bundles are external files, no inline <script>.
 *  - style-src 'unsafe-inline': React `style={}` props and Vite's injected CSS need it.
 *  - font/style google entries: cover Inter loaded via Google Fonts (either @import or <link>).
 *  - img data:/blob:: inline SVG/canvas exports and data-URI icons.
 *  - connect-src 'self': same-origin fetch AND same-origin ws/wss (owewell realtime) — 'self'
 *    matches the ws/wss upgrade to the same host per CSP3.
 *  - cloudflareinsights: the (optional) Web Analytics beacon.
 * Tighten per app after browser-verifying on deploy; anything cross-origin a specific app needs
 * (e.g. wherever's places API, is-it-a-dog if it ever calls a cross-origin AI host) goes through
 * the `csp` override rather than loosening this default for everyone.
 */
export const DEFAULT_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob:",
  "font-src 'self' https://fonts.gstatic.com data:",
  "connect-src 'self' https://static.cloudflareinsights.com",
  "frame-ancestors 'none'",
  "form-action 'self'",
  'upgrade-insecure-requests',
].join('; ');

/** Disable device APIs no app uses by default. wherever overrides to allow geolocation. */
export const DEFAULT_PERMISSIONS_POLICY =
  'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()';

export interface SecurityHeaderOptions {
  /** Replace the default CSP wholesale (e.g. to add a cross-origin connect-src). */
  csp?: string;
  /** Replace the default Permissions-Policy (e.g. `geolocation=(self)` for wherever). */
  permissionsPolicy?: string;
}

/** The security response headers as a plain object, ready to spread onto any Headers/Response. */
export function securityHeaders(opts: SecurityHeaderOptions = {}): Record<string, string> {
  return {
    'Content-Security-Policy': opts.csp ?? DEFAULT_CSP,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'Permissions-Policy': opts.permissionsPolicy ?? DEFAULT_PERMISSIONS_POLICY,
  };
}

/** Mutate a Headers object in place with the security headers. Returns it for chaining. */
export function applySecurityHeaders(headers: Headers, opts: SecurityHeaderOptions = {}): Headers {
  for (const [key, value] of Object.entries(securityHeaders(opts))) headers.set(key, value);
  return headers;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Defense-in-depth CSRF guard. The primary defense is already the `platform_session` cookie's
 * SameSite=Lax attribute, which stops the browser from attaching it to cross-site POSTs. This
 * adds a second gate: for a state-changing method, if the request carries an Origin header whose
 * host differs from the request's own host, reject it.
 *
 * We only reject on a *present, mismatched* Origin — same-origin fetches always send a matching
 * Origin, so legitimate traffic passes, while requests that genuinely omit Origin (rare, and
 * cookie-less cross-site anyway) are left to the SameSite gate rather than being hard-blocked.
 *
 * Localhost origins are always allowed: in `wrangler dev` a Worker with a custom-domain route sees
 * every request as that production host, so a genuine same-origin call from the local web app
 * (Origin `http://localhost:PORT`) would never match. A browser only sends a localhost Origin from
 * a page actually on localhost — an attacker's page can't forge it — so allowing it is safe.
 *
 * @returns a 403 Response to short-circuit with, or null when the request is allowed.
 */
export function enforceSameOrigin(request: Request): Response | null {
  if (SAFE_METHODS.has(request.method)) return null;
  const origin = request.headers.get('Origin');
  if (origin === null) return null;
  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return forbidden();
  }
  if (originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1') return null;
  if (originUrl.host !== new URL(request.url).host) return forbidden();
  return null;
}

function forbidden(): Response {
  return new Response(JSON.stringify({ error: 'cross-origin request rejected' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

export interface HardenOptions extends SecurityHeaderOptions {
  /** Run the same-origin CSRF guard on state-changing methods. Default true. */
  csrf?: boolean;
}

/**
 * One-line hardening for a Hono Worker: `app.use('*', harden())`. Guards state-changing requests
 * (CSRF) up front, then stamps the security headers onto the response on the way out.
 *
 * Two Workers realities it handles:
 *  - WebSocket upgrades (status 101, e.g. owewell realtime) pass through untouched.
 *  - Static-asset responses from `env.ASSETS.fetch` carry immutable headers, so we rebuild the
 *    Response with a fresh, mutable Headers rather than mutating in place (which would throw).
 */
export function harden(opts: HardenOptions = {}): MiddlewareHandler {
  const { csrf = true, ...headerOpts } = opts;
  return async (c, next) => {
    if (csrf) {
      const blocked = enforceSameOrigin(c.req.raw);
      if (blocked) return blocked;
    }
    await next();
    const res = c.res;
    if (res.status === 101) return;
    const headers = new Headers(res.headers);
    applySecurityHeaders(headers, headerOpts);
    c.res = new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}
