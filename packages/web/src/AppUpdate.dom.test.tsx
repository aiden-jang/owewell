// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { AppUpdate } from './AppUpdate';
afterEach(() => {
  cleanup();
  document.querySelectorAll('script[data-update-test]').forEach((s) => s.remove());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
test('an update preserves the current draft and waits until the safe screen to offer reload', async () => {
  const script = document.createElement('script');
  script.type = 'module';
  script.src = '/assets/current.js';
  script.dataset.updateTest = '1';
  document.head.appendChild(script);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  const fetcher = vi.fn().mockResolvedValue(
    new Response('<script type="module" src="/assets/next.js"></script>', {
      headers: { 'content-type': 'text/html' },
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  const view = render(
    <>
      <input aria-label="Draft" defaultValue="Keep this" />
      <AppUpdate safe={false} />
    </>,
  );
  await act(async () => {
    fireEvent.focus(window);
  });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole('button', { name: 'Reload app' })).toBeNull();
  view.rerender(
    <>
      <input aria-label="Draft" defaultValue="Keep this" />
      <AppUpdate safe />
    </>,
  );
  await screen.findByRole('button', { name: 'Reload app' });
  expect((screen.getByLabelText('Draft') as HTMLInputElement).value).toBe('Keep this');
  fireEvent.click(screen.getByRole('button', { name: 'Later' }));
  expect(screen.queryByRole('button', { name: 'Reload app' })).toBeNull();
});
