import { expect, expectNoHorizontalOverflow, signIn, test, type Page } from './fixtures';
import { confirmPayment, dinner, queuedKinds, read, record } from './ledger-fixtures';

async function openMembers(page: Page) {
  await page.getByRole('button', { name: /Open the member list/ }).click();
  return page.getByRole('dialog', { name: 'Members' });
}

async function queueDelete(page: Page) {
  await page.getByRole('button', { name: /Dinner, .*See details/ }).click();
  await page.context().setOffline(true);
  await page
    .getByRole('dialog', { name: 'Dinner', exact: true })
    .getByRole('button', { name: 'Delete', exact: true })
    .click();
  await expect.poll(() => queuedKinds(page)).toContain('delete');
}

test('adding a member preserves settled history and can retry after a lost response and reload', async ({
  page,
}) => {
  const { path, url, expense, personId, guestIds } = await dinner(page);
  const payment = await page.request.post(path + '/settlements', {
    data: { fromUserId: guestIds[0], toUserId: personId, amountCents: 2000, method: 'cash' },
  });
  expect(payment.ok()).toBe(true);
  await page.goto(url);
  await expect(page.getByText('All settled', { exact: true })).toBeVisible();
  await page.route(
    '**' + path + '/members',
    async (route) => {
      const saved = await route.fetch();
      expect(saved.status()).toBe(201);
      await route.abort('failed');
    },
    { times: 1 },
  );
  let sheet = await openMembers(page);
  await sheet.getByRole('textbox', { name: 'Member name to add' }).fill('Taylor');
  await sheet.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(sheet.getByRole('alert')).toBeVisible();
  await page.reload();
  sheet = await openMembers(page);
  await expect(sheet.getByText('Taylor', { exact: true })).toBeVisible();
  await sheet.getByRole('textbox', { name: 'Member name to add' }).fill('Taylor');
  await sheet.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(sheet.getByRole('textbox', { name: 'Member name to add' })).toHaveValue('');
  const saved = await read(page, path + '/expenses');
  expect(saved.expenses).toMatchObject([{ id: expense.id, version: expense.version }]);
  expect(saved.expenses[0].splits).toEqual(expect.arrayContaining(expense.splits));
  expect(saved.expenses[0].splits).toHaveLength(expense.splits.length);
  expect((await read(page, path)).group.members).toHaveLength(3);
  await page.reload();
  await expect(page.getByText('All settled', { exact: true })).toBeVisible();
});

test('adding someone to an open bill forces a queued delete to review the new shares', async ({
  page,
  context,
}) => {
  const { path, url, expense } = await dinner(page);
  await page.goto(url);
  await queueDelete(page);
  expect((await page.request.post(path + '/members', { data: { name: 'Taylor' } })).ok()).toBe(true);
  const updated = (await read(page, path + '/expenses')).expenses[0];
  expect(updated.version).toBe(expense.version + 1);
  expect(updated.splits).toHaveLength(3);
  await context.setOffline(false);
  const review = page.getByRole('dialog', { name: /changed while you were offline/ });
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: 'Keep expense' }).click();
  await expect.poll(() => queuedKinds(page)).toEqual([]);
  expect((await read(page, path + '/expenses')).expenses).toHaveLength(1);
});

test('older queued payments stop for review even when a matching payment is already saved', async ({
  page,
}) => {
  const { path, url, personId, guestIds } = await dinner(page);
  const payment = { fromUserId: guestIds[0], toUserId: personId, amountCents: 2000, method: 'cash' };
  expect((await page.request.post(path + '/settlements', { data: payment })).ok()).toBe(true);
  await page.goto('/split');
  const clientId = crypto.randomUUID();
  await page.evaluate((entry) => localStorage.setItem('owewell:outbox', JSON.stringify([entry])), {
    kind: 'settlement',
    ownerId: personId,
    groupId: url.split('/').at(-1),
    clientId,
    amountCents: 2000,
    queuedAt: Date.now(),
    description: 'Sam → Robin',
    payload: { ...payment, clientId },
  });
  await page.goto(url);
  await page.getByText('One saved change needs attention', { exact: true }).click();
  await page.getByRole('button', { name: 'Review payment', exact: true }).click();
  const review = page.getByRole('dialog', { name: 'Review saved payment' });
  await expect(review).toContainText('A matching payment is already in the ledger.');
  await expect(review.getByRole('button', { name: 'Back' })).toBeFocused();
  await review.getByRole('button', { name: 'Back' }).click();
  expect((await read(page, path + '/settlements')).settlements).toHaveLength(1);
});

