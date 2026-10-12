// This app's own API is served from its own origin under the /owewell prefix (callers pass
// bare paths like "/groups"). Locally the same prefix is proxied by Vite, so dev matches prod.
// The server also answers on /owewell, the prefix this used to use, so an older cached bundle
// keeps working. New requests all go here.
export const API_BASE = import.meta.env.VITE_API_URL ?? '/api';
// The shared auth service (login/logout/account pages + session). Sign-in and sign-out are
// full-page redirects here; the browser never fetches it cross-origin (identity comes from
// the same-origin /api/me instead). In dev the auth Worker serves the login UI + API from
// one origin on :34100 (wrangler dev), so default there rather than sending local logins to
// production. VITE_AUTH_URL overrides either way.
export const AUTH_ORIGIN =
  import.meta.env.VITE_AUTH_URL ??
  (import.meta.env.DEV ? 'http://localhost:34100' : 'https://accounts.aidenjang.com');

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  // Only declare a JSON body when there actually is one; an empty body with this
  // content-type makes the server's JSON parser reject the request.
  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...options,
    headers,
  });

  const isJson = res.headers.get('content-type')?.includes('application/json') ?? false;
  const data: unknown = isJson ? await res.json() : undefined;

  if (!res.ok) {
    const message =
      data && typeof data === 'object' && 'message' in data && typeof data.message === 'string'
        ? data.message
        : `Request failed (${res.status})`;
    throw new ApiError(
      res.status,
      res.status === 401 ? 'Your sign-in expired. Sign in again, then retry.' : message,
      data,
    );
  }

  return data as T;
}

export const api = {
  get: <T>(path: string): Promise<T> => request<T>(path),
  post: <T>(path: string, body?: unknown): Promise<T> => {
    const init: RequestInit = { method: 'POST' };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    return request<T>(path, init);
  },
  patch: <T>(path: string, body?: unknown): Promise<T> => {
    const init: RequestInit = { method: 'PATCH' };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    return request<T>(path, init);
  },
  put: <T>(path: string, body?: unknown): Promise<T> => {
    const init: RequestInit = { method: 'PUT' };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    return request<T>(path, init);
  },
  del: <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' }),
};
