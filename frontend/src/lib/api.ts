export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public requestId?: string, public fields?: { path: string; message: string }[]) {
    super(message);
  }
}

let csrfToken: string | null = null;
export const setCsrfToken = (t: string | null) => { csrfToken = t; };

async function ensureCsrf(): Promise<string> {
  if (!csrfToken) {
    const res = await fetch('/api/v1/auth/csrf', { credentials: 'same-origin' });
    if (!res.ok) throw new ApiError(res.status, 'CSRF_UNAVAILABLE', 'Could not start a secure session. Check your connection and try again.');
    csrfToken = ((await res.json()) as { csrfToken: string }).csrfToken;
  }
  return csrfToken;
}

interface Options { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; signal?: AbortSignal }

export async function api<T = unknown>(path: string, { method = 'GET', body, signal }: Options = {}, retried = false): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    headers['X-CSRF-Token'] = await ensureCsrf();
  }
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { method, headers, credentials: 'same-origin', signal, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', 'You appear to be offline. Check your connection and try again.');
  }
  if (res.status === 204) return undefined as T;
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) {
    const err = (data as { error?: { code: string; message: string; requestId?: string; details?: { fields?: { path: string; message: string }[] } } })?.error;
    if (res.status === 403 && err?.code === 'CSRF_TOKEN_INVALID' && !retried) {
      csrfToken = null; // session was rotated or expired: fetch a fresh token and retry once
      return api<T>(path, { method, body, signal }, true);
    }
    if (res.status === 401 && path !== '/auth/me' && !path.startsWith('/auth/login')) window.dispatchEvent(new Event('auth:expired'));
    throw new ApiError(res.status, err?.code ?? 'ERROR', err?.message ?? 'Something went wrong.', err?.requestId, err?.details?.fields);
  }
  return data as T;
}

/** Download a protected file (e.g. CSV) through the authenticated API. */
export async function download(path: string, filename: string) {
  const res = await fetch(`/api/v1${path}`, { credentials: 'same-origin' });
  if (!res.ok) throw new ApiError(res.status, 'DOWNLOAD_FAILED', 'The export could not be created.');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const errorMessage = (e: unknown) => (e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
