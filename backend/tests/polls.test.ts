import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.ts';
import { sweepExpiredPolls } from '../src/modules/polls/poll.service.ts';
import { key, relaxedApp, resetDb, scenario, singleChoice } from './helpers.ts';

const app = relaxedApp();
beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

async function openedPoll(ctx: Awaited<ReturnType<typeof scenario>>, body: object = singleChoice()) {
  const created = await ctx.L.post(`/api/v1/sessions/${ctx.sessionId}/polls`, body);
  expect(created.status).toBe(201);
  const poll = created.body.poll;
  const opened = await ctx.L.post(`/api/v1/polls/${poll.id}/open`);
  expect(opened.status).toBe(200);
  return opened.body.poll as { id: string; options: { id: string; label: string }[] };
}

describe('session join', () => {
  it('lets an enrolled student join with a valid code (case/space insensitive)', async () => {
    const ctx = await scenario(app);
    const r = await ctx.S[0]!.post('/api/v1/sessions/join', { code: ` ${ctx.code.toLowerCase()} ` });
    expect(r.status).toBe(200);
    expect(r.body.session.id).toBe(ctx.sessionId);
    expect(r.body.session.joinCode).toBeUndefined(); // never leaked to students
    expect(await prisma.attendanceRecord.count({ where: { sessionId: ctx.sessionId } })).toBe(1);
  });

  it('returns one generic error for wrong, rotated, expired and ended-session codes', async () => {
    const ctx = await scenario(app);
    const old = ctx.code;
    const wrong = await ctx.S[0]!.post('/api/v1/sessions/join', { code: 'ZZZZZZ' });
    expect(wrong.status).toBe(404);
    expect(wrong.body.error.code).toBe('INVALID_JOIN_CODE');

    await ctx.L.post(`/api/v1/sessions/${ctx.sessionId}/join-code/rotate`);
    expect((await ctx.S[0]!.post('/api/v1/sessions/join', { code: old })).body.error.code).toBe('INVALID_JOIN_CODE');

    await prisma.lectureSession.update({ where: { id: ctx.sessionId }, data: { joinCodeExpiresAt: new Date(Date.now() - 1000) } });
    const fresh = (await ctx.L.get(`/api/v1/sessions/${ctx.sessionId}`)).body.session.joinCode;
    expect((await ctx.S[0]!.post('/api/v1/sessions/join', { code: fresh })).body.error.code).toBe('INVALID_JOIN_CODE');

    await ctx.L.post(`/api/v1/sessions/${ctx.sessionId}/join-code/rotate`);
    const live = (await ctx.L.get(`/api/v1/sessions/${ctx.sessionId}`)).body.session.joinCode;
    await ctx.L.post(`/api/v1/sessions/${ctx.sessionId}/end`);
    expect((await ctx.S[0]!.post('/api/v1/sessions/join', { code: live })).body.error.code).toBe('INVALID_JOIN_CODE');
  });

  it('does not let a non-enrolled student join an ENROLLED_ONLY session, and does not say why', async () => {
    const ctx = await scenario(app);
    const { makeUser, loggedIn } = await import('./helpers.ts');
    const outsider = await makeUser('STUDENT', 'Outsider');
    const O = await loggedIn(app, outsider.email);
    const r = await O.post('/api/v1/sessions/join', { code: ctx.code });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('INVALID_JOIN_CODE');
  });

  it('allows any signed-in student when the session policy is ANY_SIGNED_IN', async () => {
    const ctx = await scenario(app);
    await ctx.L.patch(`/api/v1/sessions/${ctx.sessionId}`, { accessPolicy: 'ANY_SIGNED_IN' });
    const { makeUser, loggedIn } = await import('./helpers.ts');
    const guest = await loggedIn(app, (await makeUser('STUDENT', 'Guest')).email);
    expect((await guest.post('/api/v1/sessions/join', { code: ctx.code })).status).toBe(200);
    expect((await guest.get(`/api/v1/sessions/${ctx.sessionId}`)).status).toBe(200);
  });
});

