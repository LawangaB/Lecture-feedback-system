import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';

export const PASSWORD = 'DevPassword!2026'; // seeded development accounts only (backend/prisma/seed.ts)
export const ACCOUNTS = { admin: 'admin@lectures.test', lecturer: 'lecturer@lectures.test', student: (n: number) => `student${n}@lectures.test` };

/** Sign in through the real login form. */
export async function signIn(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

export async function newSignedInPage(browser: Browser, email: string, options: Parameters<Browser['newContext']>[0] = {}): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await signIn(page, email);
  return { context, page };
}

/** API helper (same cookie + CSRF rules as the browser) to arrange a live session quickly. */
export async function arrangeLiveSession(request: APIRequestContext, studentEmails: string[]) {
  const csrf = (await (await request.get('/api/v1/auth/csrf')).json()).csrfToken as string;
  const login = await request.post('/api/v1/auth/login', { data: { email: ACCOUNTS.lecturer, password: PASSWORD }, headers: { 'X-CSRF-Token': csrf } });
  expect(login.ok()).toBeTruthy();
  const token = (await login.json()).csrfToken as string;
  const post = async (url: string, data: object = {}) => { const r = await request.post(url, { data, headers: { 'X-CSRF-Token': token } }); expect(r.ok(), `${url} → ${r.status()}`).toBeTruthy(); return r.json(); };
  const code = `E2E${Date.now().toString(36).toUpperCase().slice(-6)}`;
  const { course } = await post('/api/v1/courses', { code, title: `E2E course ${code}` });
  await post(`/api/v1/courses/${course.id}/enrolments`, { emails: studentEmails });
  const { session } = await post(`/api/v1/courses/${course.id}/sessions`, { title: `E2E lecture ${code}` });
  const started = await post(`/api/v1/sessions/${session.id}/start`);
  return { courseId: course.id as string, sessionId: session.id as string, joinCode: started.session.joinCode as string, title: `E2E lecture ${code}` };
}
