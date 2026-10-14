import { expect, test as base, type Page } from '@playwright/test';
export { expect, type Locator, type Page } from '@playwright/test';

// Local Wrangler supplies real rate limiters. Keep each scenario's request budget independent.
export const test = base.extend({
  context: async ({ context }, use, info) => {
    const caller = `${info.project.name}:${info.file}:${info.title}`;
    const hash = [...caller].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0);
    await context.setExtraHTTPHeaders({
      'CF-Connecting-IP': `198.18.${(hash >>> 8) % 256}.${1 + (hash % 254)}`,
    });
    await use(context);
  },
});

/** Keep the strict viewport check, with enough evidence to diagnose platform-specific overflow. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  let evidence = '';
  if (dimensions.scrollWidth > dimensions.viewportWidth) {
    const layout = await page.evaluate(() => ({
      url: location.href,
      devicePixelRatio,
      scrollX,
      htmlClientWidth: document.documentElement.clientWidth,
      htmlWidth: document.documentElement.getBoundingClientRect().width,
      bodyClientWidth: document.body.clientWidth,
      visualViewportWidth: window.visualViewport?.width,
      bodyScrollWidth: document.body.scrollWidth,
      elements: [...document.querySelectorAll<HTMLElement>('body *')]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            tag: element.tagName,
            id: element.id,
            classes: element.getAttribute('class'),
            text: element.textContent?.trim().slice(0, 80),
            left: rect.left,
            right: rect.right,
            width: rect.width,
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
            display: style.display,
            position: style.position,
            minWidth: style.minWidth,
            maxWidth: style.maxWidth,
            overflowX: style.overflowX,
            transform: style.transform,
          };
        })
        .filter(
          (element) =>
            element.right > innerWidth ||
            element.left < 0 ||
            (element.scrollWidth > element.clientWidth && element.overflowX === 'visible'),
        )
        .slice(0, 40),
    }));
    evidence = JSON.stringify({ viewport: page.viewportSize(), ...dimensions, ...layout }, null, 2);
    await test.info().attach('horizontal-overflow', {
      body: evidence,
      contentType: 'application/json',
    });
  }
  expect(dimensions.scrollWidth, evidence).toBeLessThanOrEqual(dimensions.viewportWidth);
}
