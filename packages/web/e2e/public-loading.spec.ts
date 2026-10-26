import { expect, signIn, test } from './fixtures';

test('the public calculator works while sign-in is still being checked', async ({ page }) => {
  let release!: () => void;
  const session = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/me', async (route) => {
    await session;
    await route.continue();
  });
  try {
    await page.goto('/split');
    await page.getByRole('button', { name: /Try a \$48 example/ }).click();
    await page.getByLabel('Item 1 amount').focus();
    await page.getByLabel('Item 1 amount').blur();
    await expect(page.getByText('Your share')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy summary' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Checking sign-in…' })).toBeDisabled();
    release();
    await expect(page.getByRole('button', { name: 'Sign in to save split' })).toBeEnabled();
    await expect(page.getByLabel('Item 1 amount')).toHaveValue('48.00');
  } finally {
    release();
  }
});

test('a private address waits for its session instead of redirecting to the calculator', async ({ page }) => {
  await signIn(page);
  let release!: () => void;
  const session = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/me', async (route) => {
    await session;
    await route.continue();
  });
  try {
    await page.goto('/');
    await expect(page.getByRole('status', { name: 'Checking sign-in' })).toBeVisible();
    await expect(page.getByLabel('Item 1 amount')).toHaveCount(0);
    await expect(page).toHaveURL('/');
    release();
    await expect(page.getByRole('button', { name: 'New', exact: true })).toBeVisible();
    await expect(page).toHaveURL('/');
  } finally {
    release();
  }
});

test('a failed sign-in check can be retried without losing the public bill', async ({ page }) => {
  let unavailable = true;
  await page.route('**/api/me', (route) =>
    unavailable
      ? route.fulfill({ status: 503, json: { message: 'Session temporarily unavailable' } })
      : route.continue(),
  );
  await page.goto('/split');
  await page.getByRole('button', { name: /Try a \$48 example/ }).click();
  await page.getByLabel('Item 1 amount').focus();
  await page.getByLabel('Item 1 amount').blur();
  await expect(page.getByRole('button', { name: 'Copy summary' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Sign in to save split' })).toBeDisabled();
  unavailable = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Sign in to save split' })).toBeEnabled();
  await expect(page.getByLabel('Item 1 amount')).toHaveValue('48.00');
});

test('a shared tab loads before sign-in and waits to enable seat claims', async ({ page }) => {
  await signIn(page);
  const created = await page.request.post('/api/groups', { data: { name: 'Shared before sign-in' } });
  expect(created.ok()).toBe(true);
  const { group } = await created.json();
  const member = await page.request.post(`/api/groups/${group.id}/members`, { data: { name: 'Sam' } });
  expect(member.ok()).toBe(true);
  const share = await page.request.post(`/api/groups/${group.id}/share`, { data: {} });
  expect(share.ok()).toBe(true);
  const { token } = await share.json();
  await page.context().clearCookies();
  let release!: () => void;
  const session = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/me', async (route) => {
    await session;
    await route.continue();
  });
  try {
    await page.goto(`/s/${token}`);
    await expect(page.getByRole('heading', { name: 'Shared before sign-in' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'This is me' })).toBeDisabled();
    release();
    await expect(page.getByRole('button', { name: 'This is me' })).toBeEnabled();
  } finally {
    release();
  }
});
