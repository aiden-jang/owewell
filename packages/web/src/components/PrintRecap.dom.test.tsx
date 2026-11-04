import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { GroupLedger } from '../lib/useGroupLedger';
import { PrintRecap } from './PrintRecap';

afterEach(() => vi.unstubAllGlobals());

it('keeps a complete large recap out of the screen DOM and mounts it synchronously for native print', () => {
  const media = new EventTarget() as MediaQueryList;
  Object.defineProperty(media, 'matches', { value: false, writable: true });
  vi.stubGlobal('matchMedia', () => media);
  const expenses = Array.from({ length: 600 }, (_, i) => ({
    id: `expense-${i}`,
    description: `History ${i}`,
    amountCents: 100,
    payerId: 'alex',
    date: '2026-01-01',
    createdAt: '2026-01-01T00:00:00Z',
  }));
  const ledger = {
    group: { name: 'Journey check', members: [{ userId: 'alex', displayName: 'Alex' }] },
    expenses,
    settlements: [],
    balances: [],
    pendingCount: 2,
  } as unknown as GroupLedger;
  const view = render(<PrintRecap ledger={ledger} />);
  expect(document.querySelector('.print-recap')).toBeNull();
  act(() => {
    window.dispatchEvent(new Event('beforeprint'));
    expect(document.querySelectorAll('.print-recap tbody tr')).toHaveLength(600);
  });
  expect(document.querySelector('.print-recap')?.textContent).toContain('$600.00');
  expect(document.querySelector('.print-recap')?.textContent).toContain('History 599');
  expect(document.querySelector('.print-recap')?.textContent).toContain('2 changes are waiting');
  act(() => window.dispatchEvent(new Event('afterprint')));
  expect(document.querySelector('.print-recap')).toBeNull();
  act(() => {
    Object.assign(media, { matches: true });
    media.dispatchEvent(new Event('change'));
  });
  expect(document.querySelectorAll('.print-recap tbody tr')).toHaveLength(600);
  act(() => {
    Object.assign(media, { matches: false });
    media.dispatchEvent(new Event('change'));
  });
  expect(document.querySelector('.print-recap')).toBeNull();
  view.unmount();
  act(() => window.dispatchEvent(new Event('beforeprint')));
  expect(document.querySelector('.print-recap')).toBeNull();
});
