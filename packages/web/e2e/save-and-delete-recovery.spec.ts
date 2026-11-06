import { expect, expectNoHorizontalOverflow, signIn, test, type Page } from './fixtures';

async function startSignIn(page: Page, amount: string, description?: string) {
  let returnTo = '';
  await page.route('**/login?**', (route) => {
    returnTo = new URL(route.request().url()).searchParams.get('return_to') ?? '';
    return route.fulfill({ body: 'Test sign-in' });
  });
  await page.goto('/split');
  await page.getByLabel('Person 2 name').fill('Sam');
  await page.getByLabel('Item 1 amount').fill(amount);
  if (description) {
    const field = page.getByLabel('Item 1 description');
    if (!(await field.isVisible())) await page.getByText('Details & split options').click();
    await field.fill(description);
  }
  await page.getByRole('button', { name: 'Sign in to save split' }).click();
  await expect(page.getByText('Test sign-in')).toBeVisible();
  expect(new URL(returnTo).searchParams.get('split')).toBeTruthy();
  return returnTo;
}

function splitCard(page: Page, amount: string) {
  return page.getByRole('region', { name: new RegExp(amount.replace(/[$.]/g, '\\$&')) });
}

async function openExpense(page: Page, groupId: string, name: string) {
  await page.goto(`/groups/${groupId}`);
  await page.getByRole('button', { name: new RegExp(`${name}, .*See details`) }).click();
  return page.getByRole('dialog', { name, exact: true });
}

async function expenseFixture(page: Page) {
  await signIn(page);
  const session = await page.request.get('/api/me');
  expect(session.ok()).toBe(true);
  const { personId } = await session.json();
  const response = await page.request.post('/api/groups', { data: { name: 'Delete recovery' } });
  expect(response.ok()).toBe(true);
  const { group } = await response.json();
  const path = `/api/groups/${group.id}/expenses`;
  const payload = {
    description: 'Dinner',
    amountCents: 4000,
    payerId: personId,
    participants: [{ userId: personId }],
    splitMethod: 'EQUAL',
  };
  const created = await page.request.post(path, { data: payload });
  expect(created.ok()).toBe(true);
  const { expense } = await created.json();
  return { groupId: group.id as string, path, payload, expense };
}

async function readLedger(page: Page, path: string) {
  const response = await page.request.get(path);
  expect(response.ok()).toBe(true);
  return (await response.json()).expenses;
}

const queuedKinds = (page: Page) =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem('owewell:outbox') ?? '[]').map((row: { kind: string }) => row.kind),
  );

