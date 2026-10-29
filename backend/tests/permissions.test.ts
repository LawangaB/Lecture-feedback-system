import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.ts';
import { key, loggedIn, makeUser, relaxedApp, resetDb, scenario, singleChoice } from './helpers.ts';

const app = relaxedApp();
beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe('horizontal privilege escalation (IDOR/BOLA)', () => {
  it("hides another lecturer's course, sessions, polls, feedback, reports and exports", async () => {
    const ctx = await scenario(app);
    const poll = (await ctx.L.post(`/api/v1/sessions/${ctx.sessionId}/polls`, singleChoice())).body.poll;
    const other = await loggedIn(app, (await makeUser('LECTURER', 'Other Lecturer')).email);
    const probes: [string, string][] = [
      ['get', `/api/v1/courses/${ctx.course.id}`],
      ['get', `/api/v1/courses/${ctx.course.id}/enrolments`],
      ['get', `/api/v1/courses/${ctx.course.id}/sessions`],
      ['get', `/api/v1/sessions/${ctx.sessionId}`],
      ['get', `/api/v1/sessions/${ctx.sessionId}/polls`],
      ['get', `/api/v1/polls/${poll.id}`],
      ['get', `/api/v1/polls/${poll.id}/results`],
      ['get', `/api/v1/sessions/${ctx.sessionId}/report`],
      ['get', `/api/v1/sessions/${ctx.sessionId}/export.csv`],
      ['get', `/api/v1/sessions/${ctx.sessionId}/feedback`],
      ['get', `/api/v1/sessions/${ctx.sessionId}/feedback/summary`],
      ['post', `/api/v1/sessions/${ctx.sessionId}/start`],
      ['post', `/api/v1/sessions/${ctx.sessionId}/end`],
      ['post', `/api/v1/sessions/${ctx.sessionId}/join-code/rotate`],
      ['post', `/api/v1/polls/${poll.id}/open`],
      ['post', `/api/v1/polls/${poll.id}/reveal-results`],
    ];
    for (const [method, url] of probes) {
      const r = method === 'get' ? await other.get(url) : await other.post(url);
      expect(r.status, `${method} ${url}`).toBe(404);
    }
    expect((await other.post(`/api/v1/sessions/${ctx.sessionId}/polls`, singleChoice())).status).toBe(404);
    expect((await other.post(`/api/v1/courses/${ctx.course.id}/sessions`, { title: 'Hijack' })).status).toBe(404);
    expect((await other.post(`/api/v1/courses/${ctx.course.id}/enrolments`, { emails: ['x@t.test'] })).status).toBe(404);
    expect((await other.patch(`/api/v1/courses/${ctx.course.id}`, { title: 'Pwned' })).status).toBe(404);
    expect((await other.get('/api/v1/courses')).body.items).toHaveLength(0);
  });

  it("hides a student's course and sessions from students of other courses", async () => {
    const ctx = await scenario(app);
    const outsider = await loggedIn(app, (await makeUser('STUDENT', 'Outsider')).email);
    for (const url of [`/api/v1/courses/${ctx.course.id}`, `/api/v1/sessions/${ctx.sessionId}`, `/api/v1/sessions/${ctx.sessionId}/polls`, `/api/v1/courses/${ctx.course.id}/sessions`]) {
      expect((await outsider.get(url)).status, url).toBe(404);
    }
    expect((await outsider.post(`/api/v1/sessions/${ctx.sessionId}/feedback`, { ratings: { CLARITY: 5 }, anonymous: true })).status).toBe(404);
    expect((await outsider.get('/api/v1/sessions')).body).toEqual({ live: [], upcoming: [], recent: [] });
  });

  it('lets enrolled students see the course but never the roster or the join code', async () => {
    const ctx = await scenario(app);
    const S = ctx.S[0]!;
    expect((await S.get(`/api/v1/courses/${ctx.course.id}`)).status).toBe(200);
    expect((await S.get(`/api/v1/courses/${ctx.course.id}/enrolments`)).status).toBe(403);
    const snap = (await S.get(`/api/v1/sessions/${ctx.sessionId}`)).body;
    expect(snap.session.joinCode).toBeUndefined();
    expect(snap.access).toBe('STUDENT');
    expect(JSON.stringify(snap)).not.toContain(ctx.code);
    expect((await S.patch(`/api/v1/courses/${ctx.course.id}`, { title: 'Nope' })).status).toBe(403);
    expect((await S.post(`/api/v1/courses/${ctx.course.id}/sessions`, { title: 'Nope' })).status).toBe(403);
    expect((await S.post(`/api/v1/sessions/${ctx.sessionId}/end`)).status).toBe(403);
  });
});

