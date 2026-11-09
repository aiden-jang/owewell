import { expect, expectNoHorizontalOverflow, signIn, test, type Page } from './fixtures';
import { dinner, queuedKinds, read } from './ledger-fixtures';

async function openCorrection(page: Page) {
  const action = page.getByRole('button', { name: 'Edit saved expense', exact: true });
  if (!(await action.isVisible()))
    await page.getByText('One saved change needs attention', { exact: true }).click();
  await action.click();
  return page.getByRole('dialog', { name: 'Edit saved expense', exact: true });
}

for (const format of ['total', 'receipt'] as const) {
  test(`corrections to a rejected offline ${format} survive an account switch and reconnect`, async ({
    page,
    context,
  }, info) => {
    const { path, url, personId, guestIds } = await dinner(page, ['Sam'], 'Weekend dinner');
    const session = (await context.cookies()).find((cookie) => cookie.name === 'platform_session')!;
    const other = await context.newPage();
    await other.goto('/split');
    await page.emulateMedia({
      reducedMotion: 'reduce',
      colorScheme: format === 'receipt' ? 'dark' : 'light',
    });
    await page.goto(url);

    const isReceipt = format === 'receipt';
    const submit = isReceipt ? 'Add receipt' : 'Add expense';
    const amountLabel = isReceipt ? 'Item 1 amount' : 'Amount';
    const descriptionLabel = 'What the expense was for';
    const original = 'Pizza for the whole neighborhood';
    const corrected = 'Pizza and dip for the whole neighborhood';
    await page.getByRole('button', { name: 'Add expense', exact: true }).first().click();
    const add = page.getByRole('dialog', { name: 'Add to the tab', exact: true });
    if (isReceipt) {
      await add.getByRole('button', { name: 'Itemize a receipt' }).click();
      await add.getByLabel('Item 1 name', { exact: true }).fill('Pizza');
    }
    await add.getByLabel(descriptionLabel).fill(original);
    await add.getByLabel(amountLabel, { exact: true }).fill('25');
    await context.setOffline(true);
    await add.getByRole('button', { name: submit, exact: true }).click();
    await expect.poll(() => queuedKinds(page)).toEqual([isReceipt ? 'itemized' : 'expense']);
    expect((await other.request.delete(`${path}/members/${guestIds[0]}`)).ok()).toBe(true);

    await context.setOffline(false);
    let editor = await openCorrection(page);
    await editor.getByLabel(descriptionLabel).fill(corrected);
    await editor.getByLabel(amountLabel, { exact: true }).fill('28.40');
    if (isReceipt) await editor.getByLabel('Tax', { exact: true }).fill('2.50');

    await signIn(other);
    const check = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/me');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    expect((await (await check).json()).personId).not.toBe(personId);
    await expect(editor).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit saved expense' })).toHaveCount(0);
    await context.addCookies([session]);
    await page.reload();

    editor = await openCorrection(page);
    await expect(editor.getByLabel(descriptionLabel)).toHaveValue(corrected);
    await expect(editor.getByLabel(amountLabel, { exact: true })).toHaveValue('28.40');
    await expect(editor.getByText('Your unfinished correction is back.', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: isReceipt ? 320 : 1440, height: 900 });
    await expectNoHorizontalOverflow(page);
    await editor.getByLabel(descriptionLabel).focus();
    await expect(editor.getByLabel(descriptionLabel)).toBeFocused();
    await page.screenshot({ path: info.outputPath('restored-correction.png'), animations: 'disabled' });

    await other.goto(url);
    const otherEditor = await openCorrection(other);
    await expect(otherEditor.getByLabel(descriptionLabel)).toHaveValue(original);
    await otherEditor.getByRole('button', { name: 'Close', exact: true }).click();
    if (isReceipt) {
      await expect(editor.getByLabel('Tax', { exact: true })).toHaveValue('2.50');
      await context.setOffline(true);
      await editor.getByRole('button', { name: submit, exact: true }).click();
      await expect(editor).toHaveCount(0);
      await context.setOffline(false);
      await expect.poll(() => queuedKinds(page)).toEqual([]);
      const { expenses } = await read(page, path + '/expenses');
      expect(expenses.filter((entry: { description: string }) => entry.description === corrected)).toEqual([
        expect.objectContaining({ amountCents: 3090 }),
      ]);
    } else {
      await editor.getByRole('button', { name: 'Close', exact: true }).click();
      await editor.getByRole('button', { name: 'Discard changes', exact: true }).click();
      const reopened = await openCorrection(page);
      await expect(reopened.getByLabel(descriptionLabel)).toHaveValue(original);
      await expect(reopened.getByLabel(amountLabel, { exact: true })).toHaveValue('25.00');
    }
  });
}
