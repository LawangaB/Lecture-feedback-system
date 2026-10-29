import { expect, test } from '@playwright/test';
import { ACCOUNTS, signIn } from './support';

test.describe('administrator', () => {
  test('creates an account, finds it, deactivates it, and sees the audit trail', async ({ page }) => {
    const email = `e2e.${Date.now()}@lectures.test`;
    await signIn(page, ACCOUNTS.admin);
    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'Create account' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Full name').fill('E2E Lecturer');
    await dialog.getByLabel('Email').fill(email);
    await dialog.getByLabel('Temporary password').fill('Temporary-Passw0rd!');
    await dialog.getByRole('button', { name: 'Create account' }).click();

    await page.getByLabel('Search').fill(email);
    const row = page.getByRole('row', { name: new RegExp(email) });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: /Deactivate/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
    await expect(row.getByText('Deactivated')).toBeVisible();

    await page.goto('/admin/audit');
    await expect(page.getByRole('cell', { name: 'admin.user_deactivate' }).first()).toBeVisible();
  });

  test('students and lecturers cannot open admin pages', async ({ page }) => {
    await signIn(page, ACCOUNTS.student(1));
    await page.goto('/admin/users');
    await expect(page).toHaveURL('/'); // redirected by the UI; the API independently returns 403
    expect((await page.request.get('/api/v1/admin/users')).status()).toBe(403);
  });
});
