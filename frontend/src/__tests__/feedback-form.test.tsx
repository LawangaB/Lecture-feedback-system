import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FeedbackForm } from '@/features/feedback/Feedback';
import { json, mockApi, renderWithProviders } from './helpers';

describe('feedback form', () => {
  it('submits selected ratings, comment, and named visibility', async () => {
    const { calls } = mockApi(
      (url) => (url.endsWith('/feedback/mine') ? json({ submitted: false }) : undefined),
      (url) => (url.endsWith('/feedback') ? json({ ok: true }) : undefined),
    );
    renderWithProviders(<FeedbackForm sessionId="session-1" />);
    await userEvent.click((await screen.findAllByRole('radio', { hidden: true }))[2]!);
    await userEvent.type(screen.getByLabelText('Comments (optional)'), 'Clear examples helped.');
    await userEvent.click(screen.getByRole('radio', { name: 'Share my name' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Feedback received.');
    expect(calls.find((call) => call.url.endsWith('/feedback') && call.method === 'POST')?.body).toEqual({
      ratings: { CLARITY: 3 }, comment: 'Clear examples helped.', anonymous: false,
    });
  });

  it('shows the API error without losing the form', async () => {
    mockApi(
      (url) => (url.endsWith('/feedback/mine') ? json({ submitted: false }) : undefined),
      (url) => (url.endsWith('/feedback') ? json({ error: { code: 'ALREADY_SUBMITTED', message: 'Feedback has already been submitted.' } }, 409) : undefined),
    );
    renderWithProviders(<FeedbackForm sessionId="session-1" />);
    await userEvent.type(await screen.findByLabelText('Comments (optional)'), 'A comment is enough.');
    await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Feedback has already been submitted.');
    expect(screen.getByRole('button', { name: 'Send feedback' })).toBeEnabled();
  });
});
