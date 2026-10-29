import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connectClient, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.ts';
import { sessionMiddleware } from '../src/middleware/session.ts';
import { createSocketServer } from '../src/realtime/socket.ts';
import { Client, key, loggedIn, makeUser, relaxedApp, resetDb, scenario, singleChoice } from './helpers.ts';

const app = relaxedApp();
let server: http.Server;
let url: string;
let ioServer: ReturnType<typeof createSocketServer>;
const open: Socket[] = [];

beforeAll(async () => {
  server = http.createServer(app);
  ioServer = createSocketServer(server, sessionMiddleware);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  ioServer.close();
  await new Promise((r) => server.close(r));
  await prisma.$disconnect();
});
beforeEach(resetDb);
afterEach(() => {
  while (open.length) open.pop()!.disconnect();
});

type Seen = { name: string; payload: Record<string, unknown> };
async function connect(cookie: string, headers: Record<string, string> = {}) {
  const socket = connectClient(url, { transports: ['websocket'], extraHeaders: { cookie, ...headers }, reconnection: false, forceNew: true });
  const seen: Seen[] = [];
  socket.onAny((name, payload) => seen.push({ name, payload }));
  open.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return { socket, seen };
}
const subscribe = (s: Socket, sessionId: string) => s.emitWithAck('session.subscribe', { sessionId }) as Promise<{ ok: boolean; code?: string }>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred()) return;
    await sleep(25);
  }
  throw new Error('timed out waiting for condition');
}
const named = (seen: Seen[], n: string) => seen.filter((e) => e.name === n);

describe('connection security', () => {
  it('rejects connections without a valid session cookie', async () => {
    await expect(connect('')).rejects.toThrow(/UNAUTHENTICATED/);
    await expect(connect('lfps.sid=s%3Aforged.cookie')).rejects.toThrow();
  });

  it('rejects cross-site WebSocket handshakes (Origin allowlist)', async () => {
    const ctx = await scenario(app, 1);
    await expect(connect(ctx.S[0]!.cookie, { origin: 'https://evil.example' })).rejects.toThrow();
    await expect(connect(ctx.S[0]!.cookie, { origin: 'http://localhost:5173' })).resolves.toBeTruthy();
  });

  it('refuses sockets for deactivated accounts', async () => {
    const ctx = await scenario(app, 1);
    await prisma.user.update({ where: { id: ctx.students[0]!.id }, data: { isActive: false } });
    await expect(connect(ctx.S[0]!.cookie)).rejects.toThrow(/UNAUTHENTICATED/);
  });
});

