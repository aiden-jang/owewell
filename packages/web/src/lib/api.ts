const BASE = import.meta.env.VITE_API_URL ?? '/api';

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

  const res = await fetch(`${BASE}${path}`, {
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
};