describe('attendance', () => {
  it('records an enrolled student who opens a live session without the code, idempotently, and counts them as joined', async () => {
    const ctx = await scenario(app);
    expect((await ctx.S[0]!.post(`/api/v1/sessions/${ctx.sessionId}/attend`)).status).toBe(204);
    expect((await ctx.S[0]!.post(`/api/v1/sessions/${ctx.sessionId}/attend`)).status).toBe(204);
    expect(await prisma.attendanceRecord.count({ where: { sessionId: ctx.sessionId } })).toBe(1);
    expect((await ctx.L.get(`/api/v1/sessions/${ctx.sessionId}`)).body.participants.joined).toBe(1);
  });

  it('refuses lecturers, outsiders and sessions that are not live', async () => {
    const ctx = await scenario(app);
    const { makeUser, loggedIn } = await import('./helpers.ts');
    const outsider = await loggedIn(app, (await makeUser('STUDENT', 'Outsider2')).email);
    expect((await ctx.L.post(`/api/v1/sessions/${ctx.sessionId}/attend`)).status).toBe(403);
    expect((await outsider.post(`/api/v1/sessions/${ctx.sessionId}/attend`)).status).toBe(404);
    await ctx.L.post(`/api/v1/sessions/${ctx.sessionId}/end`);
    expect((await ctx.S[0]!.post(`/api/v1/sessions/${ctx.sessionId}/attend`)).body.error.code).toBe('SESSION_NOT_LIVE');
    expect(await prisma.attendanceRecord.count()).toBe(0);
  });
});

