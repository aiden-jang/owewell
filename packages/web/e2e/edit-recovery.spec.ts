import { expect, expectNoHorizontalOverflow, signIn, test } from './fixtures';

test('competing calculator edits stay recoverable from either tab and after closing a tab', async ({
  page,
  context,
}) => {
  await signIn(page);
  await page.goto('/split');
  await page.getByLabel('Person 2 name').fill('Sam');
  await page.getByLabel('Item 1 amount').fill('40');
  await page.getByText('Details & split options').click();
  await page.getByLabel('Item 1 description').fill('Dinner');
  await page.reload();
  await expect(page.getByLabel('Item 1 amount')).toHaveValue('40.00');

  const newer = await context.newPage();
  await newer.goto('/split');
  await expect(newer.getByLabel('Item 1 amount')).toHaveValue('40.00');
  await newer.getByLabel('Item 1 amount').fill('87.50');
  await newer.getByLabel('Person 2 name').focus();
  await newer.reload();
  await expect(newer.getByLabel('Item 1 amount')).toHaveValue('87.50');

  const description = 'Late-night dinner by the waterfront with everyone';
  await context.setOffline(true);
  const staleDescription = page.getByLabel('Item 1 description');
  if (!(await staleDescription.isVisible())) await page.getByText('Details & split options').click();
  await staleDescription.fill(description);
  await expect(newer.getByLabel('Open another saved draft').locator('option')).toHaveCount(2);
  await context.setOffline(false);
  await page.reload();
  await expect(staleDescription).toHaveValue(description);
  await expect(page.getByLabel('Item 1 amount')).toHaveValue('40.00');
  await newer.reload();
  await expect(newer.getByLabel('Item 1 amount')).toHaveValue('87.50');
  await newer.close();

  const picker = page.getByLabel('Open another saved draft');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(picker).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await picker.selectOption({ index: 1 });
  await expect(page.getByLabel('Item 1 amount')).toHaveValue('87.50');
  await expect(picker.locator('option').nth(1)).toContainText(description);
  await page.reload();
  await expect(page.getByLabel('Item 1 amount')).toHaveValue('87.50');
  await page.getByRole('button', { name: 'Save to my account' }).click();
  await expect(page).toHaveURL(/\/groups\//);
  await page.goto('/split');
  await expect(staleDescription).toHaveValue(description);
  await expect(page.getByLabel('Item 1 amount')).toHaveValue('40.00');
  await expect(picker).toHaveCount(0);
});

test('an offline edit requires a fresh decision if the ledger changes during review', async ({
  page,
  context,
}) => {
  await signIn(page);
  const session = await page.request.get('/api/me');
  expect(session.ok()).toBe(true);
  const { personId } = await session.json();
  const created = await page.request.post('/api/groups', { data: { name: 'Offline edit review' } });
  expect(created.ok()).toBe(true);
  const { group } = await created.json();
  const endpoint = `/api/groups/${group.id}/expenses`;
  const payload = {
    description: 'Dinner',
    amountCents: 4000,
    payerId: personId,
    participants: [{ userId: personId }],
    splitMethod: 'EQUAL',
  };
  const expense = await page.request.post(endpoint, { data: payload });
  expect(expense.ok()).toBe(true);
  const { id, version } = (await expense.json()).expense;
  const editor = await context.newPage();
  await editor.goto('/split');
  const changeLedger = async (description: string, amountCents: number, expectedVersion: number) => {
    const update = await editor.request.put(`${endpoint}/${id}`, {
      data: { ...payload, description, amountCents, expectedVersion },
    });
    expect(update.ok()).toBe(true);
    return (await update.json()).expense.version as number;
  };
  await page.goto(`/groups/${group.id}`);
  await page.getByRole('button', { name: 'Dinner, $40.00. See details.' }).click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Edit expense' });
  await form.getByLabel('What the expense was for').fill('Offline dinner');
  await form.getByLabel('Amount', { exact: true }).fill('45');
  await context.setOffline(true);
  await form.getByRole('button', { name: 'Save changes' }).click();
  await expect(form).toBeHidden();
  const next = await changeLedger('First online change', 5000, version);

  await context.setOffline(false);
  const firstReview = page.getByRole('dialog', { name: /changed while you were offline/ });
  await expect(firstReview).toContainText('“First online change” for $50.00');
  await expect(firstReview).toContainText('“Offline dinner” for $45.00');
  const latest = await changeLedger('Second online change', 6000, next);
  await firstReview.getByRole('button', { name: 'Apply mine' }).click();
  const secondReview = page.getByRole('dialog', { name: /changed again/ });
  await expect(secondReview).toContainText('“Second online change” for $60.00');
  const readLedger = async () => {
    const ledger = await editor.request.get(endpoint);
    expect(ledger.ok()).toBe(true);
    return (await ledger.json()).expenses[0];
  };
  expect(await readLedger()).toMatchObject({ description: 'Second online change', version: latest });

  await secondReview.getByRole('button', { name: 'Decide later' }).click();
  await page.reload();
  await expect(firstReview).toContainText('“Second online change” for $60.00');
  await firstReview.getByRole('button', { name: 'Apply mine' }).click();
  await expect(firstReview).toBeHidden();
  await expect
    .poll(readLedger)
    .toMatchObject({ description: 'Offline dinner', amountCents: 4500, version: latest + 1 });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Offline dinner, $45.00. See details.' })).toBeVisible();
  expect(await readLedger()).toMatchObject({ version: latest + 1 });
});

test('a tip that crosses the save limit is explained before saving and stays editable after reload', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/split');
  await page.evaluate(() => {
    localStorage.setItem(
      'owewell:quick-split-draft',
      JSON.stringify({
        version: 1,
        savedAt: Date.now(),
        people: [
          { id: 'you', name: 'You' },
          { id: 'sam', name: 'Sam' },
        ],
        items: Array.from({ length: 26 }, (_, i) => ({
          id: `i${i}`,
          description: `Item ${i + 1}`,
          amount: i < 24 ? '10.00' : '',
          method: 'EQUAL',
          values: {},
          payerId: '',
        })),
        payerId: 'you',
        youId: 'you',
        splitPayers: false,
      }),
    );
  });
  await page.reload();
  const save = page.getByRole('button', { name: 'Save to my account' });
  await page.getByText('Add a tip', { exact: true }).click();
  await page.getByRole('button', { name: '20%', exact: true }).click();
  await expect(save).toBeEnabled();
  await page.getByLabel('Item 25 amount').fill('20');
  await page.getByLabel('Item 26 amount').fill('20');
  const warning = page.getByRole('status').filter({ hasText: 'This bill has 52 items.' });
  await expect(warning).toContainText('You can save up to 50 including tips');
  await expect(save).toBeDisabled();
  await expect(page.getByText('$336.00', { exact: true })).toBeVisible();
  await page.reload();
  await expect(warning).toBeVisible();
  await expect(save).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Remove automatic tips', exact: true }).click();
  await expect(warning).toBeHidden();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page).toHaveURL(/\/groups\//);
  const ledger = await page.request.get(`/api${new URL(page.url()).pathname}/expenses`);
  expect(ledger.ok()).toBe(true);
  expect((await ledger.json()).expenses).toHaveLength(26);
});
