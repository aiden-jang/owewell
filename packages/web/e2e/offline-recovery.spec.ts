import { expect, expectNoHorizontalOverflow, test } from './fixtures';
import { dinner, queuedKinds, read } from './ledger-fixtures';
import { PREVIEW_PORT } from './servers';

test.use({ baseURL: `http://localhost:${PREVIEW_PORT}` });

test('Quick Split opens offline after one visit and keeps its draft through reconnect', async ({
  page,
  context,
}) => {
  await page.goto('/split');
  await page.getByLabel('Person 2 name').fill('Sam');
  const amount = page.getByLabel('Item 1 amount');
  await amount.fill('62.50');
  await amount.blur();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  expect(
    await page.evaluate(async () => {
      const assets = [
        ...document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>(
          'script[type=module][src], link[rel=stylesheet]',
        ),
      ];
      return (
        await Promise.all(assets.map((asset) => caches.match('src' in asset ? asset.src : asset.href)))
      ).every(Boolean);
    }),
  ).toBe(true);

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(amount).toHaveValue('62.50');
  await expect(page.getByLabel('Person 2 name')).toHaveValue('Sam');
  await amount.fill('80');
  await amount.blur();
  await context.setOffline(false);
  await page.reload();
  await expect(amount).toHaveValue('80.00');
});

test('Undo survives another tab syncing the deletion before sign-in recovers', async ({
  page,
  context,
}, info) => {
  const { path, url, expense } = await dinner(page, [], 'Cross-tab dinner');
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.goto(url);
  await expect(page.getByRole('button', { name: /Dinner, .*See details/ })).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const second = await context.newPage();
  await second.goto(url);
  await expect(second.getByRole('button', { name: /Dinner, .*See details/ })).toBeVisible();
  await page.getByRole('button', { name: /Dinner, .*See details/ }).click();
  await context.setOffline(true);
  await page
    .getByRole('dialog', { name: 'Dinner', exact: true })
    .getByRole('button', { name: 'Delete', exact: true })
    .click();
  await expect.poll(() => queuedKinds(page)).toEqual(['delete']);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Couldn’t check your sign-in.' })).toBeVisible();
  const undo = page.getByRole('button', { name: /Undo deletion of Dinner in Cross-tab dinner/ });
  await expect(undo).toBeVisible();
  await context.setOffline(false);
  await expect.poll(() => queuedKinds(page)).toEqual([]);
  expect((await read(second, path + '/expenses')).expenses).toHaveLength(0);
  await expect(undo).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Dinner was deleted.' })).toBeVisible();

  await page.setViewportSize({ width: 320, height: 844 });
  await expectNoHorizontalOverflow(page);
  await undo.focus();
  await expect(undo).toBeFocused();
  await page.screenshot({ path: info.outputPath('recent-deletion.png'), animations: 'disabled' });
  await undo.press('Enter');
  await expect(undo).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('button', { name: /Dinner, .*See details/ })).toBeVisible();
  await expect.poll(() => queuedKinds(page)).toEqual([]);
  expect((await read(second, path + '/expenses')).expenses).toMatchObject([
    { id: expense.id, version: expense.version + 2, splits: expect.arrayContaining(expense.splits) },
  ]);
  await page.reload();
  await expect(undo).toHaveCount(0);
});
