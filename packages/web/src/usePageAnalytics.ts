import { useEffect, useRef } from 'react';
import { reportAnalytics } from '../../../analytics/browser.js';
import type { Page } from '../../../analytics/schema.js';
export function usePageAnalytics(page: Page, navigationKey: string = page): void {
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (previous.current === navigationKey) return;
    previous.current = navigationKey;
    reportAnalytics({ name: 'page_view', page });
  }, [page, navigationKey]);
}
