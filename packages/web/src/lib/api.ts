// This app's own API lives under its prefix (e.g. https://api.aidenjang.com/owewell).
// Locally the same prefix is proxied by Vite, so dev matches prod exactly.
export const API_BASE = import.meta.env.VITE_API_URL ?? '/owewell';
// Auth is platform-level and shared across apps, so it sits at the API root
// (e.g. https://api.aidenjang.com/auth), not under this app's prefix. In dev both
// are proxied to the same server, so the auth base is just the origin root ('').
export const AUTH_BASE = import.meta.env.VITE_AUTH_URL ?? '';

function baseFor(path: string): string {
  return path.startsWith('/auth/') ? AUTH_BASE : API_BASE;
}

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

  const res = await fetch(`${baseFor(path)}${path}`, {
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
    throw new ApiError(res.status, message, data);
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
  del: <T>(path: string): Promise<T> => request<T>(path, { method: 'DELETE' }),
};
