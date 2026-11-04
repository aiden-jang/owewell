import { expect, signIn, test } from './fixtures';

test('a large ledger stays bounded on screen and prints its complete history', async ({ page }) => {
  await signIn(page);
  const response = await page.request.post('/api/groups', { data: { name: 'Large ledger check' } });
  expect(response.ok()).toBe(true);
  const { group } = await response.json();
  const payerId = group.members[0].userId as string;
  const expenses = Array.from({ length: 600 }, (_, i) => ({
    id: `large-${i}`,
    description: `Journey history ${i}`,
    amountCents: 100,
    payerId,
    splitMethod: 'EQUAL',
    category: 'food',
    note: null,
    version: 1,
    createdAt: '2026-01-01T00:00:00Z',
    date: '2026-01-01T00:00:00Z',
    splits: [{ userId: payerId, owedCents: 100 }],
  }));
  await page.route(`**/api/groups/${group.id}/expenses`, (route) => route.fulfill({ json: { expenses } }));
  await page.goto(`/groups/${group.id}`);
  const rows = page.locator('.activity-ledger > li');
  await expect(rows).toHaveCount(50);
  await expect(page.locator('.print-recap')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show 50 older entries' }).click();
  await expect(rows).toHaveCount(100);
  await expect(rows.nth(50).getByRole('button').first()).toBeFocused();
  await page.getByRole('searchbox').fill('Journey history 599');
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Journey history 599');
  await page.emulateMedia({ media: 'print' });
  const recap = page.locator('.print-recap');
  await expect(recap).toBeVisible();
  await expect(
    recap
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: 'Expenses', exact: true }) })
      .locator('tbody tr'),
  ).toHaveCount(600);
  await expect(recap).toContainText('$600.00');
  await expect(recap).toContainText('Journey history 0');
  await expect(recap).toContainText('Journey history 599');
  await page.emulateMedia({ media: 'screen' });
  await expect(recap).toHaveCount(0);
  await expect(rows).toHaveCount(1);
  await page.getByRole('searchbox').fill('');
  await expect(rows).toHaveCount(50);
  if (process.env.PERF_CAPTURE) {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole('button', { name: 'Show 50 older entries' }).scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `/private/tmp/apps-perf-owewell-${test.info().project.name}-${width}.png`,
      });
    }
  }
});
