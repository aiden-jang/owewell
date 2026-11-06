import { expect, signIn, test } from './fixtures';

test('saving the sign-in snapshot leaves the newer draft intact across tabs and reloads', async ({
  page,
  context,
}) => {
  await page.route('**/login?**', (route) => route.fulfill({ body: 'Test sign-in' }));
  await page.goto('/split');
  const amount = page.getByLabel('Item 1 amount');
  await page.getByLabel('Person 2 name').fill('Sam');
  await amount.fill('40');
  await page.getByRole('button', { name: 'Sign in to save split' }).click();
  await expect(page.getByText('Test sign-in')).toBeVisible();
  await signIn(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Save split', exact: true })).toBeVisible();

  const olderEditor = await context.newPage();
  await olderEditor.goto('/split');
  await expect(olderEditor.getByLabel('Item 1 amount')).toHaveValue('40.00');
  const calculator = await context.newPage();
  await calculator.goto('/split');
  const editedAmount = calculator.getByLabel('Item 1 amount');
  await expect(editedAmount).toHaveValue('40.00');
  await editedAmount.fill('87.50');
  await calculator.getByLabel('Person 2 name').focus();
  await calculator.reload();
  await expect(editedAmount).toHaveValue('87.50');
  await olderEditor.close();

  await page.getByRole('button', { name: 'Save split', exact: true }).click();
  await expect(page).toHaveURL(/\/groups\//);
  const groupId = new URL(page.url()).pathname.split('/').at(-1);
  const ledger = await page.request.get(`/api/groups/${groupId}/expenses`);
  expect(ledger.ok()).toBe(true);
  expect((await ledger.json()).expenses[0].amountCents).toBe(4000);
  await calculator.reload();
  await expect(editedAmount).toHaveValue('87.50');

  const fresh = calculator.getByRole('button', { name: 'Start fresh', exact: true });
  await fresh.click();
  const discard = calculator.getByRole('dialog', { name: 'Discard this bill and start fresh?' });
  await expect(discard.getByRole('button', { name: 'Keep draft' })).toBeFocused();
  await calculator.keyboard.press('Escape');
  await expect(fresh).toBeFocused();
  await calculator.reload();
  await expect(editedAmount).toHaveValue('87.50');
  await fresh.click();
  await discard.getByRole('button', { name: 'Discard and start fresh' }).click();
  await expect(editedAmount).toHaveValue('');
  await expect(calculator.getByRole('group', { name: 'Bill details', exact: true })).toBeFocused();
  await calculator.reload();
  await expect(editedAmount).toHaveValue('');
});

test('an offline conflict preserves group order and leaves other tabs free to sync', async ({
  page,
  context,
}) => {
  await signIn(page);
  const session = await page.request.get('/api/me');
  expect(session.ok()).toBe(true);
  const { personId } = await session.json();
  const createGroup = async (name: string) => {
    const response = await page.request.post('/api/groups', { data: { name } });
    expect(response.ok()).toBe(true);
    return (await response.json()).group.id as string;
  };
  const first = await createGroup('Conflict trip');
  const second = await createGroup('Independent trip');
  const expense = {
    description: 'Dinner',
    amountCents: 4000,
    payerId: personId,
    participants: [{ userId: personId }],
    splitMethod: 'EQUAL',
  };
  const created = await page.request.post(`/api/groups/${first}/expenses`, { data: expense });
  expect(created.ok()).toBe(true);
  const original = (await created.json()).expense;
  const edit = await page.request.put(`/api/groups/${first}/expenses/${original.id}`, {
    data: { ...expense, description: 'Server dinner', expectedVersion: original.version },
  });
  expect(edit.ok()).toBe(true);

  const base = { ownerId: personId, amountCents: 4000 };
  const makeEntry = (groupId: string, description: string, queuedAt: number) => {
    const clientId = crypto.randomUUID();
    return {
      ...base,
      groupId,
      description,
      queuedAt,
      clientId,
      kind: 'expense',
      payload: { ...expense, clientId, description },
    };
  };
  const rows = [
    {
      ...base,
      groupId: first,
      description: 'Offline dinner',
      queuedAt: 1,
      clientId: crypto.randomUUID(),
      kind: 'edit',
      expenseId: original.id,
      payload: { ...expense, description: 'Offline dinner', expectedVersion: original.version },
    },
    makeEntry(first, 'Waits behind conflict', 2),
    makeEntry(second, 'Sends despite conflict', 3),
  ];
  await page.goto('/split');
  await page.evaluate((entries) => localStorage.setItem('owewell:outbox', JSON.stringify(entries)), rows);
  await page.goto('/');
  const conflict = page.getByRole('dialog', { name: /changed while you were offline/ });
  await expect(conflict).toBeVisible();
  const descriptions = async (id: string) => {
    const response = await page.request.get(`/api/groups/${id}/expenses`);
    expect(response.ok()).toBe(true);
    return (await response.json()).expenses.map((item: { description: string }) => item.description);
  };
  expect(await descriptions(first)).toEqual(['Server dinner']);
  expect(await descriptions(second)).toEqual(['Sends despite conflict']);

  const otherTab = await context.newPage();
  await otherTab.goto('/split');
  await otherTab.evaluate(
    (entry) => {
      const remaining = JSON.parse(localStorage.getItem('owewell:outbox') ?? '[]');
      localStorage.setItem('owewell:outbox', JSON.stringify([...remaining, entry]));
    },
    makeEntry(second, 'Sends from second tab', 4),
  );
  await otherTab.goto(`/groups/${second}`);
  await expect.poll(() => descriptions(second)).toEqual(expect.arrayContaining(['Sends from second tab']));
  await expect(conflict).toBeVisible();

  await conflict.getByRole('button', { name: 'Decide later' }).click();
  await expect(page.getByRole('button', { name: 'Review edit' })).toBeEnabled();
  await page.reload();
  await conflict.getByRole('button', { name: 'Keep theirs' }).click();
  await expect
    .poll(() => descriptions(first))
    .toEqual(expect.arrayContaining(['Server dinner', 'Waits behind conflict']));
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('owewell:outbox') ?? '[]'))).toEqual([]);
});

