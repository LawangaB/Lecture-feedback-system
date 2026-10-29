import { expect, test } from '@playwright/test';
import { ACCOUNTS, arrangeLiveSession, signIn } from './support';

test.describe('mobile layout (Pixel 7)', () => {
  test('login and student dashboard do not scroll sideways', async ({ page }) => {
    await page.goto('/login');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await signIn(page, ACCOUNTS.student(1));
    await expect(page.getByRole('button', { name: 'Join lecture' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test('navigation drawer opens and closes, and the waiting state is shown', async ({ page, request }) => {
    const live = await arrangeLiveSession(request, [ACCOUNTS.student(1)]);
    await signIn(page, ACCOUNTS.student(1));
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await page.getByRole('button', { name: 'Close navigation' }).click();
    await page.goto(`/sessions/${live.sessionId}`);
    await expect(page.getByText('Waiting for the next poll')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open navigation' })).toBeVisible();
  });
});
