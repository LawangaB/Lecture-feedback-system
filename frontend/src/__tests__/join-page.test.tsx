import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { JoinForm } from '@/features/sessions/JoinPage';
import { json, mockApi, renderWithProviders } from './helpers';

describe('join form', () => {
  it('validates the code before making a request', async () => {
    const { calls } = mockApi();
    renderWithProviders(<JoinForm />);
    await userEvent.click(screen.getByRole('button', { name: 'Join lecture' }));
    expect(await screen.findByText('Enter the code shown on the lecturer’s screen.')).toBeInTheDocument();
    expect(calls.some((call) => call.url.endsWith('/sessions/join'))).toBe(false);
  });

  it('joins a session and navigates to it', async () => {
    const { calls } = mockApi((url) => (url.endsWith('/sessions/join') ? json({ session: { id: 'session-1' } }) : undefined));
    renderWithProviders(
      <Routes><Route path="/join" element={<JoinForm />} /><Route path="/sessions/session-1" element={<p>Joined session</p>} /></Routes>,
      '/join',
    );
    await userEvent.type(screen.getByLabelText('Session code'), 'AB7KQ9');
    await userEvent.click(screen.getByRole('button', { name: 'Join lecture' }));
    expect(await screen.findByText('Joined session')).toBeInTheDocument();
    expect(calls.find((call) => call.url.endsWith('/sessions/join'))?.body).toEqual({ code: 'AB7KQ9' });
  });

  it('keeps the form available and reports a rejected join', async () => {
    mockApi((url) => (url.endsWith('/sessions/join') ? json({ error: { code: 'INVALID_CODE', message: 'That session code is not valid.' } }, 404) : undefined));
    renderWithProviders(<JoinForm />);
    await userEvent.type(screen.getByLabelText('Session code'), 'BADCODE');
    await userEvent.click(screen.getByRole('button', { name: 'Join lecture' }));
    expect(await screen.findByText('That session code is not valid.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Join lecture' })).toBeEnabled();
  });

  it('automatically submits a QR-link code and reports errors inline', async () => {
    mockApi((url) => (url.endsWith('/sessions/join') ? json({ error: { code: 'EXPIRED_CODE', message: 'This session code has expired.' } }, 410) : undefined));
    renderWithProviders(<JoinForm initialCode="EXPIRED" autoSubmit />);
    expect(await screen.findByText('This session code has expired.')).toBeInTheDocument();
  });
});