test('invite replacement and revocation reach a second tab and each claim names its member', async ({
  page,
  context,
}) => {
  await signIn(page);
  const created = await page.request.post('/api/groups', { data: { name: 'Shared trip' } });
  expect(created.ok()).toBe(true);
  const { group } = await created.json();
  for (const name of ['Sam', 'Taylor']) {
    const member = await page.request.post(`/api/groups/${group.id}/members`, { data: { name } });
    expect(member.ok()).toBe(true);
  }
  await page.goto(`/groups/${group.id}`);
  const secondTab = await context.newPage();
  await secondTab.goto(`/groups/${group.id}`);
  const link = page.getByRole('textbox', { name: 'Share link' });
  const secondLink = secondTab.getByRole('textbox', { name: 'Share link' });
  await expect(link).toHaveValue(/\/s\//);
  const old = await link.inputValue();
  await expect(secondLink).toHaveValue(old);

  await page.getByRole('button', { name: 'New link', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'New link', exact: true }).click();
  await expect(link).not.toHaveValue(old);
  const replacement = await link.inputValue();
  await expect(secondLink).toHaveValue(replacement);

  const publicContext = await page.context().browser()!.newContext();
  try {
    const invite = await publicContext.newPage();
    await invite.goto(replacement);
    await expect(invite.getByRole('button', { name: 'This is me (Sam)', exact: true })).toBeEnabled();
    await expect(invite.getByRole('button', { name: 'This is me (Taylor)', exact: true })).toBeEnabled();
  } finally {
    await publicContext.close();
  }
  const oldResponse = await page.request.get(`/api/shared/${new URL(old).pathname.split('/').at(-1)}`);
  expect(oldResponse.status()).toBe(404);

  await page.getByRole('button', { name: 'Turn off', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Turn off', exact: true }).click();
  await expect(secondLink).toHaveCount(0);
  await secondTab.reload();
  await expect(secondTab.getByText('The invite link is off.', { exact: true })).toBeVisible();
  await expect(secondLink).toHaveCount(0);
});
