import { mkdir } from 'node:fs/promises';
import { expectNoHorizontalOverflow, expect, test, type Page } from './fixtures';

/*
 * One person's path through owewell, in a real browser against the real Worker and a real D1.
 *
 * Everything else here tests a layer: the ledger nets to zero, a component renders, a route
 * refuses a non-member. None of it knows whether somebody can start with an empty account and end
 * up looking at a correct "owes you" figure, which is the only thing the app is for.
 */

/* The Worker checks the session against the auth service, so being signed in is a cookie it will
   forward, not anything the browser does. e2e/fake-auth.mjs answers for it. */
async function signIn(page: Page): Promise<void> {
  await page
    .context()
    .addCookies([{ name: 'platform_session', value: 'e2e', domain: 'localhost', path: '/' }]);
}

async function newGroup(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await page.getByPlaceholder('Tahoe trip, apartment 4B, book club...').fill(name);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.getByText(name).first().click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

test.describe('from an empty account to a balance', () => {
  test('a group, an expense, and the recorded payment that settles it', async ({ page }) => {
    await signIn(page);
    if (process.env.UI_QA_CAPTURE) {
      await page.route('**/api/groups', (route) => route.fulfill({ json: { groups: [] } }));
      await page.goto('/');
      await expect(page.getByRole('button', { name: 'Create your first group' })).toBeVisible();
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.screenshot({
          path: `../../docs/ui-qa/dashboard-empty-${width}.png`,
          fullPage: true,
          animations: 'disabled',
        });
      }
      await page.unroute('**/api/groups');
    }
    const groupName = `Trip to Lisbon ${Date.now()}`;
    await newGroup(page, groupName);

    // --- a second person, or there is nothing to split ------------------------------------
    await page.getByRole('button', { name: /member. Open the member list/ }).click();
    await page.getByPlaceholder('Add someone by name').fill('Sam');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('button', { name: /Options for Sam/ })).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).first().click();

    // --- an expense Robin paid for both of them -------------------------------------------
    await page.getByRole('button', { name: 'Add expense' }).first().click();
    for (const [raw, formatted] of [
      ['.50', '0.50'],
      ['12.', '12.00'],
      ['$1,200.50', '1200.50'],
    ]) {
      await page.getByLabel('Amount').fill(raw!);
      await page.getByLabel('What the expense was for').focus();
      await expect(page.getByLabel('Amount')).toHaveValue(formatted!);
    }
    await page.getByLabel('Amount').fill('40.00');
    await page.getByLabel('What the expense was for').fill('Dinner');
    // The form's submit carries the same words as the button that opened it.
    await page.locator('form').getByRole('button', { name: 'Add expense' }).click();

    // --- the split it produces ------------------------------------------------------------
    // Forty dollars, paid by Robin, split two ways: Sam owes twenty and the group says so.
    await expect(page.getByText('Dinner', { exact: true }).first()).toBeVisible();
    await expect(page).toHaveTitle(`${groupName} · owewell`);
    await page.evaluate(() => {
      window.print = () => {
        document.documentElement.dataset.printRequested = 'yes';
      };
    });
    await page.getByRole('button', { name: 'Group options', exact: true }).click();
    const downloadWait = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Export activity', exact: true }).click();
    const csv = await downloadWait;
    const exportDay = await page.evaluate(() => {
      const now = new Date();
      return [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
      ].join('-');
    });
    const slug = groupName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    expect(csv.suggestedFilename()).toBe(`${slug}-activity-${exportDay}.csv`);
    await page.getByRole('button', { name: 'Group options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Print recap / Save PDF' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-print-requested', 'yes');
    await page.emulateMedia({ media: 'print' });
    const print = page.getByRole('article', { name: 'Printable group recap' });
    await expect(print).toBeVisible();
    await expect(page.locator('.app-header')).toBeHidden();
    await expect(print.getByRole('heading', { name: groupName })).toBeVisible();
    await expect(print.getByRole('row', { name: 'Sam Owes $20.00' })).toBeVisible();
    await expect(print.getByText('Dinner', { exact: false })).toBeVisible();
    await expect(print.getByText('No payments recorded.')).toBeVisible();
    if (process.env.UI_QA_CAPTURE) {
      await page.screenshot({
        path: '../../docs/ui-qa/print-recap.png',
        fullPage: true,
        animations: 'disabled',
      });
      if (test.info().project.name === 'chromium')
        await page.pdf({ path: '../../docs/ui-qa/print-recap.pdf', format: 'A4' });
    }
    await page.emulateMedia({ media: 'screen' });
    const owed = page.getByText(/You're owed/).locator('..');
    await expect(owed).toContainText('$20.00');
    await expect(page.getByText('1 transfer left')).toBeVisible();
    await page.goto('/');
    await expect(page.getByText('Owed to you', { exact: true }).first()).toBeVisible();
    if (process.env.UI_QA_CAPTURE) {
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        await page.screenshot({
          path: `../../docs/ui-qa/dashboard-balance-${width}.png`,
          fullPage: true,
          animations: 'disabled',
        });
      }
    }
    await page.getByRole('link').filter({ hasText: groupName }).click();
    await expect(page.getByText('1 transfer left')).toBeVisible();

    // Recording is a separate step from paying, with the exact record reviewed first.
    await page.getByRole('button', { name: 'Record payment', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Record this payment?' });
    await expect(confirmation).toContainText('Sam paid Robin $20.00 via Cash.');
    await confirmation.getByRole('button', { name: 'Record payment', exact: true }).click();
    const receipt = page.getByRole('region', { name: 'Payment recorded' });
    await expect(receipt).toContainText('$20.00');
    await expect(receipt).toContainText('Sam paid Robin via Cash');
    await expect(receipt).toContainText('Everyone is settled');
    await expect(page.getByText('All settled', { exact: true })).toBeVisible();
    if (process.env.CAPTURE_DETAILS) {
      const folder = new URL('../../../docs/ui-qa/refinements-oct15/', import.meta.url).pathname;
      await mkdir(folder, { recursive: true });
      for (const [name, width, height] of [
        ['desktop', 1440, 900],
        ['mobile', 390, 844],
      ] as const) {
        await page.setViewportSize({ width, height });
        await receipt.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `${folder}receipt-${name}.png`,
          fullPage: false,
          animations: 'disabled',
        });
      }
    }
    await receipt.getByRole('button', { name: 'Undo this payment', exact: true }).click();
    const undo = page.getByRole('dialog', { name: 'Undo this payment?' });
    await undo.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(receipt).toBeHidden();
    await expect(page.getByText('1 transfer left')).toBeVisible();
  });
});

