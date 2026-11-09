import { expect, expectNoHorizontalOverflow, signIn, test } from './fixtures';
import { dinner, read, record, share } from './ledger-fixtures';

test('an invite address requests review and a seat is claimed only after a deliberate click', async ({
  page,
  browser,
  baseURL,
}) => {
  const { path, url, guestIds } = await dinner(page);
  const token = await share(page, path);
  const context = await browser.newContext({ baseURL });
  try {
    const guest = await context.newPage();
    await signIn(guest);
    await guest.goto(`/s/${token}?claim=${guestIds[0]}`);
    await expect(guest.getByText(/Review the names and balances/)).toBeVisible();
    await guest.reload();
    await expect(guest.getByText(/Review the names and balances/)).toBeVisible();
    expect((await guest.request.get(path)).status()).toBe(404);
    await guest.getByRole('button', { name: 'This is me (Sam)' }).click();
    await expect(guest).toHaveURL(new URL(url, baseURL).href);
    expect((await guest.request.get(path)).status()).toBe(200);
  } finally {
    await context.close();
  }
});

test('a stale tab cannot archive a group under the new account', async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  const { path, url, guestIds, personId } = await dinner(page);
  const token = await share(page, path);
  const other = await browser.newContext({ baseURL });
  try {
    const cookie = {
      name: 'platform_session',
      value: `e2e-${crypto.randomUUID()}`,
      domain: 'localhost',
      path: '/',
    };
    await other.addCookies([cookie]);
    const otherId = (await (await other.request.get('/api/me')).json()).personId;
    expect(otherId).not.toBe(personId);
    const claim = await other.request.post(`/api/shared/${token}/claim`, { data: { personId: guestIds[0] } });
    expect(claim.ok()).toBe(true);
    await page.goto(url);
    await expect(page.getByRole('heading', { name: 'Dinner group', exact: true })).toBeVisible();
    const groupOptions = page.getByRole('button', { name: 'Group options' });
    await groupOptions.click();
    await context.addCookies([cookie]);
    const response = page.waitForResponse((res) => res.url().endsWith(path + '/archive'));
    await page.getByRole('menuitem', { name: 'Archive (hide from my list)', exact: true }).click();
    expect((await response).status()).toBe(401);
    expect((await read(page, path)).group).toMatchObject({ viewerId: otherId, archived: false });
    await page.reload();
    await groupOptions.click();
    await page.getByRole('menuitem', { name: 'Archive (hide from my list)', exact: true }).click();
    await expect(page.getByText('Group archived.', { exact: true })).toBeVisible();
    expect((await read(page, path)).group).toMatchObject({ viewerId: otherId, archived: true });
  } finally {
    await other.close();
  }
});

test('simultaneous invite claims yield one winner and a refreshed roster for the other viewer', async ({
  page,
  browser,
  baseURL,
}) => {
  const { path, url } = await dinner(page);
  const token = await share(page, path);
  const contexts = await Promise.all([browser.newContext({ baseURL }), browser.newContext({ baseURL })]);
  try {
    const tabs = await Promise.all(contexts.map((context) => context.newPage()));
    await Promise.all(tabs.map(signIn));
    await Promise.all(tabs.map((tab) => tab.goto('/s/' + token)));
    const claimPath = `/api/shared/${token}/claim`;
    let arrived = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    for (const tab of tabs) {
      await tab.route('**' + claimPath, async (route) => {
        if (++arrived === 2) release();
        await gate;
        await route.continue();
      });
    }
    const responses = tabs.map((tab) =>
      tab.waitForResponse((response) => response.url().endsWith(claimPath)),
    );
    await Promise.all(tabs.map((tab) => tab.getByRole('button', { name: 'This is me (Sam)' }).click()));
    const codes = (await Promise.all(responses)).map((response) => response.status());
    expect(codes.filter((code) => code === 200)).toHaveLength(1);
    const loser = codes.findIndex((code) => code !== 200);
    expect([404, 409]).toContain(codes[loser]);
    await expect(tabs[1 - loser]!).toHaveURL(new URL(url, baseURL).href);
    await expect(tabs[loser]!).toHaveURL(new URL('/s/' + token, baseURL).href);
    await expect(tabs[loser]!.getByRole('button', { name: 'This is me (Sam)' })).toHaveCount(0);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('same-name members have matching numbered labels on payments and invitations', async ({ page }) => {
  const { path, url } = await dinner(page, ['Sam', 'Sam']);
  const token = await share(page, path);
  await page.goto(url);
  const copies = [];
  for (const n of [0, 1]) {
    await page.getByRole('button', record).nth(n).click();
    const dialog = page.getByRole('dialog', { name: 'Record this payment?' });
    copies.push(await dialog.innerText());
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  }
  expect(copies.join(' ')).toContain('Sam (1) paid Robin $20.00');
  expect(copies.join(' ')).toContain('Sam (2) paid Robin $20.00');
  await page.context().clearCookies();
  await page.goto('/s/' + token);
  for (const label of ['This is me (Sam (1))', 'This is me (Sam (2))']) {
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
  }
  await page.setViewportSize({ width: 320, height: 820 });
  await expectNoHorizontalOverflow(page);
});
