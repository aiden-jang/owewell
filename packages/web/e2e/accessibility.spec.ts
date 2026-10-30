import { expectNoHorizontalOverflow, expect, signIn, test, type Locator, type Page } from './fixtures';

async function tabTo(page: Page, target: Locator): Promise<void> {
  await expect(target).toBeVisible();
  // macOS WebKit uses Option-Tab to include clickable controls in keyboard navigation.
  const tab =
    process.platform === 'darwin' && page.context().browser()?.browserType().name() === 'webkit'
      ? 'Alt+Tab'
      : 'Tab';
  for (let step = 0; step < 150; step++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press(tab);
  }
  throw new Error('The target could not be reached with Tab.');
}
async function activate(page: Page, target: Locator): Promise<void> {
  await tabTo(page, target);
  await page.keyboard.press('Enter');
}

test('a complete group task works with keyboard controls and enlarged text', async ({ page }) => {
  await signIn(page);
  // Keep the switcher in this layout even when the scenario runs on a fresh database.
  const earlierGroup = await page.request.post('/api/groups', {
    data: { name: `Earlier keyboard group ${Date.now()}` },
  });
  expect(earlierGroup.ok()).toBe(true);
  await page.goto('/');
  await activate(page, page.getByRole('button', { name: 'New', exact: true }));
  await expect(page.getByRole('textbox', { name: 'Group name' })).toBeFocused();
  const name = `Keyboard check ${Date.now()}`;
  await page.keyboard.type(name);
  await activate(page, page.getByRole('button', { name: 'Create', exact: true }));
  await activate(page, page.getByRole('link').filter({ hasText: name }));
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Switch group', exact: true })).toBeVisible();
  const options = page.getByRole('button', { name: 'Group options', exact: true });
  await activate(page, options);
  await expect(page.getByRole('menuitem', { name: 'Members', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByRole('textbox', { name: 'Member name to add' }));
  await page.keyboard.type('Sam');
  await activate(page, page.getByRole('button', { name: 'Add', exact: true }));
  await expect(page.getByRole('textbox', { name: 'Member name to add' })).toHaveValue('');
  await activate(page, page.getByRole('button', { name: 'Close', exact: true }));
  await expect(options).toBeFocused();
  const add = page.getByRole('button', { name: 'Add expense', exact: true }).first();
  await activate(page, add);
  await expect(page.getByLabel('Amount', { exact: true })).toBeFocused();
  await page.keyboard.type('40');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('What the expense was for')).toBeFocused();
  await page.keyboard.type('Keyboard dinner');
  // Choose the payer explicitly; roster order can vary when join timestamps match.
  const payer = page.getByRole('combobox', { name: 'Paid by', exact: true });
  await tabTo(page, payer);
  await page.keyboard.press('r');
  await expect(payer).toHaveValue(
    (await payer.getByRole('option', { name: 'Robin paid', exact: true }).getAttribute('value')) ?? '',
  );
  await activate(page, page.getByRole('dialog').getByRole('button', { name: 'Add expense', exact: true }));
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(add).toBeFocused();
  await expect(page.getByText('1 transfer left')).toBeVisible();

  const log = page.getByRole('button', { name: 'Log a payment', exact: true });
  await activate(page, log);
  await tabTo(page, page.getByLabel('Who paid', { exact: true }));
  await page.keyboard.press('s');
  await expect(page.getByLabel('Who paid', { exact: true })).toHaveValue(
    (await page
      .getByLabel('Who paid', { exact: true })
      .getByRole('option', { name: 'Sam', exact: true })
      .getAttribute('value')) ?? '',
  );
  await tabTo(page, page.getByLabel('Paid to', { exact: true }));
  await page.keyboard.press('r');
  await expect(page.getByLabel('Paid to', { exact: true })).toHaveValue(
    (await page
      .getByLabel('Paid to', { exact: true })
      .getByRole('option', { name: 'Robin', exact: true })
      .getAttribute('value')) ?? '',
  );
  await tabTo(page, page.getByLabel('Amount', { exact: true }));
  await page.keyboard.type('20');
  await expect(page.getByText('Sam paid Robin', { exact: false })).toBeVisible();
  await activate(page, page.getByRole('dialog').getByRole('button', { name: 'Record payment', exact: true }));
  await expect(page.getByRole('dialog', { name: 'Log a payment' })).toBeHidden();
  await expect(page.getByRole('status').filter({ hasText: 'Payment recorded' })).toBeVisible();
  await expect(page.getByText('All settled', { exact: true })).toBeVisible();
  await expect(page.locator('.toast')).toHaveCount(0);

  // Doubling the base type size also exercises rem-based spacing and modal reflow.
  await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  for (const width of [1280, 640]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    if (process.env.UI_A11Y_CAPTURE)
      await page.screenshot({
        path: `../../test-results/visual-review/accessibility-text-200-${width}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    const entry = page.getByRole('button', { name: 'Add expense', exact: true });
    await activate(page, entry);
    await tabTo(page, page.getByLabel('Amount', { exact: true }));
    expect(
      await page.getByRole('dialog').evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth),
    ).toBe(true);
    if (process.env.UI_A11Y_CAPTURE)
      await page.screenshot({
        path: `../../test-results/visual-review/accessibility-entry-200-${width}.png`,
        animations: 'disabled',
      });
    await page.keyboard.press('Escape');
    await expect(entry).toBeFocused();
  }
});