describe('room authorization', () => {
  it('does not let a student outside the course subscribe, and does not reveal the session exists', async () => {
    const ctx = await scenario(app);
    const outsider = await loggedIn(app, (await makeUser('STUDENT', 'Outsider')).email);
    const { socket, seen } = await connect(outsider.cookie);
    const ack = await subscribe(socket, ctx.sessionId);
    expect(ack).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    const poll = (await ctx.L.post(`/api/v1/sessions/${ctx.sessionId}/polls`, singleChoice())).body.poll;
    await ctx.L.post(`/api/v1/polls/${poll.id}/open`);
    await sleep(400);
    expect(seen.filter((e) => e.name.startsWith('poll.') || e.name.startsWith('session.'))).toHaveLength(0);
  });

  it('rejects client-chosen rooms, unknown fields and malformed payloads', async () => {
    const ctx = await scenario(app, 1);
    const { socket } = await connect(ctx.S[0]!.cookie);
    expect(await socket.emitWithAck('session.subscribe', { sessionId: ctx.sessionId, room: `session:${ctx.sessionId}:staff` })).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
    expect(await socket.emitWithAck('session.subscribe', { sessionId: 'nope' })).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
    expect(await socket.emitWithAck('session.subscribe', 'garbage')).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
  });

  it('places a student in the student room only, so staff-only events never reach them', async () => {
    const ctx = await scenario(app, 1);
    const stu = await connect(ctx.S[0]!.cookie);
    await subscribe(stu.socket, ctx.sessionId);
    const lec = await connect(ctx.L.cookie);
    await subscribe(lec.socket, ctx.sessionId);
    await ctx.S[0]!.post('/api/v1/sessions/join', { code: ctx.code });
    await waitFor(() => named(lec.seen, 'participants.updated').length > 0);
    expect(named(stu.seen, 'participants.updated')).toHaveLength(0);
  });

  it('keeps administrators out of live rooms', async () => {
    const ctx = await scenario(app, 1);
    const admin = await loggedIn(app, (await makeUser('ADMIN', 'Admin Rt')).email);
    const { socket } = await connect(admin.cookie);
    expect(await subscribe(socket, ctx.sessionId)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('requires a subscription before a snapshot can be requested', async () => {
    const ctx = await scenario(app, 1);
    const { socket } = await connect(ctx.S[0]!.cookie);
    expect(await socket.emitWithAck('session.request_snapshot', { sessionId: ctx.sessionId })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('throttles bursts of events per socket with a clear error', async () => {
    const ctx = await scenario(app, 1);
    const { socket } = await connect(ctx.S[0]!.cookie);
    const acks = await Promise.all(Array.from({ length: 34 }, () => socket.emitWithAck('session.request_snapshot', { sessionId: ctx.sessionId }) as Promise<{ code?: string }>));
    expect(acks.filter((a) => a.code === 'RATE_LIMITED').length).toBeGreaterThanOrEqual(1);
    expect(socket.connected).toBe(true);
  });

  it('disconnects a socket that keeps flooding after being throttled', async () => {
    const ctx = await scenario(app, 1);
    const { socket } = await connect(ctx.S[0]!.cookie);
    const dropped = new Promise<string>((r) => socket.once('disconnect', r));
    for (let i = 0; i < 60; i++) socket.emit('session.request_snapshot', { sessionId: ctx.sessionId });
    expect(await dropped).toBe('io server disconnect');
  });
});

describe('event delivery and privacy', () => {
  it('sends audience-appropriate snapshots', async () => {
    const ctx = await scenario(app, 1);
    const draft = (await ctx.L.post(`/api/v1/sessions/${ctx.sessionId}/polls`, singleChoice())).body.poll;
    const stu = await connect(ctx.S[0]!.cookie);
    expect((await subscribe(stu.socket, ctx.sessionId)).ok).toBe(true);
    await waitFor(() => named(stu.seen, 'session.snapshot').length === 1);
    const snap = named(stu.seen, 'session.snapshot')[0]!.payload as { snapshot: { access: string; polls: unknown[]; session: Record<string, unknown> } };
    expect(snap.snapshot.access).toBe('STUDENT');
    expect(snap.snapshot.polls).toHaveLength(0); // draft hidden
    expect(snap.snapshot.session.joinCode).toBeUndefined();
    expect(JSON.stringify(snap)).not.toContain(draft.id);
    expect(JSON.stringify(snap)).not.toContain(ctx.code);

    const lec = await connect(ctx.L.cookie);
    await subscribe(lec.socket, ctx.sessionId);
    await waitFor(() => named(lec.seen, 'session.snapshot').length === 1);
    const lsnap = named(lec.seen, 'session.snapshot')[0]!.payload as { snapshot: { access: string; polls: unknown[]; session: { joinCode: string } } };
    expect(lsnap.snapshot.access).toBe('LECTURER');
    expect(lsnap.snapshot.polls).toHaveLength(1);
    expect(lsnap.snapshot.session.joinCode).toBe(ctx.code);
  });

  it('pushes poll lifecycle and aggregate events, withholding hidden results and all identities from students', async () => {
    const ctx = await scenario(app, 3);
    const stu = await connect(ctx.S[0]!.cookie);
    const lec = await connect(ctx.L.cookie);
    await subscribe(stu.socket, ctx.sessionId);
    await subscribe(lec.socket, ctx.sessionId);

    const poll = (await ctx.L.post(`/api/v1/sessions/${ctx.sessionId}/polls`, singleChoice({ resultsVisibility: 'AFTER_CLOSE', isAnonymous: false }))).body.poll;
    await ctx.L.post(`/api/v1/polls/${poll.id}/open`);
    await waitFor(() => named(stu.seen, 'poll.opened').length === 1 && named(lec.seen, 'poll.opened').length === 1);
    const studentView = (named(stu.seen, 'poll.opened')[0]!.payload as { poll: Record<string, unknown> }).poll;
    const staffView = (named(lec.seen, 'poll.opened')[0]!.payload as { poll: Record<string, unknown> }).poll;
    expect(studentView.resultsVisible).toBe(false);
    expect(studentView.resultsVisibility).toBeUndefined(); // staff-only configuration
    expect(studentView.createdAt).toBeUndefined();
    expect(staffView.resultsVisibility).toBe('AFTER_CLOSE');

    const optionIds = (studentView.options as { id: string }[]).map((o) => o.id);
    for (const [i, s] of ctx.S.entries()) await s.post(`/api/v1/polls/${poll.id}/responses`, { optionIds: [optionIds[i % 2]], idempotencyKey: key() });
    await waitFor(() => named(lec.seen, 'poll.results_updated').some((e) => (e.payload.results as { totalResponses: number }).totalResponses === 3));
    await sleep(500);
    expect(named(stu.seen, 'poll.results_updated')).toHaveLength(0); // hidden until close

    await ctx.L.post(`/api/v1/polls/${poll.id}/close`);
    await waitFor(() => named(stu.seen, 'poll.results_updated').length > 0 && named(stu.seen, 'poll.closed').length > 0);
    const released = named(stu.seen, 'poll.results_updated').at(-1)!.payload.results as { totalResponses: number; options: { count: number }[] };
    expect(released.totalResponses).toBe(3);
    expect(released.options.reduce((s, o) => s + o.count, 0)).toBe(3);

    // No event sent to a student ever contains another student's identity or a raw response record.
    const wire = JSON.stringify(stu.seen);
    for (const s of ctx.students) {
      expect(wire).not.toContain(s.id);
      expect(wire).not.toContain(s.email);
    }
    expect(wire).not.toMatch(/participantKey|idempotencyKey|userId/);
  });

  it('streams session state changes to both audiences, with the join code to staff only', async () => {
    const ctx = await scenario(app, 1);
    const stu = await connect(ctx.S[0]!.cookie);
    const lec = await connect(ctx.L.cookie);
    await subscribe(stu.socket, ctx.sessionId);
    await subscribe(lec.socket, ctx.sessionId);
    await ctx.L.post(`/api/v1/sessions/${ctx.sessionId}/pause`);
    await waitFor(() => named(stu.seen, 'session.state_changed').length === 1 && named(lec.seen, 'session.state_changed').length === 1);
    expect(named(stu.seen, 'session.state_changed')[0]!.payload).toMatchObject({ status: 'PAUSED' });
    expect(JSON.stringify(named(stu.seen, 'session.state_changed')[0]!.payload)).not.toContain('joinCode');
    expect(JSON.stringify(named(lec.seen, 'session.state_changed')[0]!.payload)).toContain('joinCode');
    for (const e of [...named(stu.seen, 'session.state_changed'), ...named(lec.seen, 'session.state_changed')]) {
      expect(e.payload).toEqual(expect.objectContaining({ eventId: expect.any(String), sessionId: ctx.sessionId, occurredAt: expect.any(String) }));
    }
  });

  it('closes timed-out polls and notifies clients without any lecturer action', async () => {
    const ctx = await scenario(app, 1);
    const stu = await connect(ctx.S[0]!.cookie);
    await subscribe(stu.socket, ctx.sessionId);
    const poll = (await ctx.L.post(`/api/v1/sessions/${ctx.sessionId}/polls`, singleChoice({ durationSeconds: 30 }))).body.poll;
    await ctx.L.post(`/api/v1/polls/${poll.id}/open`);
    await prisma.poll.update({ where: { id: poll.id }, data: { closesAt: new Date(Date.now() - 500) } });
    const { sweepExpiredPolls } = await import('../src/modules/polls/poll.service.ts');
    await sweepExpiredPolls();
    await waitFor(() => named(stu.seen, 'poll.closed').length === 1);
    expect((named(stu.seen, 'poll.closed')[0]!.payload.poll as { status: string }).status).toBe('CLOSED');
  });
});

describe('reconnection and revocation', () => {
  it('resynchronises from an authoritative snapshot after a reconnect, without double-submitting', async () => {
    const ctx = await scenario(app, 1);
    const poll = (await ctx.L.post(`/api/v1/sessions/${ctx.sessionId}/polls`, singleChoice())).body.poll;
    await ctx.L.post(`/api/v1/polls/${poll.id}/open`);
    const first = await connect(ctx.S[0]!.cookie);
    await subscribe(first.socket, ctx.sessionId);
    const idem = key();
    const optionId = (await ctx.S[0]!.get(`/api/v1/polls/${poll.id}`)).body.poll.options[0].id;
    expect((await ctx.S[0]!.post(`/api/v1/polls/${poll.id}/responses`, { optionIds: [optionId], idempotencyKey: idem })).status).toBe(201);
    first.socket.disconnect(); // network drop

    await ctx.L.post(`/api/v1/polls/${poll.id}/close`); // happens while the student is offline

    const second = await connect(ctx.S[0]!.cookie);
    await subscribe(second.socket, ctx.sessionId);
    await waitFor(() => named(second.seen, 'session.snapshot').length === 1);
    const snap = (named(second.seen, 'session.snapshot')[0]!.payload as { snapshot: { polls: { status: string; hasResponded: boolean }[] } }).snapshot;
    expect(snap.polls[0]).toMatchObject({ status: 'CLOSED', hasResponded: true });

    // A blind client retry of the same logical submission is safe.
    const retry = await ctx.S[0]!.post(`/api/v1/polls/${poll.id}/responses`, { optionIds: [optionId], idempotencyKey: idem });
    expect([200, 409]).toContain(retry.status); // 200 duplicate while open; 409 once closed — never a second record
    expect(await prisma.pollResponse.count()).toBe(1);
  });

  it('disconnects live sockets when an administrator deactivates the account', async () => {
    const ctx = await scenario(app, 1);
    const admin = await makeUser('ADMIN', 'Revoker');
    const A = await loggedIn(app, admin.email);
    const stu = await connect(ctx.S[0]!.cookie);
    await subscribe(stu.socket, ctx.sessionId);
    const dropped = new Promise<string>((r) => stu.socket.once('disconnect', r));
    await A.patch(`/api/v1/admin/users/${ctx.students[0]!.id}`, { isActive: false });
    expect(await dropped).toBe('io server disconnect');
  });

  it('disconnects sockets on logout and when a student is removed from the course', async () => {
    const ctx = await scenario(app, 2);
    const a = await connect(ctx.S[0]!.cookie);
    const b = await connect(ctx.S[1]!.cookie);
    const droppedA = new Promise<string>((r) => a.socket.once('disconnect', r));
    const droppedB = new Promise<string>((r) => b.socket.once('disconnect', r));
    await ctx.S[0]!.post('/api/v1/auth/logout');
    await ctx.L.delete(`/api/v1/courses/${ctx.course.id}/enrolments/${ctx.students[1]!.id}`);
    expect(await droppedA).toBe('io server disconnect');
    expect(await droppedB).toBe('io server disconnect');
  });
});
void Client;
