import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '@/lib/api';
import { json, mockApi } from './helpers';

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('fetches a CSRF token once and sends it on state-changing requests only', async () => {
    const { calls, fn } = mockApi((url) => (url.endsWith('/x') ? json({ ok: true }) : undefined));
    await api('/x');
    await api('/x', { method: 'POST', body: { a: 1 } });
    await api('/x', { method: 'POST', body: { a: 2 } });
    expect(calls.filter((c) => c.url.endsWith('/auth/csrf'))).toHaveLength(1);
    const posts = fn.mock.calls.filter(([, i]) => i?.method === 'POST');
    expect(posts).toHaveLength(2);
    for (const [, init] of posts) expect((init!.headers as Record<string, string>)['X-CSRF-Token']).toBe('test-csrf');
    const get = fn.mock.calls.find(([u, i]) => String(u).endsWith('/x') && i?.method === 'GET')!;
    expect((get[1]!.headers as Record<string, string>)['X-CSRF-Token']).toBeUndefined();
  });

  it('refreshes the token and retries once when the server rejects it', async () => {
    let attempts = 0;
    mockApi((url) => {
      if (!url.endsWith('/y')) return undefined;
      return ++attempts === 1 ? json({ error: { code: 'CSRF_TOKEN_INVALID', message: 'bad' } }, 403) : json({ done: true });
    });
    await expect(api('/y', { method: 'POST' })).resolves.toEqual({ done: true });
    expect(attempts).toBe(2);
  });

  it('maps server errors, field details and network failures to ApiError', async () => {
    mockApi((url) => (url.endsWith('/bad') ? json({ error: { code: 'VALIDATION_ERROR', message: 'The request is invalid.', requestId: 'r1', details: { fields: [{ path: 'email', message: 'nope' }] } } }, 400) : undefined));
    const err = await api('/bad').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', requestId: 'r1', fields: [{ path: 'email', message: 'nope' }] });

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(api('/anything')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });

  it('signals session expiry on 401 for ordinary calls but not for the sign-in attempt itself', async () => {
    const onExpired = vi.fn();
    window.addEventListener('auth:expired', onExpired);
    mockApi(() => json({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' } }, 401));
    await api('/courses').catch(() => undefined);
    expect(onExpired).toHaveBeenCalledTimes(1);
    await api('/auth/login', { method: 'POST', body: {} }).catch(() => undefined);
    expect(onExpired).toHaveBeenCalledTimes(1);
    window.removeEventListener('auth:expired', onExpired);
  });
});
