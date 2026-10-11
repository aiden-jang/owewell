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
  test('a group, a second person, an expense, and the split it produces', async ({ page }) => {
    await signIn(page);
    await newGroup(page, `Trip to Lisbon ${Date.now()}`);

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
    await expect(page.getByText('Dinner').first()).toBeVisible();
    const owed = page.getByText(/You're owed/).locator('..');
    await expect(owed).toContainText('$20.00');
    await expect(page.getByText('1 transfer left')).toBeVisible();
  });
});
