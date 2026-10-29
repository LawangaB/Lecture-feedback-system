import { expect, test } from '@playwright/test';
import { ACCOUNTS, arrangeLiveSession, newSignedInPage } from './support';

test.describe('live lecture: lecturer and student', () => {
  test('student joins with a code, answers a poll, lecturer sees live results and closes it', async ({ browser, request }) => {
    const live = await arrangeLiveSession(request, [ACCOUNTS.student(1), ACCOUNTS.student(2)]);

    const lecturer = await newSignedInPage(browser, ACCOUNTS.lecturer);
    const student = await newSignedInPage(browser, ACCOUNTS.student(1), { viewport: { width: 390, height: 844 }, hasTouch: true });

    // Lecturer opens the control room and sees the code.
    await lecturer.page.goto(`/sessions/${live.sessionId}`);
    await expect(lecturer.page.getByRole('heading', { name: live.title })).toBeVisible();
    await expect(lecturer.page.getByLabel(/^Join code/)).toContainText(live.joinCode);
    await expect(lecturer.page.getByText('Live connection')).toBeVisible();

    // Student joins by typing the code on their dashboard.
    await student.page.goto('/join');
    await student.page.getByLabel('Session code').fill(live.joinCode.toLowerCase());
    await student.page.getByRole('button', { name: 'Join lecture' }).click();
    await expect(student.page.getByRole('heading', { name: live.title })).toBeVisible();
    await expect(student.page.getByText('Waiting for the next poll')).toBeVisible();

    // Lecturer builds and launches a poll.
    await lecturer.page.getByRole('button', { name: 'New poll' }).click();
    await lecturer.page.getByLabel('Question', { exact: true }).fill('Which isolation level prevents dirty reads?');
    await lecturer.page.getByLabel('Option 1').fill('Read uncommitted');
    await lecturer.page.getByLabel('Option 2').fill('Read committed');
    await lecturer.page.getByLabel('Who sees results?').selectOption('LIVE');
    await expect(lecturer.page.getByLabel('Student preview')).toContainText('Read committed');
    await lecturer.page.getByRole('button', { name: 'Save draft' }).click();
    await lecturer.page.getByRole('button', { name: 'Launch' }).click();

    // Student sees it appear in real time, answers, and gets server-confirmed feedback.
    await expect(student.page.getByText('Which isolation level prevents dirty reads?')).toBeVisible();
    await expect(student.page.getByRole('button', { name: 'Submit answer' })).toBeDisabled();
    await student.page.getByLabel('Read committed').check();
    await student.page.getByRole('button', { name: 'Submit answer' }).click();
    await expect(student.page.getByText('Answer received')).toBeVisible();
    await expect(student.page.getByRole('button', { name: 'Submit answer' })).toHaveCount(0);

    // Lecturer's response counter updates without a refresh.
    await expect(lecturer.page.getByText('Responses').locator('xpath=following-sibling::p')).toHaveText('1', { timeout: 5000 });

    // Closing requires confirmation; the student is told it closed.
    await lecturer.page.getByRole('button', { name: 'Close poll' }).click();
    await expect(lecturer.page.getByRole('dialog')).toContainText('Close this poll?');
    await lecturer.page.getByRole('dialog').getByRole('button', { name: 'Close poll' }).click();
    await expect(student.page.getByText('Closed polls')).toBeVisible();

    await lecturer.context.close();
    await student.context.close();
  });

  test('anonymous results stay hidden from students until the lecturer reveals them', async ({ browser, request }) => {
    const live = await arrangeLiveSession(request, [ACCOUNTS.student(3)]);
    const lecturer = await newSignedInPage(browser, ACCOUNTS.lecturer);
    const student = await newSignedInPage(browser, ACCOUNTS.student(3));
    await lecturer.page.goto(`/sessions/${live.sessionId}`);
    await student.page.goto(`/sessions/${live.sessionId}`);

    await lecturer.page.getByRole('button', { name: 'New poll' }).click();
    await lecturer.page.getByLabel('Question', { exact: true }).fill('Is normalisation always beneficial?');
    await lecturer.page.getByLabel('Option 1').fill('Yes');
    await lecturer.page.getByLabel('Option 2').fill('No');
    await lecturer.page.getByLabel('Who sees results?').selectOption('HIDDEN');
    await lecturer.page.getByRole('button', { name: 'Save draft' }).click();
    await lecturer.page.getByRole('button', { name: 'Launch' }).click();

    await student.page.getByLabel('No').check();
    await student.page.getByRole('button', { name: 'Submit answer' }).click();
    await expect(student.page.getByText(/Results will appear here when your lecturer shares them/)).toBeVisible();
    await expect(student.page.getByText('Live results')).toHaveCount(0);
    await expect(lecturer.page.getByText('Results are hidden from students')).toBeVisible();

    await lecturer.page.getByRole('button', { name: 'Show results to students' }).click();
    await lecturer.page.getByRole('dialog').getByRole('button', { name: 'Show results' }).click();
    await expect(student.page.getByText('Live results')).toBeVisible();
    await lecturer.context.close();
    await student.context.close();
  });

  test('a student outside the course cannot reach the session', async ({ browser, request }) => {
    const live = await arrangeLiveSession(request, [ACCOUNTS.student(1)]);
    const outsider = await newSignedInPage(browser, ACCOUNTS.student(6));
    await outsider.page.goto(`/sessions/${live.sessionId}`);
    await expect(outsider.page.getByText('Session not available')).toBeVisible();
    await outsider.context.close();
  });
});