test('a stale suggestion stops blocking manual recording after reconnect', async ({ page, context }) => {
  const { path, url, personId } = await dinner(page);
  await page.goto(url);
  const confirm = await confirmPayment(page);
  await context.setOffline(true);
  await confirm.click();
  await expect.poll(() => queuedKinds(page)).toEqual(['settlement']);
  expect(
    (
      await page.request.post(path + '/expenses', {
        data: {
          description: 'My coffee',
          amountCents: 500,
          payerId: personId,
          participants: [{ userId: personId }],
          splitMethod: 'EQUAL',
        },
      })
    ).ok(),
  ).toBe(true);
  await context.setOffline(false);
  await page.reload();
  await page.getByText('One saved change needs attention', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review payment', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Log a payment', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Log a payment' });
  await sheet.getByRole('button', { name: /Sam.*Robin.*20\.00/ }).click();
  await sheet.getByRole('button', record).click();
  await expect(page.getByRole('region', { name: 'Payment recorded' })).toContainText('$20.00');
  expect((await read(page, path + '/settlements')).settlements).toHaveLength(1);
});

for (const variant of ['older pending save', 'blank item'] as const) {
  test(`a second tab reuses the saved group with ${variant}`, async ({ page, context }) => {
    await signIn(page);
    const amount = (tab: Page) => tab.getByLabel('Item 1 amount');
    const save = (tab: Page) => tab.getByRole('button', { name: 'Save to my account' });
    await page.goto('/split');
    await page.getByLabel('Person 2 name').fill('Sam');
    await amount(page).fill('40');
    await amount(page).blur();
    await page.reload();
    await expect(amount(page)).toHaveValue('40.00');
    if (variant === 'older pending save') {
      const { personId } = await read(page, '/api/me');
      await page.evaluate(
        ({ clientId, personId }) => {
          const draftRevision = sessionStorage.getItem('owewell:quick-split-draft');
          localStorage.setItem(
            'owewell:pending-split:' + clientId,
            JSON.stringify({
              clientId,
              ownerId: personId,
              draftRevision,
              people: [
                { name: 'You', isPayer: true, isYou: true },
                { name: 'Sam', isPayer: false, isYou: false },
              ],
              items: [
                { description: 'Quick split', amountCents: 4000, splitMethod: 'EQUAL', values: [null, null] },
              ],
            }),
          );
        },
        { clientId: crypto.randomUUID(), personId },
      );
    }
    const second = await context.newPage();
    await second.goto('/split');
    await expect(amount(second)).toHaveValue('40.00');
    if (variant === 'blank item') {
      await second.getByRole('button', { name: '+ Add item', exact: true }).click();
      await expect(second.getByLabel('Item 2 amount')).toHaveValue('');
    }
    await save(page).click();
    await expect(page).toHaveURL(/\/groups\//);
    await save(second).click();
    await expect(second).toHaveURL(page.url());
    expect((await read(page, '/api/groups')).groups).toHaveLength(1);
  });
}

test('Undo is available when a reloaded tab cannot reach sign-in', async ({ page, context }) => {
  const { path, url, expense } = await dinner(page, [], 'Dinner party');
  await page.goto(url);
  await queueDelete(page);
  await page.route('**/api/me', (route) => route.abort('internetdisconnected'));
  await page.route(
    (url) => url.pathname === `${path}/expenses/${expense.id}`,
    (route) =>
      route.request().method() === 'DELETE' ? route.abort('internetdisconnected') : route.continue(),
  );
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Couldn’t check your sign-in.' })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 844 });
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: /Undo deletion of Dinner in Dinner party/ }).click();
  await expect.poll(() => queuedKinds(page)).toEqual(['restore']);
  await page.unroute('**/api/me');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect.poll(() => queuedKinds(page)).toEqual([]);
  expect((await read(page, path + '/expenses')).expenses).toMatchObject([
    { id: expense.id, version: expense.version },
  ]);
});

test('a returning dashboard refreshes balances changed in another tab', async ({ page, context }) => {
  const { url } = await dinner(page);
  await page.goto('/');
  const group = page.getByRole('link').filter({ has: page.getByText('Dinner group', { exact: true }) });
  await expect(group).toContainText('+$20.00');
  const second = await context.newPage();
  await second.goto(url);
  await (await confirmPayment(second)).click();
  await expect(second.getByText('All settled', { exact: true })).toBeVisible();
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(group).toContainText(/settled up|you.re square/i);
});

test('dashboard Undo identifies two older pending deletions by group', async ({ page }) => {
  const { path, url, expense, personId } = await dinner(page, [], 'Dinner party');
  const second = await page.request.post('/api/groups', { data: { name: 'Weekend trip' } });
  expect(second.ok()).toBe(true);
  const { group } = await second.json();
  const secondPath = `/api/groups/${group.id}/expenses`;
  const saved = await page.request.post(secondPath, {
    data: {
      description: 'Dinner',
      amountCents: 8700,
      payerId: personId,
      participants: [{ userId: personId }],
      splitMethod: 'EQUAL',
    },
  });
  expect(saved.ok()).toBe(true);
  const { expense: other } = await saved.json();
  const ids = [expense.id, other.id];
  await page.route(
    (url) => ids.some((id) => url.pathname.endsWith('/expenses/' + id)),
    (route) =>
      route.request().method() === 'DELETE'
        ? route.fulfill({ status: 503, json: { error: 'UNAVAILABLE' } })
        : route.continue(),
  );
  await page.goto('/split');
  await page.evaluate(
    (entries) => localStorage.setItem('owewell:outbox', JSON.stringify(entries)),
    [expense, other].map((entry, i) => ({
      kind: 'delete',
      clientId: crypto.randomUUID(),
      ownerId: personId,
      groupId: i === 0 ? url.split('/').at(-1) : group.id,
      expenseId: entry.id,
      expectedVersion: entry.version,
      description: entry.description,
      queuedAt: Date.now() + i,
    })),
  );
  await page.goto('/');
  const pending = page.getByRole('list', { name: 'Pending and recent deletions' });
  await expect(
    pending.getByRole('button', { name: 'Undo deletion of Dinner in Dinner party', exact: true }),
  ).toBeVisible();
  await expect(
    pending.getByRole('button', { name: 'Undo deletion of Dinner in Weekend trip', exact: true }),
  ).toBeVisible();
  await pending.getByRole('button', { name: 'Undo deletion of Dinner in Weekend trip', exact: true }).click();
  await expect(
    pending.getByRole('button', { name: 'Undo deletion of Dinner in Weekend trip', exact: true }),
  ).toHaveCount(0);
  await expect(
    pending.getByRole('button', { name: 'Undo deletion of Dinner in Dinner party', exact: true }),
  ).toBeVisible();
  expect((await read(page, path + '/expenses')).expenses).toHaveLength(1);
});
