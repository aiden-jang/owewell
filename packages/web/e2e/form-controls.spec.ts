import { expect, expectNoHorizontalOverflow, signIn, test } from './fixtures';

for (const theme of ['warm', 'dark']) {
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
        expect(
          await method.evaluate((el) => parseFloat(getComputedStyle(el).paddingRight)),
        ).toBeGreaterThanOrEqual(32);
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
