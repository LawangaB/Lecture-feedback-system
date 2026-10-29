import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../src/app.ts';
import { prisma } from '../src/db.ts';
import { hashPassword } from '../src/utils/password.ts';

export const PW = 'Correct-Horse-Battery-9';
let cachedHash: string | undefined;

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "User","Course","AuditLog","user_sessions" RESTART IDENTITY CASCADE`,
  );
}

export async function makeUser(role: 'STUDENT' | 'LECTURER' | 'ADMIN', name: string, email = `${name.toLowerCase().replace(/\W+/g, '.')}@t.test`) {
  cachedHash ??= await hashPassword(PW);
  return prisma.user.create({ data: { email, displayName: name, role, passwordHash: cachedHash } });
}

/** A cookie-session client that handles the CSRF token like the real frontend does. */
export class Client {
  agent: ReturnType<typeof request.agent>;
  csrf = '';
  cookie = '';
  constructor(app: Express) {
    this.agent = request.agent(app);
  }
  async init() {
    const r = await this.agent.get('/api/v1/auth/csrf');
    this.csrf = r.body.csrfToken;
    this.capture(r);
    return this;
  }
  private capture(r: request.Response) {
    const set = r.headers['set-cookie'] as unknown as string[] | undefined;
    if (set?.length) this.cookie = set.map((c) => c.split(';')[0]).join('; ');
  }
  async login(email: string, password = PW) {
    const r = await this.post('/api/v1/auth/login', { email, password });
    if (r.status === 200) {
      this.csrf = r.body.csrfToken;
      this.capture(r);
    }
    return r;
  }
  get(url: string) {
    return this.agent.get(url);
  }
  post(url: string, body: object = {}) {
    return this.agent.post(url).set('X-CSRF-Token', this.csrf).send(body);
  }
  put(url: string, body: object = {}) {
    return this.agent.put(url).set('X-CSRF-Token', this.csrf).send(body);
  }
  patch(url: string, body: object = {}) {
    return this.agent.patch(url).set('X-CSRF-Token', this.csrf).send(body);
  }
  delete(url: string) {
    return this.agent.delete(url).set('X-CSRF-Token', this.csrf);
  }
}

export async function loggedIn(app: Express, email: string) {
  const c = await new Client(app).init();
  const r = await c.login(email);
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return c;
}

/** Course + live session with one lecturer and N enrolled students. */
export async function scenario(app: Express, studentCount = 3) {
  const lecturer = await makeUser('LECTURER', 'Lee Lecturer');
  const students = [];
  for (let i = 1; i <= studentCount; i++) students.push(await makeUser('STUDENT', `Student ${i}`));
  const L = await loggedIn(app, lecturer.email);
  const course = (await L.post('/api/v1/courses', { code: 'CS101', title: 'Intro to Testing' })).body.course;
  await L.post(`/api/v1/courses/${course.id}/enrolments`, { emails: students.map((s) => s.email) });
  const sessionId = (await L.post(`/api/v1/courses/${course.id}/sessions`, { title: 'Lecture 1' })).body.session.id as string;
  const started = await L.post(`/api/v1/sessions/${sessionId}/start`);
  const code = started.body.session.joinCode as string;
  const S = await Promise.all(students.map((s) => loggedIn(app, s.email)));
  return { lecturer, students, L, S, course, sessionId, code };
}

export const singleChoice = (extra: object = {}) => ({
  question: 'Which is a prime number?',
  type: 'SINGLE_CHOICE',
  options: ['4', '7', '9'],
  isAnonymous: true,
  resultsVisibility: 'AFTER_CLOSE',
  ...extra,
});

let n = 0;
export const key = () => `idem-${Date.now()}-${n++}-xxxx`;

/** App with generous limits for functional tests; rate limiting itself is tested with real limits in auth.test.ts. */
export const relaxedApp = () => createApp({ limits: { global: 1e6, auth: 1e5, join: 1e5, submit: 1e5, feedback: 1e5, exports: 1e5 } });