test('group settings remain usable with long names and dark mode', async ({ page }) => {
  await signIn(page);
  const earlierGroup = await page.request.post('/api/groups', {
    data: { name: `Earlier settings group ${Date.now()}` },
  });
  expect(earlierGroup.ok()).toBe(true);
  const name = `A long weekend with friends, dinners and questionable plans ${Date.now()}`;
  await newGroup(page, name);
  await expect(page.getByRole('combobox', { name: 'Switch group', exact: true })).toBeVisible();
  if (process.env.UI_CONSISTENCY_CAPTURE) {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({
        path: `../../docs/ui-qa/group-title-light-${width}.png`,
        fullPage: false,
        animations: 'disabled',
      });
    }
  }
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: 'Group options', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Members', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Export activity' })).toBeFocused();
    if (process.env.UI_CONSISTENCY_CAPTURE) {
      await page.screenshot({
        path: `../../docs/ui-qa/group-options-dark-${width}.png`,
        fullPage: false,
        animations: 'disabled',
      });
    }
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Group options', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Group options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Group name', exact: true })).toHaveValue(name);
    if (process.env.UI_CONSISTENCY_CAPTURE) {
      await page.screenshot({
        path: `../../docs/ui-qa/group-rename-dark-${width}.png`,
        fullPage: false,
        animations: 'disabled',
      });
    }
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Group options', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Members', exact: true }).click();
    if (width === 1280) {
      await page
        .getByRole('textbox', { name: 'Member name to add' })
        .fill('Alexandria With A Rather Long Name');
      await page.getByRole('button', { name: 'Add', exact: true }).click();
    }
    await expect(
      page.getByRole('button', { name: 'Options for Alexandria With A Rather Long Name' }),
    ).toBeVisible();
    if (process.env.UI_CONSISTENCY_CAPTURE) {
      await expect(page.getByRole('textbox', { name: 'Member name to add' })).toHaveValue('');
      await expect(page.locator('.toast')).toHaveCount(0);
      await page.screenshot({
        path: `../../docs/ui-qa/group-members-dark-${width}.png`,
        fullPage: false,
        animations: 'disabled',
      });
    }
    await expectNoHorizontalOverflow(page);
    await page.getByRole('button', { name: 'Close', exact: true }).first().click();
  }
  await page.getByRole('button', { name: 'Add expense', exact: true }).first().click();
  await page.getByLabel('Amount', { exact: true }).fill('123456.78');
  const description = 'A rather large shared booking with a long description';
  const note = 'ReceiptReference' + 'x'.repeat(180);
  await page.getByLabel('What the expense was for').fill(description);
  await page.getByText('Date, category & note', { exact: true }).click();
  await page.getByLabel('Note', { exact: true }).fill(note);
  await page.locator('form').getByRole('button', { name: 'Add expense', exact: true }).click();
  await expect(page.getByLabel('Amount', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: `${description}, $123,456.78. See details.`, exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(note);
  await expect(page.locator('.toast')).toHaveCount(0);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page);
    if (process.env.UI_CONSISTENCY_CAPTURE) {
      await page.screenshot({
        path: `../../docs/ui-qa/expense-long-dark-${width}.png`,
        fullPage: false,
        animations: 'disabled',
      });
    }
  }
});

