import { expect, signIn, test } from './fixtures';

for (const width of [1440, 390]) {
  test(`Cancel closes an empty group form without a validation flash at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await signIn(page);
    await page.goto('/');
    const open = page.getByRole('button', { name: 'New', exact: true });
    await open.click();
    const name = page.getByRole('textbox', { name: 'Group name' });
    await expect(name).toBeFocused();
    const cancel = page.getByRole('button', { name: 'Cancel', exact: true });
    await cancel.hover();
    await page.mouse.down();
    try {
      await expect(name).toHaveAttribute('aria-invalid', 'false');
      await expect(page.getByText('Give the group a name to create it.')).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath(`cancel-${width}.png`), animations: 'disabled' });
    } finally {
      await page.mouse.up();
    }
    await expect(name).toHaveCount(0);
    await expect(open).toBeFocused();
    await open.click();
    const safari = process.platform === 'darwin' && test.info().project.name === 'webkit';
    await page.keyboard.press(safari ? 'Alt+Shift+Tab' : 'Shift+Tab');
    await expect(cancel).toBeFocused();
    await expect(name).toHaveAttribute('aria-invalid', 'false');
    await page.keyboard.press('Enter');
    await expect(name).toHaveCount(0);
    await expect(open).toBeFocused();
  });
}
