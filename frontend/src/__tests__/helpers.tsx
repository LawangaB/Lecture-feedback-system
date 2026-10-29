import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { setCsrfToken } from '@/lib/api';

export const json = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export type Handler = (url: string, init: RequestInit | undefined) => Response | Promise<Response> | undefined;

/** Installs a fetch mock. Unhandled calls fail loudly so tests can't silently depend on the network. */
export function mockApi(...handlers: Handler[]) {
  setCsrfToken(null);
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith('/auth/csrf')) return json({ csrfToken: 'test-csrf' });
    for (const h of handlers) { const r = await h(url, init); if (r) return r; }
    throw new Error(`Unhandled fetch: ${init?.method ?? 'GET'} ${url}`);
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

export function renderWithProviders(ui: ReactElement, route = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { client, ...render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter></QueryClientProvider>) };
}
