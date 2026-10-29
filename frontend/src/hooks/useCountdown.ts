import { useEffect, useState } from 'react';
import type { Poll } from '@/types/api';

/** Remaining milliseconds for a timed poll, using the server's clock. The server enforces the deadline; this is display only. */
export function useCountdown(poll: Pick<Poll, 'status' | 'closesAt' | 'remainingMs' | 'durationSeconds'> | undefined, clockOffset: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (poll?.status !== 'OPEN' || !poll.closesAt) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [poll?.status, poll?.closesAt]);
  if (!poll || !poll.durationSeconds) return null;
  if (poll.status === 'PAUSED') return poll.remainingMs;
  if (poll.status === 'OPEN' && poll.closesAt) return Math.max(0, Date.parse(poll.closesAt) - (now + clockOffset));
  return null;
}
