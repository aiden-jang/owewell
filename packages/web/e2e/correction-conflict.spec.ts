import { expect, expectNoHorizontalOverflow, test, type Page } from './fixtures';
import { dinner, queuedKinds, read } from './ledger-fixtures';
import { PREVIEW_PORT } from './servers';

test.use({ baseURL: `http://localhost:${PREVIEW_PORT}` });

async function openCorrection(page: Page) {
  await page.getByText('One saved change needs attention', { exact: true }).click();
  await page.getByRole('button', { name: 'Edit saved expense', exact: true }).click();
  return page.getByRole('dialog', { name: 'Edit saved expense', exact: true });
}

const description = 'What the expense was for';
const addExpense = { name: 'Add expense', exact: true };

async function rejectOfflineExpense(page: Page, receipt = false) {
  const { path, url, personId, guestIds } = await dinner(page, ['Sam']);
  await page.goto(url);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.getByRole('button', addExpense).first().click();
  const add = page.getByRole('dialog', { name: 'Add to the tab', exact: true });
  const submit = receipt ? { name: 'Add receipt', exact: true } : addExpense;
  const amount = receipt ? 'Item 1 amount' : 'Amount';
  if (receipt) {
    await add.getByRole('button', { name: 'Itemize a receipt' }).click();
    await add.getByLabel('Item 1 name').fill('Pizza');
  }
  await add.getByLabel(description).fill('Pizza');
  await add.getByLabel(amount, { exact: true }).fill('25');
  const context = page.context();
  await context.setOffline(true);
  await add.getByRole('button', submit).click();
  await expect.poll(() => queuedKinds(page)).toEqual([receipt ? 'itemized' : 'expense']);
  expect((await page.request.delete(`${path}/members/${guestIds[0]}`)).ok()).toBe(true);
  await context.setOffline(false);
  await expect(page.getByText('One saved change needs attention', { exact: true })).toBeVisible();
  await page.reload();
  return { path, url, personId, amount, submit, editor: await openCorrection(page) };
}

test('a correction already sent to the ledger does not become a conflict after reload', async ({ page }) => {
  const { path, editor, amount, submit } = await rejectOfflineExpense(page);
  await editor.getByLabel(description).fill('Pizza and dip');
  await editor.getByLabel(amount, { exact: true }).fill('28.40');
  // Leave the real response unacknowledged in the old document. The reloaded page can replay it.
  await page.evaluate((expensePath) => {
    const send = window.fetch;
    window.fetch = async (...args) => {
      const response = await send(...args);
      if (String(args[0]) !== expensePath || args[1]?.method !== 'POST') return response;
      document.documentElement.dataset.delayedSaveStatus = String(response.status);
      return new Promise<Response>(() => {});
    };
  }, path + '/expenses');

  await editor.getByRole('button', submit).click();
  await expect(page.locator('html')).toHaveAttribute('data-delayed-save-status', '201');
  await expect(editor.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled();
  await expect.poll(() => queuedKinds(page)).toEqual(['expense']);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.reload();
  await expect.poll(() => queuedKinds(page)).toEqual([]);
  await expect(page.getByRole('button', { name: /Pizza and dip,.*See details/ })).toBeVisible();
  const { expenses } = await read(page, path + '/expenses');
  expect(expenses).toHaveLength(2);
  expect(expenses).toEqual(
    expect.arrayContaining([expect.objectContaining({ description: 'Pizza and dip', amountCents: 2840 })]),
  );
  await expect(page.getByRole('button', { name: 'Review correction draft', exact: true })).toHaveCount(0);
});

test('a rejected correction returns its fields to the editor draft', async ({ page }) => {
  const { path, editor, amount, submit } = await rejectOfflineExpense(page, true);
  await page.evaluate((expensePath) => {
    const send = window.fetch;
    window.fetch = (input, init) => {
      if (String(input) !== expensePath || init?.method !== 'POST') return send(input, init);
      const receipt = JSON.parse(String(init.body));
      receipt.items[0].participantIds.push(crypto.randomUUID());
      return send(input, { ...init, body: JSON.stringify(receipt) });
    };
  }, path + '/expenses/itemized');
  await editor.getByLabel(description).fill('Pizza with extra toppings');
  await editor.getByLabel(amount, { exact: true }).fill('28.40');
  await editor.getByLabel('Tax', { exact: true }).fill('2.50');
  await editor.getByRole('button', submit).click();
  await expect(editor.getByRole('alert')).toHaveText('Everyone on an item must be a group member.');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.reload();
  const restored = await openCorrection(page);
  await expect(restored.getByLabel(description)).toHaveValue('Pizza with extra toppings');
  await expect(restored.getByLabel(amount, { exact: true })).toHaveValue('28.40');
  await expect(restored.getByLabel('Tax', { exact: true })).toHaveValue('2.50');
  await restored.getByRole('button', submit).click();
  await expect(restored).toHaveCount(0);
  const { expenses } = await read(page, path + '/expenses');
  expect(expenses).toHaveLength(2);
  expect(expenses).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ description: 'Pizza with extra toppings', amountCents: 3090 }),
    ]),
  );
});

