import { test as base } from '@playwright/test';
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
