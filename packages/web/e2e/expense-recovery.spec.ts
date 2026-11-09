import { expect, expectNoHorizontalOverflow, signIn, test } from './fixtures';
import { dinner, read } from './ledger-fixtures';

for (const mode of ['total', 'receipt'] as const) {
  test(`an unfinished ${mode} survives switching accounts and reloading the tab`, async ({
    page,
    context,
  }, info) => {
    const { path, url, personId } = await dinner(page, [], 'Account switch dinner');
    const session = (await context.cookies()).find((cookie) => cookie.name === 'platform_session')!;
    const other = await context.newPage();
    await other.goto('/split');
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: mode === 'receipt' ? 'dark' : 'light' });
    await page.goto(url);
    const add = page.getByRole('button', { name: 'Add expense', exact: true }).first();
    const sheet = page.getByRole('dialog', { name: 'Add to the tab', exact: true });
    await add.click();
    const description = 'Dinner for friends from the whole neighborhood';
    if (mode === 'receipt') {
      await sheet.getByRole('button', { name: 'Itemize a receipt' }).click();
      await sheet.getByLabel('Item 1 name', { exact: true }).fill('Pizza');
      await sheet.getByLabel('Item 1 amount', { exact: true }).fill('4719.19');
      await sheet.getByLabel('Tax', { exact: true }).fill('6.81');
    } else {
      await sheet.getByLabel('Amount', { exact: true }).fill('4719.19');
    }
    await sheet.getByLabel('What the expense was for').fill(description);

    await signIn(other);
    const check = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/me');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    expect((await (await check).json()).personId).not.toBe(personId);
    await expect(sheet).toHaveCount(0);
    await page.reload();
    await expect(sheet).toHaveCount(0);
    await context.addCookies([session]);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Account switch dinner', exact: true })).toBeVisible();
    await add.click();
    await expect(sheet.getByText('Your unfinished expense is back.', { exact: true })).toBeVisible();
    await expect(sheet.getByLabel('What the expense was for')).toHaveValue(description);
    if (mode === 'receipt') {
      await expect(sheet.getByLabel('Item 1 name', { exact: true })).toHaveValue('Pizza');
      await expect(sheet.getByLabel('Item 1 amount', { exact: true })).toHaveValue('4719.19');
      await expect(sheet.getByLabel('Tax', { exact: true })).toHaveValue('6.81');
    } else {
      await expect(sheet.getByLabel('Amount', { exact: true })).toHaveValue('4719.19');
    }

    await page.setViewportSize({ width: mode === 'receipt' ? 320 : 1440, height: 900 });
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: info.outputPath('restored-expense.png'), animations: 'disabled' });
    if (mode === 'receipt') {
      await sheet.getByRole('button', { name: 'Add receipt', exact: true }).click();
      await expect(sheet).toHaveCount(0);
      expect((await read(page, path + '/expenses')).expenses).toEqual(
        expect.arrayContaining([expect.objectContaining({ description, amountCents: 472600 })]),
      );
    } else {
      await sheet.getByRole('button', { name: 'Close', exact: true }).click();
      await sheet.getByRole('button', { name: 'Discard changes', exact: true }).click();
      expect((await read(page, path + '/expenses')).expenses).toHaveLength(1);
    }
    await expect(sheet).toHaveCount(0);
    await page.reload();
    await add.click();
    await expect(sheet.getByLabel('What the expense was for')).toHaveValue('');
  });
}

test('a restored expense edit cannot overwrite a newer ledger version', async ({ page, context }) => {
  const { path, url, personId, expense } = await dinner(page, []);
  await page.goto(url);
  const openEditor = async (description: string) => {
    await page.getByRole('button', { name: new RegExp(`^${description}, .*See details`) }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    return page.getByRole('dialog', { name: 'Edit expense', exact: true });
  };
  const original = await openEditor('Dinner');
  await original.getByLabel('What the expense was for').fill('My unfinished edit');
  await original.getByLabel('Amount', { exact: true }).fill('26.50');

  const second = await context.newPage();
  const endpoint = `${path}/expenses/${expense.id}`;
  const change = await second.request.put(endpoint, {
    data: {
      description: 'Newer dinner',
      amountCents: 3000,
      payerId: personId,
      splitMethod: 'EQUAL',
      participants: [{ userId: personId }],
      expectedVersion: expense.version,
    },
  });
  expect(change.ok()).toBe(true);
  page.once('dialog', (dialog) => void dialog.accept());
  await page.reload();

  const restored = await openEditor('Newer dinner');
  await expect(restored.getByLabel('What the expense was for')).toHaveValue('My unfinished edit');
  await expect(restored.getByLabel('Amount', { exact: true })).toHaveValue('26.50');
  await restored.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(restored.getByRole('alert')).toContainText(/changed/i);
  expect((await read(page, path + '/expenses')).expenses).toMatchObject([
    { id: expense.id, description: 'Newer dinner', amountCents: 3000, version: expense.version + 1 },
  ]);
});
