import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api } from '@/lib/api';
import type { Poll, PollResults, Session, Snapshot } from '@/types/api';

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';
type Evt<T> = { sessionId: string } & T;

/**
 * Loads an authoritative snapshot over REST, then keeps it fresh from Socket.IO events.
 * Events are treated as notifications: on every (re)connect the server sends a fresh snapshot, so
 * missed, duplicated or out-of-order events cannot leave the UI wrong.
 */
export function useLiveSession(sessionId: string) {
  const qc = useQueryClient();
  const key = useMemo(() => ['session', sessionId] as const, [sessionId]);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [clockOffset, setClockOffset] = useState(0);
  const seen = useRef(new Set<string>());

  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const snap = await api<Snapshot>(`/sessions/${sessionId}`);
      setClockOffset(Date.parse(snap.serverTime) - Date.now()); // lets countdowns follow the server's clock
      return snap;
    },
    staleTime: 15_000,
  });
  const access = query.data?.access;

  useEffect(() => {
    if (!access || access === 'ADMIN') return;
    const socket: Socket = io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'], reconnectionDelayMax: 5000 });
    const patch = (fn: (s: Snapshot) => Snapshot) => qc.setQueryData<Snapshot>(key, (old) => (old ? fn(old) : old));
    const once = (e: { eventId?: string }) => {
      if (!e.eventId) return true;
      if (seen.current.has(e.eventId)) return false; // duplicate delivery
      seen.current.add(e.eventId);
      if (seen.current.size > 500) seen.current.delete(seen.current.values().next().value as string);
      return true;
    };
    const upsertPoll = (polls: Poll[], poll: Poll) => {
      const mine = polls.find((p) => p.id === poll.id);
      const merged = { ...mine, ...poll, hasResponded: mine?.hasResponded, myResponse: mine?.myResponse, responseCount: mine?.responseCount };
      return mine ? polls.map((p) => (p.id === poll.id ? merged : p)) : [...polls, merged].sort((a, b) => a.position - b.position);
    };

    const subscribe = () => socket.emit('session.subscribe', { sessionId });
    socket.on('connect', () => { setConnection('connected'); subscribe(); });
    socket.on('disconnect', (reason) => setConnection(reason === 'io server disconnect' ? 'offline' : 'reconnecting'));
    socket.io.on('reconnect_attempt', () => setConnection('reconnecting'));
    socket.on('connect_error', () => setConnection((c) => (c === 'connected' ? 'reconnecting' : 'offline')));

    socket.on('session.snapshot', (e: Evt<{ snapshot: Snapshot; eventId: string }>) => {
      if (e.sessionId !== sessionId || !once(e)) return;
      setClockOffset(Date.parse(e.snapshot.serverTime) - Date.now());
      qc.setQueryData(key, e.snapshot);
    });
    socket.on('session.state_changed', (e: Evt<{ eventId: string; status: Session['status']; session?: Session }>) => {
      if (e.sessionId !== sessionId || !once(e)) return;
      patch((s) => ({ ...s, session: { ...s.session, ...(e.session ?? {}), status: e.status } }));
      void qc.invalidateQueries({ queryKey: key }); // pull the authoritative state (polls may have changed server-side)
    });
    for (const name of ['poll.created', 'poll.opened', 'poll.updated', 'poll.closed'] as const) {
      socket.on(name, (e: Evt<{ eventId: string; poll: Poll }>) => {
        if (e.sessionId !== sessionId || !once(e)) return;
        patch((s) => ({ ...s, polls: upsertPoll(s.polls, e.poll) }));
      });
    }
    socket.on('poll.deleted', (e: Evt<{ eventId: string; pollId: string }>) => {
      if (e.sessionId !== sessionId || !once(e)) return;
      patch((s) => ({ ...s, polls: s.polls.filter((p) => p.id !== e.pollId) }));
    });
    socket.on('poll.results_updated', (e: Evt<{ eventId: string; pollId: string; results: PollResults }>) => {
      if (e.sessionId !== sessionId || !once(e)) return;
      patch((s) => ({ ...s, results: { ...s.results, [e.pollId]: e.results } }));
    });
    socket.on('participants.updated', (e: Evt<{ eventId: string; joined: number; connected: number }>) => {
      if (e.sessionId !== sessionId || !once(e)) return;
      patch((s) => ({ ...s, participants: { joined: e.joined, connected: e.connected } }));
    });
    return () => {
      socket.emit('session.unsubscribe', { sessionId });
      socket.disconnect();
    };
  }, [access, sessionId, key, qc]);

  return { ...query, snapshot: query.data, connection, clockOffset, queryKey: key };
}
