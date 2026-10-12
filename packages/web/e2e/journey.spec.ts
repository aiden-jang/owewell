import { expect, test, type Page } from '@playwright/test';

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
    await page.getByLabel('Amount').fill('40.00');
    await page.getByLabel('What the expense was for').fill('Dinner');
    // The form's submit carries the same words as the button that opened it.
    await page.locator('form').getByRole('button', { name: 'Add expense' }).click();

    // --- the split it produces ------------------------------------------------------------
    // Forty dollars, paid by Robin, split two ways: Sam owes twenty and the group says so.
    await expect(page.getByText('Dinner', { exact: true }).first()).toBeVisible();
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
  });
});

test('group settings remain usable with long names and dark mode', async ({ page }) => {
  await signIn(page);
  const name = `A long weekend with friends, dinners and questionable plans ${Date.now()}`;
  await newGroup(page, name);
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
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
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
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
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
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (process.env.UI_PALETTE_CAPTURE) {
        await page.screenshot({
          path: `../../docs/ui-qa/landing-teal-${theme.toLowerCase()}-${width}.png`,
          fullPage: true,
          animations: 'disabled',
        });
      }
    }
  }
});
