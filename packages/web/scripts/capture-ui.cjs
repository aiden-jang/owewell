const { chromium } = require(process.env.OWEWELL_PLAYWRIGHT_MODULE || '../node_modules/@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const dir = path.resolve(__dirname, '../../../docs/ui-qa');
  await fs.mkdir(dir, { recursive: true });
  const browser = await chromium.launch({
    ...(process.env.OWEWELL_BROWSER_PATH ? { executablePath: process.env.OWEWELL_BROWSER_PATH } : {}),
  });
  const now = '2026-10-10T12:00:00Z';
  const members = ['Alex', 'Sam'].map((displayName, i) => ({
    userId: 'p' + i,
    displayName,
    email: i ? null : 'preview@example.test',
    role: i ? 'MEMBER' : 'OWNER',
    joinedAt: now,
    isPlaceholder: !!i,
    venmoHandle: null,
    cashappCashtag: null,
    paypalHandle: null,
  }));
  const groups = ['Weekend away', 'The apartment', 'Dinner club', 'Coffee, apparently'].map((name, i) => ({
    id: 'g' + i,
    name,
    createdAt: now,
    archived: false,
    memberCount: 2,
    netCents: i ? -1200 : 6000,
    totalUnsettledCents: i ? 1200 : 6000,
    totalSpentCents: i ? 2400 : 12000,
    lastActivityAt: now,
    isOwner: true,
  }));
  const expenses = [
    {
      id: 'e1',
      description: 'Dinner',
      amountCents: 12000,
      payerId: 'p0',
      splitMethod: 'EQUAL',
      category: 'food',
      createdAt: now,
      date: now,
      note: null,
      version: 1,
      splits: members.map((m) => ({ userId: m.userId, owedCents: 6000 })),
    },
  ];
  try {
    for (const theme of ['warm', 'dark']) {
      const context = await browser.newContext({
        reducedMotion: 'reduce',
        colorScheme: theme === 'warm' ? 'light' : 'dark',
        serviceWorkers: 'block',
      });
      const errors = [];
      context.on('page', (p) => p.on('pageerror', (e) => errors.push(e.message)));
      let mode = 'split';
      await context.route('**/api/**', (route) => {
        const p = new URL(route.request().url()).pathname;
        if (!p.startsWith('/api/')) return route.continue();
        const empty = mode === 'empty';
        let json = {};
        if (p === '/api/me')
          json = {
            user: mode.startsWith('split')
              ? null
              : { id: 'p0', email: 'preview@example.test', displayName: 'Alex' },
            personId: 'p0',
          };
        else if (p === '/api/groups') json = { groups: empty ? [] : groups };
        else if (p.endsWith('/balances'))
          json = {
            balances: members.map((m, i) => ({
              userId: m.userId,
              displayName: m.displayName,
              netCents: i ? -6000 : 6000,
              paidCents: i ? 0 : 12000,
              owedCents: 6000,
            })),
          };
        else if (p.endsWith('/expenses')) json = { expenses };
        else if (p.endsWith('/settlements/suggested'))
          json = {
            suggested: [
              { fromUserId: 'p1', fromName: 'Sam', toUserId: 'p0', toName: 'Alex', amountCents: 6000 },
            ],
          };
        else if (p.endsWith('/settlements')) json = { settlements: [] };
        else if (p === '/api/groups/g0') json = { group: { ...groups[0], createdById: 'p0', members } };
        else return route.fulfill({ status: 400, json: { message: 'Preview does not save data.' } });
        return route.fulfill({ json });
      });
      for (const [name, url] of [
        ['split', '/split'],
        ['split-result', '/split'],
        ['empty', '/'],
        ['dashboard', '/'],
        ['group', '/groups/g0'],
        ['expense-sheet', '/groups/g0'],
      ]) {
        if (process.env.OWEWELL_UI_CASE && process.env.OWEWELL_UI_CASE !== name) continue;
        mode = name;
        console.log('Checking', theme, name);
        for (const width of [1440, 390, 320, 430, 768]) {
          const page = await context.newPage();
          await page.setViewportSize({ width, height: width === 1440 ? 900 : 780 });
          await page.addInitScript(() => localStorage.clear());
          await page.goto('http://127.0.0.1:34212' + url);
          await page.locator('h1').waitFor();
          if (name === 'group' || name === 'expense-sheet')
            await page.getByRole('heading', { name: 'Weekend away', exact: true }).waitFor();
          if (name === 'dashboard') await page.getByRole('link', { name: /Weekend away/ }).waitFor();
          if (name === 'empty') await page.getByText('No groups yet. The calm before the tab.').waitFor();
          if (name === 'split-result') {
            await page.getByPlaceholder('Person 2').fill('Sam');
            await page.getByPlaceholder('Item 1 (e.g. Dinner)').fill('Dinner');
            await page.getByPlaceholder('0.00', { exact: true }).first().fill('120');
            await page.getByText('$120.00', { exact: true }).first().waitFor();
          }
          if (name === 'expense-sheet') {
            await page.getByRole('button', { name: 'Add expense', exact: true }).click();
            await page.getByRole('dialog').waitFor();
          }
          await page.evaluate(() => document.fonts.ready);
          await page.evaluate(() => window.scrollTo(0, 0));
          assert.ok(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            theme + ' ' + name + ' overflow at ' + width,
          );
          if (width === 1440 || width === 390)
            await page.screenshot({
              path: path.join(dir, name + '-' + theme + '-' + width + '.png'),
              fullPage: name !== 'expense-sheet',
              animations: 'disabled',
            });
          await page.close();
        }
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('Visual checks passed: both themes, no page errors or horizontal overflow.');
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
