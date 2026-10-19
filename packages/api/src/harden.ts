// Shared HTTP hardening for the Workers. Two pieces:
//   securityHeaders() — the response headers every web-facing Worker should set.
//   enforceSameOrigin() — a defense-in-depth CSRF guard for state-changing requests.
//
// Framework-agnostic core (securityHeaders / enforceSameOrigin) plus a ready-made Hono
// middleware (harden) — the plain-fetch Workers call the core helpers around their Response.

import type { MiddlewareHandler } from 'hono';

/** React needs inline styles; CSP3 'self' includes same-origin sockets. Extend cross-origin sources via csp. */
export const DEFAULT_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob:",
  "font-src 'self' https://fonts.gstatic.com data:",
  "connect-src 'self'",
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
    'Referrer-Policy': 'no-referrer',
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

/** Reject mismatched Origins on writes; missing Origins rely on SameSite.
 * Loopback Origins support Wrangler custom-domain development. Return null when allowed. */
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

/** Preserve WebSocket upgrades; copy immutable asset headers before applying response policy. */
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
