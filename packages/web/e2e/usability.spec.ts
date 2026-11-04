import { mkdir } from 'node:fs/promises';
import { test, expect, signIn, expectNoHorizontalOverflow, type Page } from './fixtures';

async function group(page: Page) {
  await signIn(page);
  const response = await page.request.post('/api/groups', { data: { name: 'Expense format review' } });
  expect(response.ok()).toBe(true);
  const { group } = await response.json();
  await page.request.post(`/api/groups/${group.id}/members`, { data: { name: 'Sam' } });
  return group;
}
async function capture(page: Page, name: string) {
  if (!process.env.OWEWELL_UX_CAPTURE) return;
  await mkdir(process.env.OWEWELL_UX_CAPTURE, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: `${process.env.OWEWELL_UX_CAPTURE}/${name}-${test.info().project.name}.png`,
    animations: 'disabled',
  });
}
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('expense formats protect real drafts while a blank format choice stays dismissible', async ({
  page,
}) => {
  const saved = await group(page);
  await page.goto(`/groups/${saved.id}`);
  const open = page.getByRole('button', { name: 'Add expense', exact: true }).first();
  await open.click();
  let sheet = page.getByRole('dialog', { name: 'Add to the tab', exact: true });
  await sheet.getByLabel('Amount', { exact: true }).fill('10.00');
  await sheet.getByLabel('What the expense was for').fill('Dinner draft');
  await sheet.getByRole('button', { name: 'Itemize a receipt', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Switch expense format?', exact: true });
  await expect(confirm).toContainText('Nothing has been added');
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page);
    await capture(page, `format-warning-${width}`);
  }
  await confirm.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(sheet.getByLabel('What the expense was for')).toHaveValue('Dinner draft');
  await expect(sheet.getByLabel('Amount', { exact: true })).toHaveValue('10.00');
  await sheet.getByRole('button', { name: 'Itemize a receipt', exact: true }).click();
  await confirm.getByRole('button', { name: 'Discard and switch', exact: true }).click();
  sheet = page.getByRole('dialog', { name: 'Add to the tab', exact: true });
  await expect(sheet.getByRole('button', { name: 'Itemize a receipt', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(sheet.getByLabel('What the expense was for')).toHaveValue('');
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await open.click();
  await sheet.getByRole('button', { name: 'Split a total', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  const expenses = await page.request.get(`/api/groups/${saved.id}/expenses`);
  expect((await expenses.json()).expenses).toEqual([]);
});

test('saving an expense prevents switching away and records exactly one real expense', async ({ page }) => {
  const saved = await group(page);
  await page.goto(`/groups/${saved.id}`);
  await page.getByRole('button', { name: 'Add expense', exact: true }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Add to the tab', exact: true });
  await sheet.getByLabel('Amount', { exact: true }).fill('40.00');
  await sheet.getByLabel('What the expense was for').fill('Shared dinner');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/groups/${saved.id}/expenses`, async (route) => {
    if (route.request().method() === 'POST') await gate;
    await route.fallback();
  });
  await sheet.getByRole('button', { name: 'Add expense', exact: true }).click();
  try {
    await expect(sheet.getByRole('button', { name: 'Itemize a receipt', exact: true })).toBeDisabled();
    await sheet.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('Discard unsaved changes?', { exact: true })).toHaveCount(0);
  } finally {
    release();
  }
  await expect(sheet).toHaveCount(0);
  const expenses = (await (await page.request.get(`/api/groups/${saved.id}/expenses`)).json()).expenses;
  expect(expenses).toHaveLength(1);
  expect(expenses[0]).toMatchObject({ description: 'Shared dinner', amountCents: 4000 });
});

test('group rename restores keyboard focus and receipt names remain fully readable', async ({ page }) => {
  const saved = await group(page);
  const members = (await (await page.request.get(`/api/groups/${saved.id}`)).json()).group.members;
  const itemName = 'A long receipt line with an edition, extras and a detailed description for everyone';
  const receipt = await page.request.post(`/api/groups/${saved.id}/expenses/itemized`, {
    data: {
      description: 'Dinner receipt',
      payerId: members[0].userId,
      taxCents: 0,
      tipCents: 0,
      items: [
        {
          name: itemName,
          amountCents: 4000,
          participantIds: members.map((member: { userId: string }) => member.userId),
        },
      ],
    },
  });
  expect(receipt.ok()).toBe(true);
  await page.goto(`/groups/${saved.id}`);
  const options = page.getByRole('button', { name: 'Group options', exact: true });
  await options.click();
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  await page.getByLabel('Group name', { exact: true }).fill('Changed draft');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(options).toBeFocused();
  await page.getByRole('button', { name: 'Dinner receipt, $40.00. See details.', exact: true }).click();
  const detail = page.getByRole('dialog', { name: 'Dinner receipt', exact: true });
  const line = detail.getByRole('list', { name: 'Receipt lines' }).getByText(itemName, { exact: false });
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page);
    expect(await line.evaluate((node) => getComputedStyle(node).whiteSpace)).toBe('normal');
    await capture(page, `receipt-details-${width}`);
  }
});
