import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { api, ApiError, setCsrfToken } from '@/lib/api';
import type { User } from '@/types/api';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (email: string, password: string, displayName: string) => Promise<User>;
  logout: () => Promise<void>;
  setUser: (u: User) => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return (await api<{ user: User }>('/auth/me')).user;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });

  const clear = useCallback(() => {
    setCsrfToken(null);
    qc.removeQueries({ predicate: (query) => query.queryKey[0] !== 'me' });
    qc.setQueryData(['me'], null);
  }, [qc]);

  useEffect(() => {
    const onExpired = () => clear();
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, [clear]);

  const value = useMemo<AuthState>(
    () => ({
      user: data ?? null,
      loading: isLoading,
      login: async (email, password) => {
        const r = await api<{ user: User; csrfToken: string }>('/auth/login', { method: 'POST', body: { email, password } });
        setCsrfToken(r.csrfToken);
        qc.removeQueries({ predicate: (query) => query.queryKey[0] !== 'me' });
        qc.setQueryData(['me'], r.user);
        return r.user;
      },
      register: async (email, password, displayName) => {
        const r = await api<{ user: User; csrfToken: string }>('/auth/register', { method: 'POST', body: { email, password, displayName } });
        setCsrfToken(r.csrfToken);
        qc.removeQueries({ predicate: (query) => query.queryKey[0] !== 'me' });
        qc.setQueryData(['me'], r.user);
        return r.user;
      },
      logout: async () => {
        try { await api('/auth/logout', { method: 'POST' }); } finally { clear(); }
      },
      setUser: (u) => qc.setQueryData(['me'], u),
    }),
    [data, isLoading, qc, clear],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