describe('poll lifecycle and permissions', () => {
  it('lets only the course lecturer create and control polls', async () => {
    const ctx = await scenario(app);
    const s = ctx.S[0]!;
    expect((await s.post(`/api/v1/sessions/${ctx.sessionId}/polls`, singleChoice())).status).toBe(403);
    const poll = (await ctx.L.post(`/api/v1/sessions/${ctx.sessionId}/polls`, singleChoice())).body.poll;
    for (const action of ['open', 'pause', 'resume', 'close', 'reveal-results']) {
      expect((await s.post(`/api/v1/polls/${poll.id}/${action}`)).status, action).toBe(404); // draft is invisible to students
    }
    await ctx.L.post(`/api/v1/polls/${poll.id}/open`);
    for (const action of ['pause', 'close', 'reveal-results']) {
      expect((await s.post(`/api/v1/polls/${poll.id}/${action}`)).status, action).toBe(403);
    }
  });

  it('hides drafts from students entirely', async () => {
    const ctx = await scenario(app);
    const draft = (await ctx.L.post(`/api/v1/sessions/${ctx.sessionId}/polls`, singleChoice())).body.poll;
    expect((await ctx.S[0]!.get(`/api/v1/polls/${draft.id}`)).status).toBe(404);
    expect((await ctx.S[0]!.get(`/api/v1/sessions/${ctx.sessionId}/polls`)).body.items).toHaveLength(0);
    expect((await ctx.L.get(`/api/v1/sessions/${ctx.sessionId}/polls`)).body.items).toHaveLength(1);
  });

  it('keeps one active poll per session and walks DRAFT → OPEN → PAUSED → OPEN → CLOSED', async () => {
    const ctx = await scenario(app);
    const a = await openedPoll(ctx);
    const b = (await ctx.L.post(`/api/v1/sessions/${ctx.sessionId}/polls`, singleChoice({ question: 'Second one?' }))).body.poll;
    const clash = await ctx.L.post(`/api/v1/polls/${b.id}/open`);
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('POLL_ALREADY_ACTIVE');
    expect((await ctx.L.post(`/api/v1/polls/${a.id}/pause`)).body.poll.status).toBe('PAUSED');
    expect((await ctx.L.post(`/api/v1/polls/${a.id}/resume`)).body.poll.status).toBe('OPEN');
    expect((await ctx.L.post(`/api/v1/polls/${a.id}/close`)).body.poll.status).toBe('CLOSED');
    expect((await ctx.L.post(`/api/v1/polls/${a.id}/close`)).status).toBe(409);
    expect((await ctx.L.post(`/api/v1/polls/${b.id}/open`)).status).toBe(200);
  });

  it('only edits drafts', async () => {
    const ctx = await scenario(app);
    const draft = (await ctx.L.post(`/api/v1/sessions/${ctx.sessionId}/polls`, singleChoice())).body.poll;
    expect((await ctx.L.put(`/api/v1/polls/${draft.id}`, singleChoice({ question: 'Edited question?', options: ['x', 'y'] }))).body.poll.question).toBe('Edited question?');
    await ctx.L.post(`/api/v1/polls/${draft.id}/open`);
    expect((await ctx.L.put(`/api/v1/polls/${draft.id}`, singleChoice())).status).toBe(409);
    expect((await ctx.L.delete(`/api/v1/polls/${draft.id}`)).status).toBe(409);
  });

  it('refuses to open a poll while the session is not live', async () => {
    const ctx = await scenario(app);
    const draft = (await ctx.L.post(`/api/v1/sessions/${ctx.sessionId}/polls`, singleChoice())).body.poll;
    await ctx.L.post(`/api/v1/sessions/${ctx.sessionId}/pause`);
    expect((await ctx.L.post(`/api/v1/polls/${draft.id}/open`)).body.error.code).toBe('SESSION_NOT_LIVE');
  });

  it('closes open polls when the session ends, and a paused session pauses the poll', async () => {
    const ctx = await scenario(app);
    const poll = await openedPoll(ctx);
    await ctx.L.post(`/api/v1/sessions/${ctx.sessionId}/pause`);
    expect((await ctx.L.get(`/api/v1/polls/${poll.id}`)).body.poll.status).toBe('PAUSED');
    await ctx.L.post(`/api/v1/sessions/${ctx.sessionId}/resume`);
    await ctx.L.post(`/api/v1/polls/${poll.id}/resume`);
    await ctx.L.post(`/api/v1/sessions/${ctx.sessionId}/end`);
    expect((await ctx.L.get(`/api/v1/polls/${poll.id}`)).body.poll.status).toBe('CLOSED');
  });

  it('closes a timed poll on the server when its deadline passes', async () => {
    const ctx = await scenario(app);
    const poll = await openedPoll(ctx, singleChoice({ durationSeconds: 30 }));
    await prisma.poll.update({ where: { id: poll.id }, data: { closesAt: new Date(Date.now() - 1000) } });
    // Even before the sweeper runs, a late answer is refused (client timers are not trusted).
    const late = await ctx.S[0]!.post(`/api/v1/polls/${poll.id}/responses`, { optionIds: [poll.options[0]!.id], idempotencyKey: key() });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('POLL_NOT_OPEN');
    await sweepExpiredPolls();
    expect((await ctx.L.get(`/api/v1/polls/${poll.id}`)).body.poll.status).toBe('CLOSED');
  });
});

