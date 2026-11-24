import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/components/layout/AppShell';
import { AuthProvider, useAuth } from '@/features/auth/AuthContext';
import { ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage } from '@/features/auth/AuthPages';
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

  it('creates an account and navigates to the signed-in page', async () => {
    const { calls } = mockApi(
      meUnauthed,
      (url) => (url.endsWith('/auth/register') ? json({ user: { id: 'u2', email: 'sam@uni.test', displayName: 'Sam', role: 'STUDENT' }, csrfToken: 'registered-csrf' }) : undefined),
    );
    renderWithProviders(
      <AuthProvider><Routes><Route path="/register" element={<RegisterPage />} /><Route path="/" element={<SignedInPage />} /></Routes></AuthProvider>,
      '/register',
    );
    await userEvent.type(await screen.findByLabelText('Full name'), 'Sam');
    await userEvent.type(screen.getByLabelText('Email'), 'sam@uni.test');
    await userEvent.type(screen.getByLabelText('Password'), 'a-secure-passphrase');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'a-secure-passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('sam@uni.test')).toBeInTheDocument();
    expect(calls.find((call) => call.url.endsWith('/auth/register'))?.body).toEqual({ email: 'sam@uni.test', password: 'a-secure-passphrase', displayName: 'Sam' });
  });

  it('shows the API error when registration is rejected', async () => {
    mockApi(meUnauthed, (url) => (url.endsWith('/auth/register') ? json({ error: { code: 'EMAIL_TAKEN', message: 'An account already uses this email.' } }, 409) : undefined));
    renderWithProviders(<AuthProvider><RegisterPage /></AuthProvider>);
    await userEvent.type(await screen.findByLabelText('Full name'), 'Sam');
    await userEvent.type(screen.getByLabelText('Email'), 'sam@uni.test');
    await userEvent.type(screen.getByLabelText('Password'), 'a-secure-passphrase');
    await userEvent.type(screen.getByLabelText('Confirm password'), 'a-secure-passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('An account already uses this email.');
  });
});

describe('password recovery pages', () => {
  it('sends a reset request and replaces the form with confirmation', async () => {
    const { calls } = mockApi((url) => (url.endsWith('/auth/forgot-password') ? json({ ok: true }) : undefined));
    renderWithProviders(<ForgotPasswordPage />);
    await userEvent.type(screen.getByLabelText('Email'), 'student@uni.test');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Check your inbox');
    expect(calls.find((call) => call.url.endsWith('/auth/forgot-password'))?.body).toEqual({ email: 'student@uni.test' });
  });

  it('shows the reset-token error and handles an invalid reset link', async () => {
    mockApi((url) => (url.endsWith('/auth/reset-password') ? json({ error: { code: 'INVALID_RESET_TOKEN', message: 'ignored' } }, 400) : undefined));
    const { rerender } = renderWithProviders(<ResetPasswordPage />, '/reset-password?token=expired');
    await userEvent.type(screen.getByLabelText('New password'), 'a-secure-passphrase');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'a-secure-passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This link is invalid or has expired. Request a new one.');
    rerender(<MemoryRouter initialEntries={['/reset-password']}><ResetPasswordPage /></MemoryRouter>);
    expect(screen.getByText('Link not valid')).toBeInTheDocument();
  });

  it('updates the password and returns to sign in', async () => {
    mockApi((url) => (url.endsWith('/auth/reset-password') ? json({ ok: true }) : undefined));
    renderWithProviders(<Routes><Route path="/reset-password" element={<ResetPasswordPage />} /><Route path="/login" element={<p>Signed in again</p>} /></Routes>, '/reset-password?token=fresh');
    await userEvent.type(screen.getByLabelText('New password'), 'a-secure-passphrase');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'a-secure-passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('Signed in again')).toBeInTheDocument();
  });

  it('shows a general error when resetting fails for a reason other than the token', async () => {
    mockApi((url) => (url.endsWith('/auth/reset-password') ? json({ error: { code: 'RATE_LIMITED', message: 'Please wait before trying again.' } }, 429) : undefined));
    renderWithProviders(<ResetPasswordPage />, '/reset-password?token=fresh');
    await userEvent.type(screen.getByLabelText('New password'), 'a-secure-passphrase');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'a-secure-passphrase');
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please wait before trying again.');
  });
});
