import { expect, expectNoHorizontalOverflow, signIn, test, type Page } from './fixtures';

async function read(page: Page, path: string) {
  const response = await page.request.get(path);
  expect(response.ok()).toBe(true);
  return response.json();
}

async function dinner(page: Page, withSam = false, description = 'Dinner') {
  await signIn(page);
  const { personId } = await read(page, '/api/me');
  const response = await page.request.post('/api/groups', { data: { name: 'Dinner group' } });
  expect(response.ok()).toBe(true);
  const { group } = await response.json();
  const url = `/groups/${group.id}`;
  const path = `/api${url}`;
  const participants = [{ userId: personId }];
  let samId: string | undefined;
  if (withSam) {
    const added = await page.request.post(path + '/members', { data: { name: 'Sam' } });
    expect(added.ok()).toBe(true);
    const { member } = await added.json();
    samId = member.userId as string;
    participants.push({ userId: samId });
  }
  const created = await page.request.post(path + '/expenses', {
    data: { description, amountCents: 4000, payerId: personId, participants, splitMethod: 'EQUAL' },
  });
  expect(created.ok()).toBe(true);
  const { expense } = await created.json();
  return { path, url, personId, samId, expense };
}

const queuedKinds = (page: Page) =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem('owewell:outbox') ?? '[]').map((row: { kind: string }) => row.kind),
  );

const record = { name: 'Record payment', exact: true };
const stale = 'Group balances changed. Review them before recording this payment.';

async function confirmPayment(tab: Page) {
  await tab.getByRole('button', record).click();
  const confirmation = tab.getByRole('dialog', { name: 'Record this payment?' });
  await expect(confirmation).toContainText('Sam paid Robin $20.00');
  return confirmation.getByRole('button', record);
}

test('a confirmation left open in another tab cannot reverse a settled balance', async ({
  page,
  context,
}) => {
  const { path, url } = await dinner(page, true);
  const second = await context.newPage();
  await page.goto(url);
  await second.goto(url);
  const firstConfirm = await confirmPayment(page);
  const staleConfirm = await confirmPayment(second);
  await firstConfirm.click();
  await expect(page.getByRole('region', { name: 'Payment recorded' })).toContainText('Everyone is settled');
  await staleConfirm.click();
  await expect(second.getByRole('alert')).toContainText(stale);
  await second.reload();
  await expect(second.getByText('All settled', { exact: true })).toBeVisible();
  expect((await read(page, path + '/settlements')).settlements).toMatchObject([{ amountCents: 2000 }]);
  expect((await read(page, path + '/balances')).balances).toMatchObject([{ netCents: 0 }, { netCents: 0 }]);
});