describe('response validation and integrity', () => {
  it('accepts a valid answer and rejects invalid ones', async () => {
    const ctx = await scenario(app);
    const poll = await openedPoll(ctx);
    const [a, b] = poll.options;
    const S = ctx.S[0]!;
    const post = (body: object) => S.post(`/api/v1/polls/${poll.id}/responses`, { idempotencyKey: key(), ...body });
    expect((await post({ optionIds: [] })).status).toBe(400);
    expect((await post({ optionIds: [a!.id, b!.id] })).status).toBe(400); // single choice: exactly one
    expect((await post({ optionIds: [a!.id], ratingValue: 3 })).status).toBe(400);
    expect((await post({ optionIds: ['11111111-1111-4111-8111-111111111111'] })).status).toBe(400);
    expect((await post({ optionIds: ['not-a-uuid'] })).status).toBe(400);
    expect((await post({ optionIds: [a!.id], userId: ctx.students[1]!.id })).status).toBe(400); // client-supplied identity is rejected
    const ok = await post({ optionIds: [a!.id] });
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe('created');
  });

  it('blocks cross-poll option injection', async () => {
    const ctx = await scenario(app);
    const first = await openedPoll(ctx);
    await ctx.L.post(`/api/v1/polls/${first.id}/close`);
    const second = await openedPoll(ctx, singleChoice({ question: 'Another question?' }));
    const r = await ctx.S[0]!.post(`/api/v1/polls/${second.id}/responses`, { optionIds: [first.options[0]!.id], idempotencyKey: key() });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INVALID_ANSWER');
    expect(await prisma.pollResponse.count()).toBe(0);
  });

  it('enforces multiple-choice bounds and rating ranges', async () => {
    const ctx = await scenario(app);
    const multi = await openedPoll(ctx, { question: 'Select all that apply', type: 'MULTIPLE_CHOICE', options: ['A', 'B', 'C'], minSelections: 2, maxSelections: 2 });
    const ids = multi.options.map((o) => o.id);
    const S = ctx.S[0]!;
    expect((await S.post(`/api/v1/polls/${multi.id}/responses`, { optionIds: [ids[0]], idempotencyKey: key() })).status).toBe(400);
    expect((await S.post(`/api/v1/polls/${multi.id}/responses`, { optionIds: ids, idempotencyKey: key() })).status).toBe(400);
    expect((await S.post(`/api/v1/polls/${multi.id}/responses`, { optionIds: [ids[0], ids[0]], idempotencyKey: key() })).status).toBe(400);
    expect((await S.post(`/api/v1/polls/${multi.id}/responses`, { optionIds: [ids[0], ids[2]], idempotencyKey: key() })).status).toBe(201);
    expect(await prisma.pollResponseOption.count()).toBe(2); // modelled as rows, not a text blob
    await ctx.L.post(`/api/v1/polls/${multi.id}/close`);

    const rating = await openedPoll(ctx, { question: 'Rate the pace', type: 'RATING', ratingMin: 1, ratingMax: 5 });
    const R = ctx.S[1]!;
    for (const bad of [0, 6, -1]) expect((await R.post(`/api/v1/polls/${rating.id}/responses`, { ratingValue: bad, idempotencyKey: key() })).status).toBe(400);
    expect((await R.post(`/api/v1/polls/${rating.id}/responses`, { optionIds: [multi.options[0]!.id], idempotencyKey: key() })).status).toBe(400);
    expect((await R.post(`/api/v1/polls/${rating.id}/responses`, { ratingValue: 4, idempotencyKey: key() })).status).toBe(201);
  });

  it('rejects answers to closed, paused and draft polls and from non-students', async () => {
    const ctx = await scenario(app);
    const poll = await openedPoll(ctx);
    const answer = { optionIds: [poll.options[0]!.id] };
    expect((await ctx.L.post(`/api/v1/polls/${poll.id}/responses`, { ...answer, idempotencyKey: key() })).status).toBe(403);
    await ctx.L.post(`/api/v1/polls/${poll.id}/pause`);
    expect((await ctx.S[0]!.post(`/api/v1/polls/${poll.id}/responses`, { ...answer, idempotencyKey: key() })).body.error.code).toBe('POLL_NOT_OPEN');
    await ctx.L.post(`/api/v1/polls/${poll.id}/resume`);
    await ctx.L.post(`/api/v1/polls/${poll.id}/close`);
    expect((await ctx.S[0]!.post(`/api/v1/polls/${poll.id}/responses`, { ...answer, idempotencyKey: key() })).body.error.code).toBe('POLL_NOT_OPEN');
  });

  it('rejects answers while the session is paused', async () => {
    const ctx = await scenario(app);
    const poll = await openedPoll(ctx);
    await ctx.L.post(`/api/v1/sessions/${ctx.sessionId}/pause`);
    await ctx.L.post(`/api/v1/polls/${poll.id}/resume`).catch(() => undefined);
    const r = await ctx.S[0]!.post(`/api/v1/polls/${poll.id}/responses`, { optionIds: [poll.options[0]!.id], idempotencyKey: key() });
    expect(r.status).toBe(409);
  });

  it('treats a retry with the same idempotency key as safe, and a different key as a duplicate', async () => {
    const ctx = await scenario(app);
    const poll = await openedPoll(ctx);
    const S = ctx.S[0]!;
    const k = key();
    const body = { optionIds: [poll.options[1]!.id], idempotencyKey: k };
    expect((await S.post(`/api/v1/polls/${poll.id}/responses`, body)).status).toBe(201);
    const retry = await S.post(`/api/v1/polls/${poll.id}/responses`, body);
    expect(retry.status).toBe(200);
    expect(retry.body.status).toBe('duplicate');
    const dup = await S.post(`/api/v1/polls/${poll.id}/responses`, { optionIds: [poll.options[0]!.id], idempotencyKey: key() });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ALREADY_RESPONDED');
    expect(await prisma.pollResponse.count()).toBe(1);
  });

  it('records exactly one response when the same student submits concurrently', async () => {
    const ctx = await scenario(app);
    const poll = await openedPoll(ctx);
    const S = ctx.S[0]!;
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => S.post(`/api/v1/polls/${poll.id}/responses`, { optionIds: [poll.options[i % 3]!.id], idempotencyKey: key() })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(7);
    expect(await prisma.pollResponse.count()).toBe(1);
    expect(await prisma.pollParticipation.count()).toBe(1);
  });

  it('computes aggregates that equal the persisted responses', async () => {
    const ctx = await scenario(app, 4);
    const poll = await openedPoll(ctx);
    const [a, b] = poll.options;
    const picks = [a, a, b, a];
    for (const [i, s] of ctx.S.entries()) await s.post('/api/v1/sessions/join', { code: ctx.code });
    for (const [i, s] of ctx.S.entries()) expect((await s.post(`/api/v1/polls/${poll.id}/responses`, { optionIds: [picks[i]!.id], idempotencyKey: key() })).status).toBe(201);
    const r = (await ctx.L.get(`/api/v1/polls/${poll.id}/results`)).body.results;
    expect(r.totalResponses).toBe(4);
    expect(r.joinedParticipants).toBe(4);
    expect(r.responseRate).toBe(1);
    expect(r.options.find((o: { id: string }) => o.id === a!.id).count).toBe(3);
    expect(r.options.find((o: { id: string }) => o.id === b!.id).count).toBe(1);
    expect(r.options.find((o: { id: string }) => o.id === a!.id).percentOfRespondents).toBe(75);
  });

  it('allows changing an answer only for identified polls that permit it', async () => {
    const ctx = await scenario(app);
    const poll = await openedPoll(ctx, singleChoice({ isAnonymous: false, allowResponseUpdate: true }));
    const S = ctx.S[0]!;
    await S.post(`/api/v1/polls/${poll.id}/responses`, { optionIds: [poll.options[0]!.id], idempotencyKey: key() });
    const upd = await S.post(`/api/v1/polls/${poll.id}/responses`, { optionIds: [poll.options[1]!.id], idempotencyKey: key() });
    expect(upd.status).toBe(200);
    expect(upd.body.status).toBe('updated');
    expect(await prisma.pollResponse.count()).toBe(1);
    expect((await prisma.pollResponseOption.findMany()).map((o) => o.optionId)).toEqual([poll.options[1]!.id]);
    expect((await S.get(`/api/v1/polls/${poll.id}`)).body.poll.myResponse.optionIds).toEqual([poll.options[1]!.id]);
  });
});