describe('vertical privilege escalation', () => {
  it('blocks students and lecturers from admin APIs and admin-only account fields', async () => {
    const ctx = await scenario(app);
    for (const c of [ctx.S[0]!, ctx.L]) {
      expect((await c.get('/api/v1/admin/users')).status).toBe(403);
      expect((await c.get('/api/v1/admin/audit-events')).status).toBe(403);
      expect((await c.get('/api/v1/admin/overview')).status).toBe(403);
      expect((await c.post('/api/v1/admin/users', { email: 'x@t.test', displayName: 'X', role: 'ADMIN', password: 'Correct-Horse-Battery-9' })).status).toBe(403);
      expect((await c.patch(`/api/v1/admin/users/${ctx.students[0]!.id}`, { role: 'ADMIN' })).status).toBe(403);
    }
    expect((await ctx.S[0]!.post('/api/v1/courses', { code: 'EVIL1', title: 'Student Course' })).status).toBe(403);
    expect((await ctx.S[0]!.patch('/api/v1/auth/me', { displayName: 'Ok', role: 'ADMIN' })).status).toBe(400); // role is not a profile field
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ctx.students[0]!.id } })).role).toBe('STUDENT');
  });

  it('keeps administrators out of live poll results and lecture control', async () => {
    const ctx = await scenario(app);
    const poll = (await ctx.L.post(`/api/v1/sessions/${ctx.sessionId}/polls`, singleChoice())).body.poll;
    await ctx.L.post(`/api/v1/polls/${poll.id}/open`);
    const admin = await loggedIn(app, (await makeUser('ADMIN', 'Admin One')).email);
    expect((await admin.get(`/api/v1/polls/${poll.id}/results`)).status).toBe(403);
    expect((await admin.post(`/api/v1/polls/${poll.id}/close`)).status).toBe(403);
    expect((await admin.post(`/api/v1/sessions/${ctx.sessionId}/end`)).status).toBe(403);
    expect((await admin.get(`/api/v1/sessions/${ctx.sessionId}/feedback`)).status).toBe(403);
    expect((await admin.get(`/api/v1/courses/${ctx.course.id}`)).status).toBe(200); // but can manage the course itself
  });
});

