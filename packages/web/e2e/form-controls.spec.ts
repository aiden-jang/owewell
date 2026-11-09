import type { Locator } from '@playwright/test';
import { expect, expectNoHorizontalOverflow, signIn, test } from './fixtures';
import { dinner } from './ledger-fixtures';

async function expectPlaceholderContrast(field: Locator, minimum = 4.5) {
  await expect(field).toBeVisible();
  await expect(field).toHaveValue('');
  const contrast = await field.evaluate((input) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    const luminance = () => {
      const [r, g, b] = Array.from(ctx.getImageData(0, 0, 1, 1).data, (value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const layers = [];
    for (let node: Element | null = input; node; node = node.parentElement) {
      layers.unshift(getComputedStyle(node).backgroundColor);
    }
    for (const background of layers) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, 1, 1);
    }
    const background = luminance();
    const hint = getComputedStyle(input, '::placeholder');
    ctx.fillStyle = hint.color;
    ctx.globalAlpha = Number(hint.opacity);
    ctx.fillRect(0, 0, 1, 1);
    const text = luminance();
    return (Math.max(text, background) + 0.05) / (Math.min(text, background) + 0.05);
  });
  expect(contrast, `Contrast for ${await field.getAttribute('placeholder')}`).toBeGreaterThanOrEqual(minimum);
}

async function expectInsetChevron(select: Locator) {
  const arrow = await select.evaluate((field) => {
    const icon = field.nextElementSibling;
    if (!(icon instanceof SVGElement)) return null;
    const control = field.getBoundingClientRect();
    const chevron = icon.getBoundingClientRect();
    return {
      appearance: getComputedStyle(field).appearance,
      centerOffset: chevron.y + chevron.height / 2 - (control.y + control.height / 2),
      inset: control.right - chevron.right,
      textGap: chevron.left - (control.right - parseFloat(getComputedStyle(field).paddingRight)),
      pointerEvents: getComputedStyle(icon).pointerEvents,
    };
  });
  expect(arrow).toMatchObject({ appearance: 'none', pointerEvents: 'none' });
  expect(arrow!.centerOffset).toBeCloseTo(0, 0);
  expect(arrow!.inset).toBeCloseTo(12, 0);
  expect(arrow!.textGap).toBeGreaterThanOrEqual(8);
}

test('calculator dropdowns reserve space for their arrows and keep native selection', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto('/split');
  const name = 'AlexandriaMontgomeryWithAnUnbrokenName';
  await page.getByPlaceholder('Person 2').fill(name);
  await page.getByLabel('different people paid').check();
  const selects = page.getByRole('combobox');
  await expect(selects).toHaveCount(4);
  for (const select of await selects.all()) {
    await expectInsetChevron(select);
  }
  const splitMethod = await page.getByRole('combobox', { name: 'Item 1 split method' }).boundingBox();
  const description = await page.getByRole('textbox', { name: 'Item 1 description' }).boundingBox();
  expect(splitMethod?.width).toBe(description?.width);
  const payer = page.getByRole('combobox', { name: 'Who paid?', exact: true });
  await payer.selectOption({ label: name });
  await expect(payer.locator('option:checked')).toHaveText(name);
  await expectNoHorizontalOverflow(page);
});

for (const theme of ['warm', 'dark']) {
  test(`calculator and receipt placeholders stay readable in ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width: theme === 'warm' ? 320 : 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript((choice) => localStorage.setItem('owewell:theme', choice), theme);
    await page.goto('/split');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expectPlaceholderContrast(page.getByLabel('Person 2 name'));
    await expectPlaceholderContrast(page.getByLabel('Item 1 amount'), 3);
    await page.getByText('Add a tip', { exact: true }).click();
    await expectPlaceholderContrast(page.getByLabel('Custom tip percentage'));
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: info.outputPath('calculator-placeholders.png'), animations: 'disabled' });

    const { url } = await dinner(page);
    await page.goto(url);
    await page.getByRole('button', { name: 'Add expense', exact: true }).first().click();
    const form = page.getByRole('dialog', { name: 'Add to the tab', exact: true });
    await form.getByRole('button', { name: 'Itemize a receipt' }).click();
    await expectPlaceholderContrast(form.getByLabel('What the expense was for'));
    await expectPlaceholderContrast(form.getByLabel('Item 1 amount', { exact: true }));
    await expectPlaceholderContrast(form.getByLabel('Tax', { exact: true }));
    await expectNoHorizontalOverflow(page);
    await form.getByLabel('Item 1 amount', { exact: true }).focus();
    await expect(form.getByLabel('Item 1 amount', { exact: true })).toBeFocused();
    await page.screenshot({ path: info.outputPath('receipt-placeholders.png'), animations: 'disabled' });
  });

  for (const width of [1440, 390]) {
    test(`payment controls keep inset arrows and keyboard focus at ${width}px in ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript((choice) => localStorage.setItem('owewell:theme', choice), theme);
      await signIn(page);
      const created = await page.request.post('/api/groups', { data: { name: 'Payment controls' } });
      expect(created.ok()).toBe(true);
      const { group } = await created.json();
      const added = await page.request.post(`/api/groups/${group.id}/members`, { data: { name: 'Sam' } });
      expect(added.ok()).toBe(true);
      const { member } = await added.json();
      const expense = await page.request.post(`/api/groups/${group.id}/expenses`, {
        data: {
          description: 'Dinner',
          amountCents: 4000,
          payerId: group.members[0].userId,
          splitMethod: 'EQUAL',
          participants: [{ userId: group.members[0].userId }, { userId: member.userId }],
        },
      });
      expect(expense.ok()).toBe(true);
      await page.goto(`/groups/${group.id}`);
      await expect(page.getByText('1 transfer left')).toBeVisible();
      for (const mode of ['settlement', 'record']) {
        if (mode === 'record') await page.getByRole('button', { name: 'Log a payment', exact: true }).click();
        const scope = mode === 'record' ? page.getByRole('dialog', { name: 'Log a payment' }) : page;
        const method = scope
          .getByRole('combobox', { name: 'Payment method', exact: true })
          .filter({ visible: true });
        await expectInsetChevron(method);
        await method.click();
        await method.selectOption('zelle');
        await expect(method).toHaveCSS('outline-style', 'none');
        await page
          .getByRole('heading', {
            name: mode === 'record' ? 'Log a payment' : 'Payment controls',
            exact: true,
          })
          .click();
        await expect(method).toHaveCSS('outline-style', 'none');
        await page.screenshot({
          path: test.info().outputPath(`${mode}-pointer-${theme}-${width}.png`),
          animations: 'disabled',
        });
        await method.focus();
        const safari = process.platform === 'darwin' && test.info().project.name === 'webkit';
        await page.keyboard.press(safari ? 'Alt+Tab' : 'Tab');
        await page.keyboard.press(safari ? 'Alt+Shift+Tab' : 'Shift+Tab');
        await expect(method).toBeFocused();
        await expect(method).toHaveCSS('outline-width', '2px');
        await expectNoHorizontalOverflow(page);
        await method.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: test.info().outputPath(`${mode}-${theme}-${width}.png`),
          animations: 'disabled',
        });
      }
    });
  }
}