describe('result visibility', () => {
  it('keeps results hidden from students until close / reveal, per the poll setting', async () => {
    const ctx = await scenario(app);
    const poll = await openedPoll(ctx, singleChoice({ resultsVisibility: 'AFTER_CLOSE' }));
    const S = ctx.S[0]!;
    await S.post(`/api/v1/polls/${poll.id}/responses`, { optionIds: [poll.options[0]!.id], idempotencyKey: key() });
    expect((await S.get(`/api/v1/polls/${poll.id}/results`)).status).toBe(403);
    expect((await S.get(`/api/v1/polls/${poll.id}/results`)).body.error.code).toBe('RESULTS_HIDDEN');
    const snap = (await S.get(`/api/v1/sessions/${ctx.sessionId}`)).body;
    expect(snap.results).toEqual({}); // snapshot must not smuggle hidden results
    await ctx.L.post(`/api/v1/polls/${poll.id}/close`);
    expect((await S.get(`/api/v1/polls/${poll.id}/results`)).status).toBe(200);

    const hidden = await openedPoll(ctx, singleChoice({ question: 'Hidden results?', resultsVisibility: 'HIDDEN' }));
    await ctx.L.post(`/api/v1/polls/${hidden.id}/close`);
    expect((await S.get(`/api/v1/polls/${hidden.id}/results`)).status).toBe(403);
    await ctx.L.post(`/api/v1/polls/${hidden.id}/reveal-results`);
    expect((await S.get(`/api/v1/polls/${hidden.id}/results`)).status).toBe(200);
  });
});

