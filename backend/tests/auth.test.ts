import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.ts';
import { prisma } from '../src/db.ts';
import { devOutbox } from '../src/services/mail.ts';
import { sha256Hex } from '../src/utils/crypto.ts';
import { Client, PW, loggedIn, makeUser, resetDb } from './helpers.ts';

const app = createApp();
beforeAll(resetDb);
beforeEach(resetDb);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('registration and login', () => {
  it('registers a student, stores an Argon2id hash, and signs in', async () => {
    const c = await new Client(app).init();
    const r = await c.post('/api/v1/auth/register', { email: 'New@T.test', password: PW, displayName: 'New Student' });
    expect(r.status).toBe(201);
    expect(r.body.user).toMatchObject({ email: 'new@t.test', role: 'STUDENT' });
    expect(r.body.user.passwordHash).toBeUndefined();
    const row = await prisma.user.findUniqueOrThrow({ where: { email: 'new@t.test' } });
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect((await c.get('/api/v1/auth/me')).body.user.email).toBe('new@t.test');
  });

  it('ignores attempts to self-register as a lecturer or admin (strict body)', async () => {
    const c = await new Client(app).init();
    const r = await c.post('/api/v1/auth/register', { email: 'x@t.test', password: PW, displayName: 'X', role: 'ADMIN' });
    expect(r.status).toBe(400);
    expect(await prisma.user.count()).toBe(0);
  });

  it('rejects weak passwords', async () => {
    const c = await new Client(app).init();
    const r = await c.post('/api/v1/auth/register', { email: 'w@t.test', password: 'short', displayName: 'W' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns the same generic error for unknown email, wrong password and disabled account', async () => {
    const u = await makeUser('STUDENT', 'Real');
    const dis = await makeUser('STUDENT', 'Disabled');
    await prisma.user.update({ where: { id: dis.id }, data: { isActive: false } });
    const bodies = [];
    for (const [email, password] of [['nobody@t.test', PW], [u.email, 'wrong-password-123'], [dis.email, PW]] as const) {
      const c = await new Client(app).init();
      const r = await c.login(email, password);
      expect(r.status).toBe(401);
      bodies.push(r.body.error.message + r.body.error.code);
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it('rotates the session id on login (session fixation defence)', async () => {
    const u = await makeUser('STUDENT', 'Fix');
    const c = await new Client(app).init();
    const before = c.cookie;
    await c.login(u.email);
    expect(c.cookie).not.toBe('');
    expect(c.cookie).not.toBe(before);
  });

  it('sets HttpOnly, SameSite=Lax cookies and never exposes the password hash', async () => {
    const u = await makeUser('STUDENT', 'Cookie');
    const c = await new Client(app).init();
    const r = await c.login(u.email);
    const header = (r.headers['set-cookie'] as unknown as string[]).join(';');
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Lax/i);
    expect(JSON.stringify(r.body)).not.toMatch(/argon2|passwordHash/);
  });

  it('logout invalidates the server-side session', async () => {
    const u = await makeUser('STUDENT', 'Out');
    const c = await loggedIn(app, u.email);
    expect((await c.get('/api/v1/auth/me')).status).toBe(200);
    expect((await c.post('/api/v1/auth/logout')).status).toBe(204);
    expect((await c.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('a deactivated account loses access immediately, with its session', async () => {
    const u = await makeUser('STUDENT', 'Soon Gone');
    const c = await loggedIn(app, u.email);
    await prisma.user.update({ where: { id: u.id }, data: { isActive: false } });
    expect((await c.get('/api/v1/auth/me')).status).toBe(401);
  });
});

describe('CSRF and request hygiene', () => {
  it('rejects state-changing requests without a CSRF token', async () => {
    const u = await makeUser('STUDENT', 'Csrf');
    const c = await loggedIn(app, u.email);
    const r = await c.agent.post('/api/v1/auth/logout').send({});
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('CSRF_TOKEN_INVALID');
    expect((await c.get('/api/v1/auth/me')).status).toBe(200); // still signed in
  });

  it('rejects a wrong token and a foreign Origin', async () => {
    const u = await makeUser('STUDENT', 'Csrf2');
    const c = await loggedIn(app, u.email);
    expect((await c.agent.post('/api/v1/auth/logout').set('X-CSRF-Token', 'nope').send({})).status).toBe(403);
    const r = await c.agent.post('/api/v1/auth/logout').set('X-CSRF-Token', c.csrf).set('Origin', 'https://evil.example').send({});
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('CSRF_ORIGIN');
  });

  it('requires authentication for protected routes', async () => {
    for (const path of ['/api/v1/courses', '/api/v1/sessions', '/api/v1/admin/users']) {
      const r = await request(app).get(path);
      expect(r.status).toBe(401);
      expect(r.body.error).toMatchObject({ code: 'UNAUTHENTICATED' });
      expect(r.body.error.requestId).toBeTruthy();
    }
  });

  it('sends restrictive security headers and no stack traces', async () => {
    const r = await request(app).get('/api/v1/nope');
    expect(r.headers['content-security-policy']).toContain("default-src 'none'");
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toMatch(/at .*\.ts|node_modules/);
  });

  it('rejects oversized and malformed JSON bodies', async () => {
    const c = await new Client(app).init();
    const big = await c.post('/api/v1/auth/login', { email: 'a@t.test', password: 'x'.repeat(80_000) });
    expect(big.status).toBe(413);
    const bad = await c.agent.post('/api/v1/auth/login').set('X-CSRF-Token', c.csrf).set('Content-Type', 'application/json').send('{"email":');
    expect(bad.status).toBe(400);
  });
});

describe('password reset', () => {
  it('gives an identical response for existing and unknown emails', async () => {
    const u = await makeUser('STUDENT', 'Forgetful');
    const c = await new Client(app).init();
    const a = await c.post('/api/v1/auth/forgot-password', { email: u.email });
    const b = await c.post('/api/v1/auth/forgot-password', { email: 'ghost@t.test' });
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    expect(a.body).toEqual(b.body);
  });

  it('issues a single-use, hashed, expiring token that revokes sessions', async () => {
    const u = await makeUser('STUDENT', 'Reset Me');
    const session = await loggedIn(app, u.email);
    devOutbox.length = 0;
    const c = await new Client(app).init();
    await c.post('/api/v1/auth/forgot-password', { email: u.email });
    const token = /token=([\w-]+)/.exec(devOutbox.at(-1)!.text)![1]!;
    const stored = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId: u.id } });
    expect(stored.tokenHash).toBe(sha256Hex(token));
    expect(stored.tokenHash).not.toContain(token);

    const newPw = 'Brand-New-Passw0rd!';
    expect((await c.post('/api/v1/auth/reset-password', { token, newPassword: newPw })).status).toBe(200);
    expect((await c.post('/api/v1/auth/reset-password', { token, newPassword: 'Another-Passw0rd!!' })).status).toBe(400); // single use
    expect((await session.get('/api/v1/auth/me')).status).toBe(401); // old sessions revoked
    expect((await (await new Client(app).init()).login(u.email, PW)).status).toBe(401);
    expect((await (await new Client(app).init()).login(u.email, newPw)).status).toBe(200);
  });

  it('rejects expired and made-up tokens', async () => {
    const u = await makeUser('STUDENT', 'Late');
    const c = await new Client(app).init();
    await prisma.passwordResetToken.create({ data: { userId: u.id, tokenHash: sha256Hex('expired-token-value-0123456789'), expiresAt: new Date(Date.now() - 1000) } });
    expect((await c.post('/api/v1/auth/reset-password', { token: 'expired-token-value-0123456789', newPassword: 'Brand-New-Passw0rd!' })).status).toBe(400);
    expect((await c.post('/api/v1/auth/reset-password', { token: 'made-up-token-that-does-not-exist', newPassword: 'Brand-New-Passw0rd!' })).status).toBe(400);
  });
});

describe('rate limiting', () => {
  it('throttles repeated login attempts for the same account', async () => {
    const limited = createApp({ limits: { auth: 3 } });
    const c = await new Client(limited).init();
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await c.login('victim@t.test', 'wrong-password-123')).status);
    expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
    expect(codes.slice(3)).toEqual([429, 429]);
  });
});