test('a queued suggestion checks the current ledger after reconnect and reload', async ({
  page,
  context,
}) => {
  const { path, url, personId, samId } = await dinner(page, true);
  const second = await context.newPage();
  await page.goto(url);
  const confirm = await confirmPayment(page);
  await context.setOffline(true);
  await confirm.click();
  await expect.poll(() => queuedKinds(page)).toEqual(['settlement']);

  const paid = await second.request.post(path + '/settlements', {
    data: { fromUserId: samId, toUserId: personId, amountCents: 2000, method: 'cash' },
  });
  expect(paid.ok()).toBe(true);
  await context.setOffline(false);
  await page.reload();
  await page.getByText('One saved change needs attention', { exact: true }).click();
  await expect(page.getByText(stale, { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry this change' })).toHaveCount(0);
  expect((await read(page, path + '/settlements')).settlements).toMatchObject([{ amountCents: 2000 }]);
  expect((await read(page, path + '/balances')).balances).toMatchObject([{ netCents: 0 }, { netCents: 0 }]);
});

test('the same calculator bill opens its saved group after a stale tab retries', async ({
  page,
  context,
}) => {
  await signIn(page);
  const amount = (tab: Page) => tab.getByLabel('Item 1 amount');
  const save = (tab: Page) => tab.getByRole('button', { name: 'Save to my account' });
  await page.goto('/split');
  await page.getByLabel('Person 2 name').fill('Sam');
  await amount(page).fill('40');
  await amount(page).blur();
  await page.reload();
  const second = await context.newPage();
  await second.goto('/split');
  await expect(amount(second)).toHaveValue('40.00');

  await save(page).click();
  await expect(page).toHaveURL(/\/groups\//);
  await expect(page.getByRole('heading', { name: 'Quick split' })).toBeVisible();
  const saved = page.url();

  await context.setOffline(true);
  await save(second).click();
  await expect(save(second)).toBeEnabled();
  await expect(second).toHaveURL(/\/split$/);
  await context.setOffline(false);
  await second.reload();
  await expect(amount(second)).toHaveValue('40.00');
  await save(second).click();
  await expect(second).toHaveURL(saved);
  expect((await read(page, '/api/groups')).groups).toHaveLength(1);
  expect((await read(page, '/api' + new URL(saved).pathname + '/expenses')).expenses).toMatchObject([
    { amountCents: 4000 },
  ]);

  await second.goto('/split');
  await second.getByLabel('Person 2 name').fill('Sam');
  await amount(second).fill('40');
  await save(second).click();
  await expect(second).toHaveURL(/\/groups\//);
  expect(second.url()).not.toBe(saved);
  expect((await read(page, '/api/groups')).groups).toHaveLength(2);
});

test('a queued deletion can be undone from another tab after reload', async ({ page, context }) => {
  const description = 'DinnerReceipt'.repeat(8);
  const { path, url, expense } = await dinner(page, false, description);
  let canSend = false;
  const deletion = `${path}/expenses/${expense.id}`;
  await context.route(
    (request) => request.pathname === deletion || request.pathname === `${deletion}/restore`,
    (route) =>
      !canSend && ['DELETE', 'POST'].includes(route.request().method())
        ? route.fulfill({ status: 503, json: { error: 'TemporarilyUnavailable' } })
        : route.continue(),
  );
  await page.goto(url);
  await page.getByRole('button', { name: /DinnerReceipt.*See details/ }).click();
  await context.setOffline(true);
  await page
    .getByRole('dialog', { name: description, exact: true })
    .getByRole('button', { name: 'Delete', exact: true })
    .click();
  await expect.poll(() => queuedKinds(page)).toEqual(['delete']);
  await context.setOffline(false);
  await expect(page.getByText('Sync is temporarily unavailable.', { exact: false })).toBeVisible();
  await page.reload();

  const second = await context.newPage();
  await second.setViewportSize({ width: 320, height: 844 });
  await second.goto('/');
  const undo = (tab: Page) => tab.getByRole('button', { name: `Undo deletion of ${description}` });
  await expect(undo(page)).toBeVisible();
  await expect(undo(second)).toBeVisible();
  await expectNoHorizontalOverflow(second);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0);
  expect((await read(page, path + '/expenses')).expenses).toMatchObject([{ id: expense.id }]);

  await undo(second).focus();
  await undo(second).press('Enter');
  await expect.poll(() => queuedKinds(page)).toEqual(['restore']);
  await expect(undo(page)).toHaveCount(0);
  await expect(undo(second)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Sync is temporarily unavailable.', { exact: false })).toBeVisible();
  await expect.poll(() => queuedKinds(page)).toEqual(['restore']);

  const retry = page.getByRole('button', { name: 'Retry sync', exact: true });
  await expect(retry).toBeEnabled();
  canSend = true;
  await retry.click();
  await expect.poll(() => queuedKinds(page)).toEqual([]);
  await page.reload();
  await expect(page.getByRole('button', { name: /DinnerReceipt.*See details/ })).toBeVisible();
  expect((await read(page, path + '/expenses')).expenses).toMatchObject([
    { id: expense.id, version: expense.version },
  ]);
});