describe('anonymity isolation', () => {
  it('stores anonymous answers with no user id or timestamp and exposes no identity anywhere', async () => {
    const ctx = await scenario(app);
    const poll = await openedPoll(ctx, singleChoice({ isAnonymous: true, resultsVisibility: 'LIVE' }));
    for (const s of ctx.S) await s.post(`/api/v1/polls/${poll.id}/responses`, { optionIds: [poll.options[1]!.id], idempotencyKey: key() });
    const rows = await prisma.pollResponse.findMany({ where: { pollId: poll.id } });
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.userId).toBeNull();
      expect(r.submittedAt).toBeNull();
    }
    // Participation proves THAT a student answered, but nothing links to WHAT they answered.
    expect(await prisma.pollParticipation.count({ where: { pollId: poll.id } })).toBe(3);

    const blobs = [
      JSON.stringify((await ctx.L.get(`/api/v1/polls/${poll.id}/results`)).body),
      JSON.stringify((await ctx.S[0]!.get(`/api/v1/polls/${poll.id}/results`)).body),
      JSON.stringify((await ctx.L.get(`/api/v1/sessions/${ctx.sessionId}`)).body),
      JSON.stringify((await ctx.L.get(`/api/v1/sessions/${ctx.sessionId}/report`)).body),
      (await ctx.L.get(`/api/v1/sessions/${ctx.sessionId}/export.csv?type=results`)).text,
    ];
    for (const blob of blobs) {
      for (const s of ctx.students) {
        expect(blob).not.toContain(s.id);
        expect(blob).not.toContain(s.email);
        expect(blob).not.toContain(s.displayName);
      }
    }
  });

  it('records the user id only for identified polls', async () => {
    const ctx = await scenario(app);
    const poll = await openedPoll(ctx, singleChoice({ isAnonymous: false }));
    await ctx.S[0]!.post(`/api/v1/polls/${poll.id}/responses`, { optionIds: [poll.options[0]!.id], idempotencyKey: key() });
    const row = await prisma.pollResponse.findFirstOrThrow();
    expect(row.userId).toBe(ctx.students[0]!.id);
  });

  it("does not put a student's answer in their participation history", async () => {
    const ctx = await scenario(app);
    const poll = await openedPoll(ctx);
    await ctx.S[0]!.post(`/api/v1/polls/${poll.id}/responses`, { optionIds: [poll.options[2]!.id], idempotencyKey: key() });
    const hist = JSON.stringify((await ctx.S[0]!.get('/api/v1/users/me/participation')).body);
    expect(hist).toContain('Which is a prime number?');
    expect(hist).not.toContain(poll.options[2]!.id);
  });
});

describe('exports', () => {
  it('escapes formula injection in poll text and is restricted to the course lecturer', async () => {
    const ctx = await scenario(app);
    const poll = await openedPoll(ctx, singleChoice({ question: '=HYPERLINK("http://evil")', options: ['=1+1', '@SUM(A1)'] }));
    await ctx.S[0]!.post(`/api/v1/polls/${poll.id}/responses`, { optionIds: [poll.options[0]!.id], idempotencyKey: key() });
    const csv = (await ctx.L.get(`/api/v1/sessions/${ctx.sessionId}/export.csv`)).text;
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'@SUM(A1)");
    expect(csv).not.toMatch(/(^|,)=/m);
    expect((await ctx.S[0]!.get(`/api/v1/sessions/${ctx.sessionId}/export.csv`)).status).toBe(403);
    expect(await prisma.auditLog.count({ where: { action: 'export.results' } })).toBe(1);
  });
});
