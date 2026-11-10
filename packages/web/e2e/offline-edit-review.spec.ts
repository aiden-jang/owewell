import { expect, expectNoHorizontalOverflow, test, type Page } from './fixtures';
import { dinner, queuedKinds, read } from './ledger-fixtures';
import { PREVIEW_PORT } from './servers';

test.use({ baseURL: `http://localhost:${PREVIEW_PORT}` });

async function editDinner(page: Page, url: string, itemized = false) {
  await page.goto(url);
  await page.getByRole('button', { name: /^Dinner, .*See details/ }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  return page.getByRole('dialog', { name: itemized ? 'Edit receipt' : 'Edit expense', exact: true });
}

const getConflict = (page: Page) => page.getByRole('dialog', { name: /changed while you were offline/ });

for (const format of ['expense', 'receipt'] as const) {
  test(`a lost ${format} edit response clears on reload without reapplying the saved edit`, async ({
    page,
    context,
  }) => {
    const { path, url, expense, personId, guestIds } = await dinner(page, ['Sam']);
    const itemized = format === 'receipt';
    const endpoint = `${path}/expenses/${expense.id}${itemized ? '/itemized' : ''}`;
    if (itemized) {
      const response = await page.request.put(endpoint, {
        data: {
          description: 'Dinner',
          payerId: personId,
          taxCents: 250,
          tipCents: 100,
          items: [{ name: 'Pizza', amountCents: 3650, participantIds: [personId, ...guestIds] }],
          expectedVersion: expense.version,
        },
      });
      expect(response.ok()).toBe(true);
    }
    const form = await editDinner(page, url, itemized);
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await form.getByLabel('What the expense was for').fill('Dinner and drinks');
    await form.getByLabel(itemized ? 'Item 1 amount' : 'Amount', { exact: true }).fill('52.50');
    await page.evaluate((target) => {
      const send = window.fetch;
      window.fetch = async (...args) => {
        const response = await send(...args);
        if (String(args[0]) === target && args[1]?.method === 'PUT' && response.ok) {
          document.documentElement.dataset.firstEditSaved = String(response.status);
          throw new TypeError('The connection closed before the response was delivered.');
        }
        return response;
      };
    }, endpoint);
    await form.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-first-edit-saved', '200');
    await expect(form).toHaveCount(0);
    const kind = itemized ? 'edit-itemized' : 'edit';
    await expect.poll(() => queuedKinds(page)).toEqual([kind]);
    const ledger = async () => (await read(page, path + '/expenses')).expenses[0];
    const saved = await ledger();
    expect(saved).toMatchObject({
      description: 'Dinner and drinks',
      amountCents: itemized ? 5600 : 5250,
      version: expense.version + (itemized ? 2 : 1),
    });

    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Couldn’t check your sign-in.' })).toBeVisible();
    await expect.poll(() => queuedKinds(page)).toEqual([kind]);
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect.poll(() => queuedKinds(page)).toEqual([]);
    await expect(getConflict(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Dinner and drinks,.*See details/ })).toBeVisible();
    expect(await ledger()).toEqual(saved);
  });
}

test('a split-only conflict shows shares and closes when another tab decides', async ({
  page,
  context,
}, info) => {
  const guest = 'SamAlexandriaMontgomeryWithAnUnbrokenName';
  const { path, url, expense, personId, guestIds } = await dinner(page, [guest]);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  const form = await editDinner(page, url);
  await form.getByRole('checkbox', { name: guest, exact: true }).uncheck();
  await context.setOffline(true);
  await form.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(form).toHaveCount(0);
  await expect.poll(() => queuedKinds(page)).toEqual(['edit']);
  const update = await page.request.put(`${path}/expenses/${expense.id}`, {
    data: {
      description: 'Dinner',
      amountCents: 4000,
      payerId: personId,
      splitMethod: 'EXACT',
      participants: [
        { userId: personId, value: 3000 },
        { userId: guestIds[0], value: 1000 },
      ],
      expectedVersion: expense.version,
    },
  });
  expect(update.ok()).toBe(true);
  await context.setOffline(false);
  const conflict = getConflict(page);
  await expect(conflict).toBeVisible();
  const table = conflict.getByRole('table', { name: 'What changed' });
  await expect(table.getByRole('columnheader', { name: 'In the ledger' })).toBeVisible();
  await expect(table.getByRole('columnheader', { name: 'Your edit' })).toBeVisible();
  const sam = table.getByRole('row', { name: /Sam/ });
  await expect(sam.getByRole('cell')).toHaveText(['$10.00', 'Not included']);
  await expectNoHorizontalOverflow(page);
  const latest = (await read(page, path + '/expenses')).expenses[0];
  expect(latest).toMatchObject({
    version: expense.version + 1,
    splits: expect.arrayContaining([expect.objectContaining({ userId: guestIds[0], owedCents: 1000 })]),
  });
  await page.screenshot({ path: info.outputPath('split-only-conflict.png'), animations: 'disabled' });
  const second = await context.newPage();
  await second.setViewportSize({ width: 1440, height: 900 });
  await second.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await second.goto(url);
  const secondReview = getConflict(second);
  const keep = secondReview.getByRole('button', { name: 'Keep theirs' });
  await expect(keep).toBeVisible();
  await keep.focus();
  await expect(keep).toBeFocused();
  await second.screenshot({
    path: info.outputPath('split-only-conflict-desktop.png'),
    animations: 'disabled',
  });
  await keep.press('Enter');
  await expect.poll(() => queuedKinds(second)).toEqual([]);
  await expect(conflict).toHaveCount(0);
  await expect(
    page.getByText('This saved change was handled in another tab.', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: /^Dinner, .*See details/ })).toBeVisible();
  await expect(getConflict(page)).toHaveCount(0);
  const after = (await read(page, path + '/expenses')).expenses[0];
  expect(after).toEqual(latest);
});
