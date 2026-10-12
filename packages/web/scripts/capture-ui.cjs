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
  const stress = !!process.env.OWEWELL_UI_STRESS;
  const names = stress
    ? Array.from({ length: 10 }, (_, i) => `AlexandriaMontgomeryWithoutSpaces${i}`)
    : ['Alex', 'Sam'];
  const share = stress ? 9999990 : 6000;
  const total = share * names.length;
  const members = names.map((displayName, i) => ({
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
      splits: members.map((m) => ({ userId: m.userId, owedCents: share })),
    },
  ];
  if (stress) {
    groups[0].name = 'The extraordinarily long weekend away with everyone from the old apartment';
    groups[0].memberCount = members.length;
    groups[0].netCents = share * (members.length - 1);
    groups[0].totalUnsettledCents = groups[0].netCents;
    groups[0].totalSpentCents = total;
    expenses[0].amountCents = total;
    expenses[0].description = 'An extraordinarily long dinner description with an unexpectedly large bill';
    expenses[0].splits = members.map((m) => ({ userId: m.userId, owedCents: share }));
  }
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
            user:
              mode.startsWith('split') || mode === 'shared'
                ? null
                : { id: 'p0', email: 'preview@example.test', displayName: 'Alex' },
            personId: 'p0',
          };
        else if (p === '/api/shared/preview')
          json = {
            summary: {
              groupId: 'g0',
              groupName: groups[0].name,
              memberCount: members.length,
              totalSpentCents: total,
              perPersonCents: share,
              totalSettledCents: 0,
              members: members.map((m, i) => ({
                userId: m.userId,
                displayName: m.displayName,
                netCents: i ? -share : share * (members.length - 1),
                isPlaceholder: m.isPlaceholder,
              })),
              suggested: members.slice(1).map((m) => ({
                fromName: m.displayName,
                toName: members[0].displayName,
                amountCents: share,
              })),
              breakdown: [{ category: 'food', cents: total }],
            },
          };
        else if (p === '/api/groups') json = { groups: empty ? [] : groups };
        else if (p.endsWith('/balances'))
          json = {
            balances: members.map((m, i) => ({
              userId: m.userId,
              displayName: m.displayName,
              netCents: mode === 'settled' ? 0 : i ? -share : share * (members.length - 1),
              paidCents: i ? 0 : total,
              owedCents: share,
            })),
          };
        else if (p.endsWith('/expenses') && route.request().method() === 'POST')
          json = {
            expense: {
              ...expenses[0],
              id: 'preview-saved',
              description: 'Coffee',
              amountCents: 800,
              splits: members.map((m) => ({ userId: m.userId, owedCents: 400 })),
            },
          };
        else if (p.endsWith('/expenses')) json = { expenses };
        else if (p.endsWith('/settlements/suggested'))
          json = {
            suggested:
              mode === 'settled'
                ? []
                : members.slice(1).map((m) => ({
                    fromUserId: m.userId,
                    fromName: m.displayName,
                    toUserId: 'p0',
                    toName: members[0].displayName,
                    amountCents: share,
                  })),
          };
        else if (p.endsWith('/settlements'))
          json = {
            settlements:
              mode === 'settled'
                ? [
                    {
                      id: 's1',
                      fromUserId: 'p1',
                      toUserId: 'p0',
                      amountCents: 6000,
                      method: 'cash',
                      createdAt: now,
                    },
                  ]
                : [],
          };
        else if (p === '/api/groups/g0') json = { group: { ...groups[0], createdById: 'p0', members } };
        else return route.fulfill({ status: 400, json: { message: 'Preview does not save data.' } });
        return route.fulfill({ json });
      });
      for (const [name, url] of [
        ['split', '/split'],
        ['split-result', '/split'],
        ['empty', '/'],
        ['dashboard', '/'],
        ['directory-select', '/'],
        ['shared', '/s/preview'],
        ['group', '/groups/g0'],
        ['expense-sheet', '/groups/g0'],
        ['payment-sheet', '/groups/g0'],
        ['payment-preview-sheet', '/groups/g0'],
        ['receipt-sheet', '/groups/g0'],
        ['receipt-items-sheet', '/groups/g0'],
        ['saved', '/groups/g0'],
        ['settled', '/groups/g0'],
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
          if (name === 'group' || name === 'expense-sheet' || name === 'saved' || name === 'settled')
            await page.getByRole('heading', { name: groups[0].name, exact: true }).waitFor();
          if (name === 'dashboard')
            await page.getByRole('link', { name: new RegExp(groups[0].name) }).waitFor();
          if (name === 'directory-select') {
            await page.getByRole('button', { name: 'Select', exact: true }).click();
            await page.getByRole('button', { name: 'Cancel', exact: true }).waitFor();
            const firstCard = page.getByRole('button', { name: new RegExp(groups[0].name) });
            await firstCard.click();
            assert.equal(await firstCard.getAttribute('aria-pressed'), 'true');
          }
          if (name === 'empty') await page.getByText('No groups yet. The calm before the tab.').waitFor();
          if (name === 'split-result') {
            await page.getByPlaceholder('Person 2').fill('Sam');
            await page.getByPlaceholder('Item 1 (e.g. Dinner)').fill('Dinner');
            await page.getByPlaceholder('0.00', { exact: true }).first().fill('120');
            await page.getByText('$120.00', { exact: true }).first().waitFor();
          }
          if (name === 'payment-sheet' || name === 'payment-preview-sheet') {
            await page.getByRole('button', { name: 'Log a payment', exact: true }).click();
            const dialog = page.getByRole('dialog');
            await dialog.waitFor();
            if (name === 'payment-preview-sheet')
              await dialog.getByRole('button', { name: /Sam → Alex/ }).click();
            const action = await dialog
              .getByRole('button', { name: 'Record payment', exact: true })
              .boundingBox();
            assert.ok(action && action.y >= 0 && action.y + action.height <= (width === 1440 ? 900 : 780));
          }
          if (
            name === 'expense-sheet' ||
            name === 'receipt-sheet' ||
            name === 'receipt-items-sheet' ||
            name === 'saved'
          ) {
            await page.getByRole('button', { name: 'Add expense', exact: true }).click();
            await page.getByRole('dialog').waitFor();
            if (name === 'receipt-sheet' || name === 'receipt-items-sheet')
              await page.getByRole('button', { name: 'Itemize a receipt', exact: true }).click();
            const save = page.getByRole('dialog').getByRole('button', {
              name: name.startsWith('receipt-') ? 'Add receipt' : 'Add expense',
              exact: true,
            });
            if (name === 'receipt-items-sheet') {
              const dialog = page.getByRole('dialog');
              await dialog
                .getByRole('textbox', { name: 'Item 1 name', exact: true })
                .fill('Coffee and an ambitious pastry');
              await dialog.getByRole('textbox', { name: 'Item 1 amount', exact: true }).fill('18.50');
              await dialog.getByRole('button', { name: '+ Add another item', exact: true }).click();
              await dialog
                .getByRole('textbox', { name: 'Item 2 name', exact: true })
                .fill('The second coffee');
              await dialog.getByRole('textbox', { name: 'Item 2 amount', exact: true }).fill('6.25');
              await dialog.getByRole('textbox', { name: 'Tax', exact: true }).fill('2');
              await dialog.locator('.receipt-items').evaluate((el) => el.scrollIntoView({ block: 'start' }));
              assert.equal(
                await dialog.getByRole('textbox', { name: 'Item 1 amount', exact: true }).inputValue(),
                '18.50',
              );
              assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth));
            }
            const box = await save.boundingBox();
            assert.ok(
              box && box.y >= 0 && box.y + box.height <= (width === 1440 ? 900 : 780),
              'Save button stays visible',
            );
            if (name === 'saved') {
              await page.getByRole('dialog').getByRole('textbox', { name: 'Amount', exact: true }).fill('8');
              await page.getByPlaceholder('What was it for?').fill('Coffee');
              await save.click();
              await page.getByRole('status').getByText('Added to the tab.', { exact: true }).waitFor();
              assert.equal(
                await page.locator('.receipt-saved').evaluate((el) => getComputedStyle(el).animationName),
                'none',
              );
              await page.emulateMedia({ reducedMotion: 'no-preference' });
              assert.equal(
                await page.locator('.receipt-saved').evaluate((el) => getComputedStyle(el).animationName),
                'receipt-nod',
              );
              await page.emulateMedia({ reducedMotion: 'reduce' });
            }
          }
          await page.evaluate(() => document.fonts.ready);
          await page.evaluate(() => window.scrollTo(0, 0));
          assert.ok(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            theme + ' ' + name + ' overflow at ' + width,
          );
          if (width === 1440 || width === 390)
            await page.screenshot({
              path: path.join(dir, (stress ? 'stress-' : '') + name + '-' + theme + '-' + width + '.png'),
              fullPage: !name.endsWith('-sheet') && name !== 'directory-select',
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
