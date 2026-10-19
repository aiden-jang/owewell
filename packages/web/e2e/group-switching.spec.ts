import { expect, signIn, test } from './fixtures';

test('switching groups clears the previous ledger and invite while the next group loads', async ({
  page,
}) => {
  await signIn(page);
  const create = async (name: string) => {
    const response = await page.request.post('/api/groups', { data: { name } });
    expect(response.ok()).toBe(true);
    return (await response.json()).group as { id: string; name: string };
  };
  const first = await create(`First group ${Date.now()}`);
  const second = await create(`Second group ${Date.now()}`);
  await page.goto(`/groups/${first.id}`);
  await expect(page.getByRole('heading', { name: first.name, exact: true })).toBeVisible();
  const link = page.getByRole('textbox', { name: 'Share link', exact: true });
  await expect(link).toBeVisible();
  const originalLink = await link.inputValue();

  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/groups/${second.id}`, async (route) => {
    await held;
    await route.continue();
  });
  const loading = page.waitForRequest(`**/api/groups/${second.id}`);
  try {
    await page.getByRole('combobox', { name: 'Switch group', exact: true }).selectOption(second.id);
    await loading;
    await expect(page.getByRole('heading', { name: first.name, exact: true })).toHaveCount(0);
    await expect(link).toHaveCount(0);
  } finally {
    release();
  }
  await expect(page.getByRole('heading', { name: second.name, exact: true })).toBeVisible();
  await expect(link).toBeVisible();
  await expect(link).not.toHaveValue(originalLink);
  await page.goBack();
  await expect(page.getByRole('heading', { name: first.name, exact: true })).toBeVisible();
  await expect(link).toHaveValue(originalLink);
});
