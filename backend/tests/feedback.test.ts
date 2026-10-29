import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.ts';
import { relaxedApp, resetDb, scenario } from './helpers.ts';

const app = relaxedApp();
beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('lecture feedback', () => {
  it('stores anonymous feedback with no identity or timestamp and shows the lecturer no author', async () => {
    const ctx = await scenario(app);
    const r = await ctx.S[0]!.post(`/api/v1/sessions/${ctx.sessionId}/feedback`, { ratings: { CLARITY: 4, PACE: 2 }, comment: 'Too fast on slide 12', anonymous: true });
    expect(r.status).toBe(201);
    const row = await prisma.feedbackEntry.findFirstOrThrow();
    expect(row.userId).toBeNull();
    expect(row.createdAt).toBeNull();
    const list = (await ctx.L.get(`/api/v1/sessions/${ctx.sessionId}/feedback`)).body;
    expect(list.items[0]).toMatchObject({ author: null, createdAt: null, comment: 'Too fast on slide 12' });
    const blob = JSON.stringify(list) + (await ctx.L.get(`/api/v1/sessions/${ctx.sessionId}/export.csv?type=feedback`)).text + JSON.stringify((await ctx.L.get(`/api/v1/sessions/${ctx.sessionId}/report`)).body);
    expect(blob).not.toContain(ctx.students[0]!.displayName);
    expect(blob).not.toContain(ctx.students[0]!.id);
    expect(blob).toContain('Anonymous');
  });

  it('attributes identified feedback and allows one submission per student per session', async () => {
    const ctx = await scenario(app);
    const S = ctx.S[0]!;
    expect((await S.post(`/api/v1/sessions/${ctx.sessionId}/feedback`, { ratings: { CLARITY: 5 }, anonymous: false })).status).toBe(201);
    const again = await S.post(`/api/v1/sessions/${ctx.sessionId}/feedback`, { ratings: { CLARITY: 1 }, anonymous: true });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_SUBMITTED');
    expect((await S.get(`/api/v1/sessions/${ctx.sessionId}/feedback/mine`)).body.submitted).toBe(true);
    expect((await ctx.S[1]!.get(`/api/v1/sessions/${ctx.sessionId}/feedback/mine`)).body.submitted).toBe(false);
    expect((await ctx.L.get(`/api/v1/sessions/${ctx.sessionId}/feedback`)).body.items[0].author.displayName).toBe('Student 1');
  });

  it('validates ratings and requires some content', async () => {
    const ctx = await scenario(app);
    const S = ctx.S[0]!;
    const url = `/api/v1/sessions/${ctx.sessionId}/feedback`;
    expect((await S.post(url, { ratings: { CLARITY: 6 }, anonymous: true })).status).toBe(400);
    expect((await S.post(url, { ratings: { CLARITY: 0 }, anonymous: true })).status).toBe(400);
    expect((await S.post(url, { ratings: { BOGUS: 3 }, anonymous: true })).status).toBe(400);
    expect((await S.post(url, { ratings: {}, anonymous: true })).body.error.code).toBe('EMPTY_FEEDBACK');
    expect((await S.post(url, { ratings: {}, comment: 'x'.repeat(2001), anonymous: true })).status).toBe(400);
    expect((await S.post(url, { ratings: { PACE: 3 } })).status).toBe(400); // anonymity choice must be explicit
  });

  it('is closed to lecturers, to sessions that have not started, and when disabled', async () => {
    const ctx = await scenario(app);
    expect((await ctx.L.post(`/api/v1/sessions/${ctx.sessionId}/feedback`, { ratings: { PACE: 3 }, anonymous: true })).status).toBe(403);
    const scheduled = (await ctx.L.post(`/api/v1/courses/${ctx.course.id}/sessions`, { title: 'Later' })).body.session.id;
    expect((await ctx.S[0]!.post(`/api/v1/sessions/${scheduled}/feedback`, { ratings: { PACE: 3 }, anonymous: true })).body.error.code).toBe('SESSION_NOT_STARTED');
    await ctx.L.patch(`/api/v1/sessions/${ctx.sessionId}`, { feedbackEnabled: false });
    expect((await ctx.S[0]!.post(`/api/v1/sessions/${ctx.sessionId}/feedback`, { ratings: { PACE: 3 }, anonymous: true })).body.error.code).toBe('FEEDBACK_DISABLED');
  });

  it('keeps feedback visibility lecturer-only', async () => {
    const ctx = await scenario(app);
    await ctx.S[0]!.post(`/api/v1/sessions/${ctx.sessionId}/feedback`, { ratings: { CLARITY: 3 }, comment: 'private', anonymous: false });
    expect((await ctx.S[1]!.get(`/api/v1/sessions/${ctx.sessionId}/feedback`)).status).toBe(403);
    expect((await ctx.S[1]!.get(`/api/v1/sessions/${ctx.sessionId}/feedback/summary`)).status).toBe(403);
  });

  it('aggregates with explicit denominators and filters', async () => {
    const ctx = await scenario(app, 4);
    for (const s of ctx.S) await s.post('/api/v1/sessions/join', { code: ctx.code });
    const give = (i: number, ratings: object, comment?: string, anonymous = true) => ctx.S[i]!.post(`/api/v1/sessions/${ctx.sessionId}/feedback`, { ratings, comment, anonymous });
    await give(0, { CLARITY: 5, PACE: 3 }, 'great');
    await give(1, { CLARITY: 3 });
    await give(2, { CLARITY: 1, PACE: 5 }, undefined, false);
    const s = (await ctx.L.get(`/api/v1/sessions/${ctx.sessionId}/feedback/summary`)).body.summary;
    expect(s.totalEntries).toBe(3);
    expect(s.joinedParticipants).toBe(4);
    expect(s.submissionRate).toBe(0.75); // 4th student's non-response is not counted as a rating
    expect(s.commentCount).toBe(1);
    const clarity = s.dimensions.find((d: { dimension: string }) => d.dimension === 'CLARITY');
    expect(clarity).toMatchObject({ count: 3, average: 3 });
    expect(s.dimensions.find((d: { dimension: string }) => d.dimension === 'MATERIALS')).toMatchObject({ count: 0, average: null });
    const q = async (qs: string) => (await ctx.L.get(`/api/v1/sessions/${ctx.sessionId}/feedback?${qs}`)).body.total;
    expect(await q('anonymous=true')).toBe(2);
    expect(await q('anonymous=false')).toBe(1);
    expect(await q('hasComment=true')).toBe(1);
    expect(await q('dimension=CLARITY&maxRating=2')).toBe(1);
    expect(await q('dimension=PACE&minRating=4')).toBe(1);
  });

  it('lets a lecturer hide a comment from lists and exports (audited)', async () => {
    const ctx = await scenario(app);
    await ctx.S[0]!.post(`/api/v1/sessions/${ctx.sessionId}/feedback`, { ratings: { CLARITY: 2 }, comment: 'rude comment', anonymous: true });
    const id = (await ctx.L.get(`/api/v1/sessions/${ctx.sessionId}/feedback`)).body.items[0].id;
    expect((await ctx.S[0]!.patch(`/api/v1/feedback/${id}`, { isHidden: true })).status).toBe(403);
    expect((await ctx.L.patch(`/api/v1/feedback/${id}`, { isHidden: true })).status).toBe(204);
    expect((await ctx.L.get(`/api/v1/sessions/${ctx.sessionId}/feedback`)).body.items[0].comment).toBeNull();
    expect((await ctx.L.get(`/api/v1/sessions/${ctx.sessionId}/export.csv?type=feedback`)).text).not.toContain('rude comment');
    expect(await prisma.auditLog.count({ where: { action: 'feedback.hide' } })).toBe(1);
  });

  it('stores comments verbatim as inert text (output is escaped by the client, never rendered as HTML)', async () => {
    const ctx = await scenario(app);
    const xss = '<img src=x onerror=alert(1)>';
    await ctx.S[0]!.post(`/api/v1/sessions/${ctx.sessionId}/feedback`, { ratings: { CLARITY: 4 }, comment: xss, anonymous: true });
    const r = await ctx.L.get(`/api/v1/sessions/${ctx.sessionId}/feedback`);
    expect(r.headers['content-type']).toMatch(/application\/json/);
    expect(r.body.items[0].comment).toBe(xss);
  });
});
