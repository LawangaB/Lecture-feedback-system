import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudentLive } from '@/features/sessions/StudentLive';
import type { Poll, Snapshot } from '@/types/api';
import { json, mockApi, renderWithProviders } from './helpers';

afterEach(() => vi.unstubAllGlobals());

const poll = (over: Partial<Poll> = {}): Poll => ({
  id: 'p1', sessionId: 's1', question: 'Which is a prime number?', type: 'SINGLE_CHOICE', status: 'OPEN', isAnonymous: true, allowResponseUpdate: false, isRequired: false,
  minSelections: null, maxSelections: null, ratingMin: null, ratingMax: null, durationSeconds: null, closesAt: null, remainingMs: null, position: 0, resultsVisible: false, hasResponded: false,
  options: [{ id: 'o1', label: 'Four', position: 0 }, { id: 'o2', label: 'Seven', position: 1 }, { id: 'o3', label: 'Nine', position: 2 }], ...over,
});
const snapshot = (polls: Poll[], status: Snapshot['session']['status'] = 'LIVE', results: Snapshot['results'] = {}): Snapshot => ({
  session: { id: 's1', course: { id: 'c1', code: 'CS101', title: 'Intro' }, title: 'Lecture 1', description: null, status, accessPolicy: 'ENROLLED_ONLY', feedbackEnabled: false, scheduledFor: null, startedAt: null, endedAt: null, createdAt: new Date().toISOString() },
  access: 'STUDENT', polls, results, serverTime: new Date().toISOString(),
});
const feedbackIdle = (url: string) => (url.includes('/feedback/mine') ? json({ submitted: false }) : undefined);

describe('student polling interface', () => {
  it('keeps Submit disabled until the answer is valid and labels anonymity honestly', async () => {
    mockApi(feedbackIdle);
    renderWithProviders(<StudentLive snapshot={snapshot([poll()])} connection="connected" clockOffset={0} />);
    const submit = screen.getByRole('button', { name: 'Submit answer' });
    expect(submit).toBeDisabled();
    expect(screen.getByText(/Anonymous — your name is not saved/)).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Seven'));
    expect(submit).toBeEnabled();
  });

  it('shows "Answer received" only after the server confirms, and retries reuse the same idempotency key', async () => {
    let attempt = 0;
    const { calls } = mockApi(feedbackIdle, (url, init) => {
      if (!url.endsWith('/polls/p1/responses') || init?.method !== 'POST') return undefined;
      return ++attempt === 1 ? json({ error: { code: 'NETWORK', message: 'Temporary problem. Try again.' } }, 503) : json({ status: 'created' }, 201);
    });
    renderWithProviders(<StudentLive snapshot={snapshot([poll()])} connection="connected" clockOffset={0} />);
    await userEvent.click(screen.getByLabelText('Seven'));
    await userEvent.click(screen.getByRole('button', { name: 'Submit answer' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Temporary problem');
    expect(screen.queryByText('Answer received')).not.toBeInTheDocument(); // never claim success before persistence

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Answer received')).toBeInTheDocument();

    const posts = calls.filter((c) => c.url.endsWith('/polls/p1/responses'));
    expect(posts).toHaveLength(2);
    expect((posts[0]!.body as { idempotencyKey: string }).idempotencyKey).toBe((posts[1]!.body as { idempotencyKey: string }).idempotencyKey);
    expect(posts[1]!.body).toMatchObject({ optionIds: ['o2'] });
  });

  it('enforces multiple-select limits in the UI', async () => {
    mockApi(feedbackIdle);
    renderWithProviders(<StudentLive snapshot={snapshot([poll({ type: 'MULTIPLE_CHOICE', minSelections: 1, maxSelections: 2 })])} connection="connected" clockOffset={0} />);
    await userEvent.click(screen.getByLabelText('Four'));
    await userEvent.click(screen.getByLabelText('Seven'));
    await userEvent.click(screen.getByLabelText('Nine')); // third pick is ignored
    expect(screen.getByLabelText('Nine')).not.toBeChecked();
    expect(screen.getByText('Choose 1 to 2')).toBeInTheDocument();
  });

  it('renders rating scales as a radio group', async () => {
    mockApi(feedbackIdle);
    renderWithProviders(<StudentLive snapshot={snapshot([poll({ type: 'RATING', options: [], ratingMin: 1, ratingMax: 5 })])} connection="connected" clockOffset={0} />);
    const group = screen.getByRole('radiogroup', { name: 'Rate from 1 to 5' });
    expect(within(group).getAllByRole('radio')).toHaveLength(5);
  });

  it('blocks answering while the session is paused or the connection is down', () => {
    mockApi(feedbackIdle);
    renderWithProviders(<StudentLive snapshot={snapshot([poll()], 'PAUSED')} connection="reconnecting" clockOffset={0} />);
    expect(screen.getAllByText(/session is paused/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Reconnecting/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'Submit answer' })).toBeDisabled();
    expect(screen.getByLabelText('Seven')).toBeDisabled();
  });

  it('shows results only when they are visible, plus an accessible table alternative', () => {
    mockApi(feedbackIdle);
    const closed = poll({ status: 'CLOSED', resultsVisible: true, hasResponded: true });
    const results = { p1: { pollId: 'p1', type: 'SINGLE_CHOICE' as const, totalResponses: 4, joinedParticipants: 5, responseRate: 0.8, options: [{ id: 'o1', label: 'Four', count: 1, percentOfRespondents: 25 }, { id: 'o2', label: 'Seven', count: 3, percentOfRespondents: 75 }, { id: 'o3', label: 'Nine', count: 0, percentOfRespondents: 0 }], rating: null } };
    const { unmount } = renderWithProviders(<StudentLive snapshot={snapshot([closed], 'LIVE', results)} connection="connected" clockOffset={0} />);
    expect(screen.getByText('Closed polls')).toBeInTheDocument();
    expect(screen.getByText(/You answered this poll/)).toBeInTheDocument();
    unmount();
    renderWithProviders(<StudentLive snapshot={snapshot([{ ...closed, resultsVisible: false }], 'LIVE', {})} connection="connected" clockOffset={0} />);
    expect(screen.getByText("Results haven't been shared.")).toBeInTheDocument();
  });

  it('waits calmly when no poll is open and when the lecture has not started', () => {
    mockApi(feedbackIdle);
    const { unmount } = renderWithProviders(<StudentLive snapshot={snapshot([])} connection="connected" clockOffset={0} />);
    expect(screen.getByText('Waiting for the next poll')).toBeInTheDocument();
    unmount();
    renderWithProviders(<StudentLive snapshot={snapshot([], 'SCHEDULED')} connection="connected" clockOffset={0} />);
    expect(screen.getByText("This lecture hasn't started")).toBeInTheDocument();
  });

  it('lets identified polls change an answer', async () => {
    mockApi(feedbackIdle);
    const answered = poll({ isAnonymous: false, allowResponseUpdate: true, hasResponded: true, myResponse: { optionIds: ['o1'], ratingValue: null } });
    renderWithProviders(<StudentLive snapshot={snapshot([answered])} connection="connected" clockOffset={0} />);
    expect(screen.getByText('Answer received')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Change my answer' }));
    expect(screen.getByLabelText('Four')).toBeChecked();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update my answer' })).toBeEnabled());
  });
});