for (const connection of ['online', 'offline'] as const) {
  test(`the second tab keeps its draft after a correction conflict ${connection}`, async ({
    page,
    context,
  }, info) => {
    const offline = connection === 'offline';
    const { path, url, personId, amount, submit, editor: first } = await rejectOfflineExpense(page, offline);
    const other = await context.newPage();
    const firstDescription = 'Pizza and dip';
    const secondDescription = 'Pizza and salad for everyone in the neighborhood';
    await other.emulateMedia({ colorScheme: offline ? 'dark' : 'light', reducedMotion: 'reduce' });
    await other.setViewportSize({ width: offline ? 320 : 1440, height: 844 });
    await other.goto(url);
    const second = await openCorrection(other);
    await first.getByLabel(description).fill(firstDescription);
    await first.getByLabel(amount, { exact: true }).fill('28.40');
    await second.getByLabel(description).fill(secondDescription);
    await second.getByLabel(amount, { exact: true }).fill('9876.54');
    if (offline) await second.getByLabel('Tax', { exact: true }).fill('2.50');

    if (offline) {
      // Both tabs enter save while the original rejected write is still present.
      const lock = `owewell:sync:${personId}`;
      await page.evaluate(
        (lockName) =>
          new Promise<void>((held) => {
            void navigator.locks.request(
              lockName,
              () =>
                new Promise<void>((release) => {
                  window.addEventListener('release-correction-test-lock', () => release(), { once: true });
                  held();
                }),
            );
          }),
        lock,
      );
      await context.setOffline(true);
      const saving = { name: 'Saving…', exact: true };
      await first.getByRole('button', submit).click();
      await expect(first.getByRole('button', saving)).toBeDisabled();
      await second.getByRole('button', submit).click();
      await expect(second.getByRole('button', saving)).toBeDisabled();
      await page.evaluate(() => window.dispatchEvent(new Event('release-correction-test-lock')));
    } else {
      await second.getByLabel(description).focus();
      await first.getByRole('button', submit).click();
    }
    await expect(first).toHaveCount(0);
    await expect(second.getByRole('alert')).toContainText('Correction conflict.');
    await expect(second.getByLabel(description)).toHaveValue(secondDescription);
    if (!offline) await expect(second.getByLabel(description)).toBeFocused();
    await expect(second.getByLabel(amount, { exact: true })).toHaveValue('9876.54');
    await expect(second.getByRole('button', submit)).toHaveCount(0);
    await expect(other.getByText('Saved the corrected expense.', { exact: true })).toHaveCount(0);
    await expectNoHorizontalOverflow(other);
    await other.screenshot({ path: info.outputPath('correction-conflict.png'), animations: 'disabled' });
    if (offline) {
      await expect.poll(() => queuedKinds(other)).toEqual(['itemized']);
      expect((await read(page, path + '/expenses')).expenses).toHaveLength(1);
    }

    await other.reload({ waitUntil: 'domcontentloaded' });
    if (offline) {
      await expect(other.getByRole('heading', { name: 'Couldn’t check your sign-in.' })).toBeVisible();
      await context.setOffline(false);
      await other.getByRole('button', { name: 'Try again', exact: true }).click();
    }
    await expect.poll(() => queuedKinds(other)).toEqual([]);
    const { expenses } = await read(other, path + '/expenses');
    expect(expenses).toHaveLength(2);
    expect(expenses).toEqual(
      expect.arrayContaining([expect.objectContaining({ description: firstDescription, amountCents: 2840 })]),
    );

    const review = other.getByRole('button', { name: 'Review correction draft', exact: true });
    await expect(review).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review correction draft' })).toHaveCount(0);
    await review.focus();
    await expect(review).toBeFocused();
    await other.screenshot({ path: info.outputPath('correction-recovery.png'), animations: 'disabled' });
    await review.press('Enter');
    const draft = other.getByRole('dialog', { name: 'Review correction draft', exact: true });
    await expect(draft.getByRole('alert')).toContainText('Correction conflict.');
    await expect(draft.getByLabel(description)).toHaveValue(secondDescription);
    await expect(draft.getByLabel(amount, { exact: true })).toHaveValue('9876.54');
    if (offline) await expect(draft.getByLabel('Tax', { exact: true })).toHaveValue('2.50');
    await draft.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(review).toBeVisible();
    await expect(review).toBeFocused();

    await other.getByRole('button', { name: 'Discard draft…', exact: true }).click();
    await other.getByRole('button', { name: 'Discard draft', exact: true }).click();
    await other.reload();
    await expect(other.getByRole('heading', { name: 'Dinner group', exact: true })).toBeVisible();
    await expect(review).toHaveCount(0);
  });
}
