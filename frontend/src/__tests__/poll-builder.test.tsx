import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PollBuilderDialog } from '@/features/polls/PollBuilder';
import { json, mockApi, renderWithProviders } from './helpers';

afterEach(() => vi.unstubAllGlobals());

const open = () => renderWithProviders(<PollBuilderDialog sessionId="s1" open onOpenChange={() => {}} />);

describe('poll builder', () => {
  it('previews the student view as the lecturer types', async () => {
    mockApi();
    open();
    await userEvent.type(screen.getByLabelText('Question'), 'What is a primary key?');
    await userEvent.type(screen.getByLabelText('Option 1'), 'Unique identifier');
    expect(screen.getByLabelText('Student preview')).toHaveTextContent('What is a primary key?');
    expect(screen.getByLabelText('Student preview')).toHaveTextContent('Unique identifier');
    expect(screen.getByLabelText('Student preview')).toHaveTextContent('Anonymous');
  });

  it('blocks duplicate and missing options and does not call the API', async () => {
    const { calls } = mockApi();
    open();
    await userEvent.type(screen.getByLabelText('Question'), 'Pick one please');
    await userEvent.type(screen.getByLabelText('Option 1'), 'Same');
    await userEvent.type(screen.getByLabelText('Option 2'), ' same ');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Options must be unique.')).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('keeps answer changes unavailable for anonymous polls', async () => {
    mockApi();
    open();
    expect(screen.getByRole('switch', { name: /Anonymous responses/ })).toBeChecked();
    expect(screen.getByRole('switch', { name: /change their answer/ })).toBeDisabled();
    await userEvent.click(screen.getByRole('switch', { name: /Anonymous responses/ }));
    expect(screen.getByRole('switch', { name: /change their answer/ })).toBeEnabled();
  });

  it('saves a valid poll as a draft with the expected payload', async () => {
    const { calls } = mockApi((url, init) => (url.endsWith('/sessions/s1/polls') && init?.method === 'POST' ? json({ poll: {} }, 201) : undefined));
    open();
    await userEvent.type(screen.getByLabelText('Question'), 'Which index speeds equality lookups?');
    await userEvent.type(screen.getByLabelText('Option 1'), 'Hash');
    await userEvent.type(screen.getByLabelText('Option 2'), 'Bitmap');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/sessions/s1/polls') && c.method === 'POST')).toBe(true));
    const body = calls.find((c) => c.url.endsWith('/sessions/s1/polls') && c.method === 'POST')!.body as Record<string, unknown>;
    expect(body).toMatchObject({ question: 'Which index speeds equality lookups?', type: 'SINGLE_CHOICE', options: ['Hash', 'Bitmap'], isAnonymous: true, allowResponseUpdate: false, resultsVisibility: 'AFTER_CLOSE', durationSeconds: null });
  });

  it('switches to a rating scale without answer options', async () => {
    mockApi();
    open();
    await userEvent.click(screen.getByLabelText('Rating scale'));
    expect(screen.queryByLabelText('Option 1')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Scale')).toBeInTheDocument();
  });
});