test('the signed-out calculator keeps both palettes usable', async ({ page }) => {
  await page.goto('/split');
  await expect(page.getByRole('heading', { name: 'Split the bill. Keep the peace.' })).toBeVisible();
  for (const theme of ['Light', 'Dark']) {
    await page.getByRole('button', { name: theme, exact: true }).click();
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await expectNoHorizontalOverflow(page);
      if (process.env.UI_PALETTE_CAPTURE) {
        await page.screenshot({
          path: `../../docs/ui-qa/landing-teal-${theme.toLowerCase()}-${width}.png`,
          fullPage: true,
          animations: 'disabled',
        });
      }
    }
  }
  await page.getByRole('button', { name: /Try a \$48 example/ }).click();
  await expect(page.getByRole('button', { name: 'Sign in to save split' })).toBeEnabled();
  await expect(page.getByText(/Sign in or create an account to keep this split/)).toBeVisible();
  if (process.env.UI_PALETTE_CAPTURE) {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `../../docs/ui-qa/guest-save-dark-${width}.png`,
        fullPage: true,
        animations: 'disabled',
      });
    }
  }
});

test('unfinished work survives sign-in failures and offline payments', async ({ page }) => {
  await signIn(page);
  await newGroup(page, `Recovery check ${Date.now()}`);
  await page.getByRole('button', { name: 'Group options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Members', exact: true }).click();
  await page.getByRole('textbox', { name: 'Member name to add' }).fill('Sam');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Member name to add' })).toHaveValue('');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.toast')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add expense', exact: true }).first().click();
  await page.getByLabel('Amount', { exact: true }).fill('40');
  await page.getByLabel('Amount', { exact: true }).press('Enter');
  await expect(page.getByLabel('What the expense was for')).toBeFocused();
  await page.getByLabel('What the expense was for').fill('Recovery dinner');
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 520 });
    await page.getByLabel('Amount', { exact: true }).fill('123456.78');
    await page.getByLabel('Amount', { exact: true }).press('Enter');
    await expect(page.getByLabel('What the expense was for')).toBeFocused();
    expect(
      await page.locator('.sheet-content').evaluate((sheet) => sheet.scrollWidth <= sheet.clientWidth),
    ).toBe(true);
    const memberChoices = page
      .getByRole('dialog')
      .locator('label')
      .filter({ has: page.locator('input[type=checkbox]') });
    for (const choice of await memberChoices.all()) {
      expect((await choice.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    if (process.env.UI_MOBILE_CAPTURE)
      await page.screenshot({ path: `../../docs/ui-qa/mobile-input-${width}.png`, animations: 'disabled' });
  }
  await page.getByLabel('Amount', { exact: true }).fill('40');
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.route('**/api/groups/*/expenses', (route) => {
    if (route.request().method() === 'POST')
      return route.fulfill({ status: 401, json: { message: 'Unauthorized' } });
    return route.continue();
  });
  await page.locator('form').getByRole('button', { name: 'Add expense', exact: true }).click();
  const recovery = page.getByRole('link', { name: 'Sign in again (opens a new tab)' });
  await expect(recovery).toBeVisible();
  await expect(recovery).toHaveAttribute('target', '_blank');
  await expect(recovery).toHaveAttribute('href', /return_to=.*groups/);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await recovery.evaluate((link) => link.scrollIntoView({ block: 'center' }));
    expect(
      await recovery.evaluate((link) => {
        const rect = link.getBoundingClientRect();
        return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === link;
      }),
    ).toBe(true);
    if (process.env.UI_RECOVERY_CAPTURE)
      await page.screenshot({
        path: `../../docs/ui-qa/session-recovery-${width}.png`,
        animations: 'disabled',
      });
  }
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    if (process.env.UI_RECOVERY_CAPTURE)
      await page.screenshot({
        path: `../../docs/ui-qa/discard-recovery-${width}.png`,
        animations: 'disabled',
      });
  }
  await page.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByLabel('Amount', { exact: true })).toHaveValue('40.00');
  await expect(page.getByLabel('What the expense was for')).toHaveValue('Recovery dinner');
  await page.unroute('**/api/groups/*/expenses');
  await page.locator('form').getByRole('button', { name: 'Add expense', exact: true }).click();
  await expect(page.getByLabel('Amount', { exact: true })).toBeHidden();
  await page.getByRole('button', { name: 'Log a payment', exact: true }).click();
  await page.getByLabel('Who paid', { exact: true }).selectOption({ label: 'Sam' });
  await page.getByLabel('Paid to', { exact: true }).selectOption({ label: 'Robin' });
  await page.getByLabel('Amount', { exact: true }).fill('5');
  await page.context().setOffline(true);
  await page
    .getByRole('dialog', { name: 'Log a payment' })
    .getByRole('button', { name: 'Record payment', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('Waiting for signal · not counted yet')).toBeVisible();
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('owewell:outbox') ?? '[]'));
  expect(before).toHaveLength(1);
  expect(before[0]).toMatchObject({ kind: 'settlement', amountCents: 500 });
  await page.context().setOffline(false);
  await expect(page.getByText('Waiting for signal · not counted yet')).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('owewell:outbox') ?? '[]').length))
    .toBe(0);
});

