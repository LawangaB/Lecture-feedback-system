import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Navigate, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/components/layout/AppShell';
import { AuthProvider, useAuth } from '@/features/auth/AuthContext';
import { LoginPage, RegisterPage } from '@/features/auth/AuthPages';
import { json, mockApi, renderWithProviders } from './helpers';

afterEach(() => vi.unstubAllGlobals());

const meUnauthed = (url: string) => (url.endsWith('/auth/me') ? json({ error: { code: 'UNAUTHENTICATED', message: 'x' } }, 401) : undefined);

function SignedInPage() {
  const { user } = useAuth();
  return <p>{user?.email}</p>;
}

function ProtectedDashboard() {
  const { user } = useAuth();
  return user ? <AppShell /> : <Navigate to="/login" replace />;
}

describe('login page', () => {
  it('returns to the login page after signing out from the dashboard', async () => {
    mockApi((url) => {
      if (url.endsWith('/auth/me')) return json({ user: { id: 'u1', email: 'a@b.test', displayName: 'Alex', role: 'STUDENT' } });
      if (url.endsWith('/sessions')) return json({ live: [] });
      if (url.endsWith('/auth/logout')) return json({ ok: true });
      return undefined;
    });
    renderWithProviders(
      <AuthProvider><Routes>
        <Route path="/" element={<ProtectedDashboard />}><Route index element={<SignedInPage />} /></Route>
        <Route path="/login" element={<LoginPage />} />
      </Routes></AuthProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(await screen.findByLabelText('Email')).toBeInTheDocument();
  });

  it('validates fields before calling the API, with errors tied to inputs', async () => {
    const { calls } = mockApi(meUnauthed);
    renderWithProviders(<AuthProvider><LoginPage /></AuthProvider>);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((c) => c.url.endsWith('/auth/login'))).toBe(false);
  });

  it('shows one generic message on bad credentials and keeps focusable controls', async () => {
    mockApi(meUnauthed, (url) => (url.endsWith('/auth/login') ? json({ error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect email or password.' } }, 401) : undefined));
    renderWithProviders(<AuthProvider><LoginPage /></AuthProvider>);
    await userEvent.type(await screen.findByLabelText('Email'), 'a@b.test');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });

  it('navigates to the signed-in page immediately after successful login', async () => {
    mockApi(
      meUnauthed,
      (url) => (url.endsWith('/auth/login') ? json({ user: { id: 'u1', email: 'a@b.test', displayName: 'Alex', role: 'STUDENT' }, csrfToken: 'signed-in-csrf' }) : undefined),
    );
    renderWithProviders(
      <AuthProvider><Routes><Route path="/login" element={<LoginPage />} /><Route path="/" element={<SignedInPage />} /></Routes></AuthProvider>,
      '/login',
    );
    await userEvent.type(await screen.findByLabelText('Email'), 'a@b.test');
    await userEvent.type(screen.getByLabelText('Password'), 'correct-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('a@b.test')).toBeInTheDocument();
  });

  it('toggles password visibility with an accessible control', async () => {
    mockApi(meUnauthed);
    renderWithProviders(<AuthProvider><LoginPage /></AuthProvider>);
    const input = await screen.findByLabelText('Password');
    expect(input).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('register page', () => {
  it('enforces password length and confirmation client-side', async () => {
    mockApi(meUnauthed);
    renderWithProviders(<AuthProvider><RegisterPage /></AuthProvider>);
    await userEvent.type(await screen.findByLabelText('Full name'), 'Sam');
    await userEvent.type(screen.getByLabelText('Email'), 'sam@uni.test');
    await userEvent.type(screen.getByLabelText('Password'), 'short');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'different');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Use at least 10 characters.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true'));
  });
});
