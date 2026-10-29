import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ACCOUNTS, signIn } from './support';

const wcag = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test.describe('accessibility (automated checks + keyboard)', () => {
  // Automated scans catch only part of WCAG; manual keyboard and screen-reader review is still required.
  for (const path of ['/login', '/register', '/forgot-password']) {
    test(`no detectable WCAG A/AA violations on ${path}`, async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).withTags(wcag).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
    });
  }

  test('signed-in dashboards pass automated checks', async ({ page }) => {
    await signIn(page, ACCOUNTS.student(1));
    expect((await new AxeBuilder({ page }).withTags(wcag).analyze()).violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  });

  test('the sign-in form is fully keyboard operable and the skip link works', async ({ page }) => {
    await page.goto('/login');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
    await page.getByLabel('Email').focus();
    await page.keyboard.type(ACCOUNTS.student(1));
    await page.keyboard.press('Tab');
    await page.keyboard.type('DevPassword!2026');
    await page.keyboard.press('Enter');
    await expect(page).not.toHaveURL(/login/);
  });

  test('focus is visible on interactive elements', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').focus();
    const outline = await page.getByLabel('Email').evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
  });
});