describe('administration', () => {
  it('manages users, revokes sessions on deactivation/role change, and audits it', async () => {
    const admin = await makeUser('ADMIN', 'Root Admin');
    const A = await loggedIn(app, admin.email);
    const created = await A.post('/api/v1/admin/users', { email: 'Teach@T.test', displayName: 'Teacher', role: 'LECTURER', password: 'Correct-Horse-Battery-9' });
    expect(created.status).toBe(201);
    expect(created.body.user.email).toBe('teach@t.test');
    const T = await loggedIn(app, 'teach@t.test');
    expect((await T.post('/api/v1/courses', { code: 'ABC1', title: 'Allowed' })).status).toBe(201);

    expect((await A.patch(`/api/v1/admin/users/${created.body.user.id}`, { role: 'STUDENT' })).status).toBe(200);
    expect((await T.get('/api/v1/auth/me')).status).toBe(401); // role change revoked the session
    const T2 = await loggedIn(app, 'teach@t.test');
    expect((await T2.post('/api/v1/courses', { code: 'ABC2', title: 'Denied' })).status).toBe(403);

    await A.patch(`/api/v1/admin/users/${created.body.user.id}`, { isActive: false });
    expect((await T2.get('/api/v1/auth/me')).status).toBe(401);
    expect((await (await import('./helpers.ts')).Client.prototype.login.call(await new (await import('./helpers.ts')).Client(app).init(), 'teach@t.test')).status).toBe(401);

    const actions = (await prisma.auditLog.findMany({ select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['admin.user_create', 'admin.role_change', 'admin.user_deactivate']));
  });

  it('prevents admins from locking themselves out, and paginates/filter users', async () => {
    const admin = await makeUser('ADMIN', 'Solo Admin');
    for (let i = 0; i < 5; i++) await makeUser('STUDENT', `Person ${i}`);
    const A = await loggedIn(app, admin.email);
    expect((await A.patch(`/api/v1/admin/users/${admin.id}`, { isActive: false })).status).toBe(403);
    expect((await A.patch(`/api/v1/admin/users/${admin.id}`, { role: 'STUDENT' })).status).toBe(403);
    const page = (await A.get('/api/v1/admin/users?pageSize=2&page=2')).body;
    expect(page.total).toBe(6);
    expect(page.items).toHaveLength(2);
    expect((await A.get('/api/v1/admin/users?role=ADMIN')).body.total).toBe(1);
    expect((await A.get('/api/v1/admin/users?search=person%203')).body.total).toBe(1);
    expect((await A.get('/api/v1/admin/users?pageSize=1000')).status).toBe(400);
    expect(JSON.stringify(page)).not.toMatch(/passwordHash|argon2/);
  });

  it('serves a searchable audit log including failed logins', async () => {
    const admin = await makeUser('ADMIN', 'Audit Admin');
    await makeUser('STUDENT', 'Target');
    const { Client } = await import('./helpers.ts');
    await (await new Client(app).init()).login('target@t.test', 'wrong-password-123');
    const A = await loggedIn(app, admin.email);
    const r = (await A.get('/api/v1/admin/audit-events?action=auth.login_failed')).body;
    expect(r.total).toBe(1);
    expect(r.items[0].metadata.reason).toBe('bad_password');
    expect(JSON.stringify(r)).not.toContain('wrong-password');
  });
});

describe('enrolment', () => {
  it('reports emails that could not be added and never lets a student be enrolled as lecturer', async () => {
    const ctx = await scenario(app);
    const extra = await makeUser('STUDENT', 'Extra Student');
    const r = await ctx.L.post(`/api/v1/courses/${ctx.course.id}/enrolments`, { emails: [extra.email, 'ghost@t.test'] });
    expect(r.body).toEqual({ added: 1, notAdded: ['ghost@t.test'] });
    const asLecturer = await ctx.L.post(`/api/v1/courses/${ctx.course.id}/enrolments`, { emails: [extra.email], role: 'LECTURER' });
    expect(asLecturer.body.notAdded).toEqual([extra.email]);
  });

  it('removes a student, who then loses access, and protects the owner', async () => {
    const ctx = await scenario(app);
    expect((await ctx.S[0]!.get(`/api/v1/sessions/${ctx.sessionId}`)).status).toBe(200);
    expect((await ctx.L.delete(`/api/v1/courses/${ctx.course.id}/enrolments/${ctx.students[0]!.id}`)).status).toBe(204);
    expect((await ctx.S[0]!.get(`/api/v1/sessions/${ctx.sessionId}`)).status).toBe(404);
    expect((await ctx.L.delete(`/api/v1/courses/${ctx.course.id}/enrolments/${ctx.lecturer.id}`)).status).toBe(403);
  });
});

describe('validation hygiene', () => {
  it('rejects malformed ids and unexpected query parameters', async () => {
    const ctx = await scenario(app);
    expect((await ctx.L.get('/api/v1/courses/not-a-uuid')).status).toBe(400);
    expect((await ctx.L.get('/api/v1/polls/123/results')).status).toBe(400);
    expect((await ctx.L.get(`/api/v1/sessions/${ctx.sessionId}/feedback?page=0`)).status).toBe(400);
    expect((await ctx.L.get(`/api/v1/sessions/${ctx.sessionId}/export.csv?type=everything`)).status).toBe(400);
  });

  it('rejects duplicate course codes and rejects mass assignment on course update', async () => {
    const ctx = await scenario(app);
    expect((await ctx.L.post('/api/v1/courses', { code: 'cs101', title: 'Duplicate' })).status).toBe(409);
    expect((await ctx.L.patch(`/api/v1/courses/${ctx.course.id}`, { ownerId: ctx.students[0]!.id })).status).toBe(400);
    void key;
  });
});
