import { expect, signIn, test } from './fixtures';

test('illustrated group ideas fill only the name and return keyboard focus without creating a group', async ({
  page,
}) => {
  await signIn(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'New', exact: true }).click();
  const creations: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/groups')
      creations.push(request.url());
  });
  const name = page.getByRole('textbox', { name: 'Group name' });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('.group-ideas > summary').click();
    await expect(name).toHaveAttribute('aria-invalid', 'false');
    const choices = page.getByRole('group', { name: 'Group name ideas' });
    await expect(choices.getByRole('button')).toHaveCount(3);
    await expect
      .poll(() =>
        choices
          .locator('img')
          .evaluateAll((images: HTMLImageElement[]) => images.every((image) => image.naturalWidth > 0)),
      )
      .toBe(true);
    await page.screenshot({ path: test.info().outputPath(`group-art-${width}.png`) });
    const trip = choices.getByRole('button', { name: 'Trip', exact: true });
    await trip.focus();
    await page.keyboard.press('Enter');
    await expect(name).toHaveValue('Trip');
    await expect(name).toBeFocused();
    await expect(choices).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(creations).toEqual([]);
});

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