test('two tabs return from sign-in with their own amounts and can save both bills', async ({
  page,
  context,
}) => {
  const firstReturn = await startSignIn(page, '40', 'Dinner');
  const second = await context.newPage();
  const secondReturn = await startSignIn(second, '87.50');
  expect(firstReturn).not.toBe(secondReturn);
  await signIn(page);
  await page.goto(firstReturn);
  await second.goto(secondReturn);
  const save = (tab: Page) => tab.getByRole('button', { name: 'Save split', exact: true });
  await expect(page.getByRole('region', { name: /^Dinner/ }).first()).toContainText('$40.00');
  await expect(second.getByRole('region', { name: /^Dinner/ }).first()).toContainText('$87.50');
  await page.reload();
  await expect(splitCard(page, '$40.00')).toBeVisible();
  await save(page).first().click();
  await expect(page).toHaveURL(/\/groups\//);
  expect(await readLedger(page, `/api${new URL(page.url()).pathname}/expenses`)).toMatchObject([
    { amountCents: 4000 },
  ]);
  await expect(splitCard(second, '$40.00')).toHaveCount(0);
  await second.reload();
  await expect(splitCard(second, '$87.50')).toBeVisible();
  await save(second).click();
  await expect(second).toHaveURL(/\/groups\//);
  expect(await readLedger(second, `/api${new URL(second.url()).pathname}/expenses`)).toMatchObject([
    { amountCents: 8750 },
  ]);
  await page.goto(firstReturn);
  await expect(page.getByText('That split is no longer waiting to save.')).toBeVisible();
  await expect(save(page)).toHaveCount(0);
});

test('discard clears only the matching handoff, and long bill names fit phones', async ({
  page,
  context,
}) => {
  const longName = 'DinnerReceipt'.repeat(10);
  const firstReturn = await startSignIn(page, '40', longName);
  const second = await context.newPage();
  const secondReturn = await startSignIn(second, '87.50');
  await signIn(page);
  await page.goto(firstReturn);
  await second.goto(secondReturn);
  await expect(splitCard(second, '$40.00')).toContainText(longName);
  for (const width of [320, 390, 1440]) {
    await second.setViewportSize({ width, height: 844 });
    await expectNoHorizontalOverflow(second);
  }
  await page.goto('/split');
  await expect(page.getByLabel('Item 1 amount')).toHaveValue('40.00');
  await page.getByRole('button', { name: 'Start fresh' }).click();
  const confirm = page.getByRole('dialog', { name: 'Discard this bill and start fresh?' });
  await expect(confirm.getByRole('button', { name: 'Keep draft' })).toBeFocused();
  await confirm.getByRole('button', { name: 'Discard and start fresh' }).click();
  await expect(page.getByLabel('Item 1 amount')).toHaveValue('');
  await expect(splitCard(second, '$40.00')).toHaveCount(0);
  await expect(splitCard(second, '$87.50')).toBeVisible();
  await second.reload();
  await expect(second.getByRole('button', { name: 'Save split' })).toHaveCount(1);
  await page.goto(firstReturn);
  await expect(page.getByText('That split is no longer waiting to save.')).toBeVisible();
});

test('a pending bill from the previous storage format still saves after reload', async ({ page }) => {
  await signIn(page);
  await page.goto('/split');
  await page.evaluate(() =>
    localStorage.setItem(
      'owewell:pending-split',
      JSON.stringify({
        people: [
          { name: 'You', isPayer: true, isYou: true },
          { name: 'Sam', isPayer: false, isYou: false },
        ],
        items: [{ description: 'Earlier dinner', amountCents: 3250, splitMethod: 'EQUAL' }],
      }),
    ),
  );
  await page.goto('/');
  await expect(splitCard(page, '$32.50')).toBeVisible();
  await page.reload();
  await splitCard(page, '$32.50').getByRole('button', { name: 'Save split' }).click();
  await expect(page).toHaveURL(/\/groups\//);
  expect(await readLedger(page, `/api${new URL(page.url()).pathname}/expenses`)).toMatchObject([
    { description: 'Earlier dinner', amountCents: 3250 },
  ]);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Save split' })).toHaveCount(0);
});

test('a queued delete reviews every newer ledger version across a reconnect and reload', async ({
  page,
  context,
}) => {
  const { groupId, path, payload, expense } = await expenseFixture(page);
  const other = await context.newPage();
  await other.goto('/split');
  const dialog = await openExpense(page, groupId, 'Dinner');
  await context.setOffline(true);
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(() => queuedKinds(page)).toEqual(['delete']);
  const change = async (description: string, amountCents: number, expectedVersion: number) => {
    const update = await other.request.put(`${path}/${expense.id}`, {
      data: { ...payload, description, amountCents, expectedVersion },
    });
    expect(update.ok()).toBe(true);
    return (await update.json()).expense.version as number;
  };
  const v2 = await change('Corrected dinner', 8750, expense.version);
  await context.setOffline(false);
  const review = page.getByRole('dialog', { name: /changed while you were offline/ });
  await expect(review).toContainText('$87.50');
  await review.getByRole('button', { name: 'Decide later' }).click();
  await expect(page.getByRole('button', { name: 'Review deletion' })).toBeVisible();
  await page.reload();
  await expect(review).toContainText('$87.50');
  const v3 = await change('Latest dinner', 9600, v2);
  await review.getByRole('button', { name: 'Delete expense' }).click();
  const second = page.getByRole('dialog', { name: /changed again/ });
  await expect(second).toContainText('$96.00');
  expect(await readLedger(other, path)).toMatchObject([{ description: 'Latest dinner', version: v3 }]);
  await second.getByRole('button', { name: 'Keep expense' }).click();
  await expect.poll(() => queuedKinds(page)).toEqual([]);
  await page.reload();
  await expect(page.getByRole('button', { name: /Latest dinner, \$96\.00/ })).toBeVisible();
});

test('Undo cancels a pending delete and restores one already synced by another tab', async ({
  page,
  context,
}) => {
  const { groupId, path, expense } = await expenseFixture(page);
  const other = await context.newPage();
  await other.goto(`/groups/${groupId}`);
  await expect(other.getByRole('button', { name: /Dinner, \$40\.00/ })).toBeVisible();
  await page.route(`**/expenses/${expense.id}?**`, (route) =>
    route.request().method() === 'DELETE' ? route.abort('failed') : route.continue(),
  );
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  const queueDelete = async () => {
    const dialog = await openExpense(page, groupId, 'Dinner');
    await context.setOffline(true);
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(() => queuedKinds(page)).toEqual(['delete']);
    await expect(undo).toBeVisible();
  };
  await queueDelete();
  await undo.click();
  await expect.poll(() => queuedKinds(page)).toEqual(['restore']);
  await expect(page.getByRole('button', { name: /Dinner, \$40\.00/ })).toBeVisible();
  await context.setOffline(false);
  await expect.poll(() => queuedKinds(page)).toEqual([]);
  expect(await readLedger(other, path)).toMatchObject([{ id: expense.id, version: expense.version }]);

  await queueDelete();
  await context.setOffline(false);
  await expect.poll(() => readLedger(other, path)).toEqual([]);
  await expect.poll(() => queuedKinds(page)).toEqual([]);
  await undo.click();
  await expect
    .poll(() => readLedger(other, path))
    .toMatchObject([{ id: expense.id, version: expense.version + 2 }]);
  await page.reload();
  await other.reload();
  for (const tab of [page, other]) {
    await expect(tab.getByRole('button', { name: /Dinner, \$40\.00/ })).toBeVisible();
  }
});