test('an uneven equal split explains the preview and names its saved rounding share', async ({ page }) => {
  await signIn(page);
  await newGroup(page, `Rounding review ${Date.now()}`);
  await page.getByRole('button', { name: /member. Open the member list/ }).click();
  for (const name of ['Sam', 'Alex']) {
    await page.getByPlaceholder('Add someone by name').fill(name);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('button', { name: `Options for ${name}`, exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Close', exact: true }).first().click();
  await page.getByRole('button', { name: 'Add expense', exact: true }).first().click();
  await page.getByLabel('Amount', { exact: true }).fill('1.00');
  await page.getByLabel('What the expense was for').fill('One dollar, three people');
  await expect(page.getByText(/The total needs a rounding cent/)).toBeVisible();
  await page.locator('form').getByRole('button', { name: 'Add expense', exact: true }).click();
  await page.getByText('One dollar, three people', { exact: true }).first().click();
  const rounding = page.getByText(/The total doesn’t divide evenly/);
  await expect(rounding).toBeVisible();
  await expect(rounding).toContainText('one extra cent');
  await expect(page.locator('.toast')).toHaveCount(0);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await rounding.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: test.info().outputPath(`refinement-rounding-${width}.png`),
      animations: 'disabled',
    });
    await expectNoHorizontalOverflow(page);
  }
});
