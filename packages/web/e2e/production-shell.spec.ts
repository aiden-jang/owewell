import { expect, test } from './fixtures';

test.use({ serviceWorkers: 'block' });

for (const storage of ['saved', 'unavailable'] as const) {
  test(`the production shell sets a warm theme before the bundle with ${storage} storage`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: storage === 'saved' ? 'dark' : 'light' });
    await page.addInitScript((mode) => {
      if (mode === 'saved') localStorage.setItem('owewell:theme', 'warm');
      else
        Object.defineProperty(window, 'localStorage', {
          get() {
            throw new Error('Storage unavailable');
          },
        });
    }, storage);
    let release!: () => void;
    const bundle = new Promise<void>((resolve) => {
      release = resolve;
    });
    // HTTPS keeps WebKit's upgrade-insecure-requests policy intact without a local TLS exception.
    const origin = 'https://owewell-preview.test';
    await page.route(`${origin}/**`, async (route) => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: `http://localhost:34200${url.pathname}${url.search}` });
      await route.fulfill({ response });
    });
    await page.route('**/assets/*.js', async (route) => {
      await bundle;
      await route.fallback();
    });
    try {
      // The Worker serves the built SPA with its actual production security headers.
      const response = await page.goto(`${origin}/split`, { waitUntil: 'commit' });
      expect(response?.headers()['content-security-policy']).toContain("script-src 'self'");
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'warm');
      await expect(page.locator('#root')).toBeEmpty();
      release();
      await expect(page.getByRole('heading', { name: /Split the bill/ })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'warm');
    } finally {
      release();
    }
  });
}
