import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Sheet } from './Sheet';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

/**
 * Where a sheet puts the cursor, which on a phone decides whether the keyboard covers it.
 *
 * This focused the first input in every sheet, and only one sheet wanted that. Members has exactly
 * one input — "Add someone by name", the last thing in the panel — so opening the roster slid a
 * keyboard over the roster, to type into a field nobody had asked for.
 */

function open(props: Partial<React.ComponentProps<typeof Sheet>> = {}) {
  return render(
    <Sheet open onClose={vi.fn()} title="Members" {...props}>
      <ul>
        <li>Alice</li>
      </ul>
      <input aria-label="Add someone by name" />
    </Sheet>,
  );
}

describe('Sheet focus', () => {
  it('leaves the keyboard shut by default', () => {
    open();
    expect(screen.getByLabelText('Add someone by name')).not.toHaveFocus();
    expect(screen.getByRole('dialog')).toHaveFocus();
  });

  it('reaches for the field when the sheet asks', () => {
    open({ autoFocusField: true });
    expect(screen.getByLabelText('Add someone by name')).toHaveFocus();
  });

  /*
   * Never the close button, which is the first focusable thing in the header. A sheet that opens
   * with "Close" under the cursor is offering to undo itself before you have read it.
   */
  it('never opens on the close button', () => {
    open({ autoFocusField: true });
    expect(screen.getByRole('button', { name: /close/i })).not.toHaveFocus();
  });
});

describe('unfinished forms', () => {
  it('keeps entered values when closing is cancelled, then allows an explicit discard', async () => {
    const close = vi.fn();
    const user = userEvent.setup();
    open({ protectChanges: true, onClose: close });
    await user.type(screen.getByLabelText('Add someone by name'), 'Dinner');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Keep editing' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Add someone by name')).toHaveValue('Dinner');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('warns before refreshing only after an input changes', () => {
    open({ protectChanges: true });
    const before = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(before);
    expect(before.defaultPrevented).toBe(false);
    fireEvent.change(screen.getByLabelText('Add someone by name'), { target: { value: 'Dinner' } });
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(true);
  });

  it('blocks going back until the user chooses to discard', async () => {
    const router = createMemoryRouter(
      [
        { path: '/', element: <p>Overview</p> },
        {
          path: '/group',
          element: (
            <Sheet open protectChanges title="Expense" onClose={vi.fn()}>
              <input aria-label="Description" />
            </Sheet>
          ),
        },
      ],
      { initialEntries: ['/', '/group'], initialIndex: 1 },
    );
    render(<RouterProvider router={router} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Description'), 'Dinner');
    void router.navigate(-1);
    await screen.findByRole('button', { name: 'Keep editing' });
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByLabelText('Description')).toHaveValue('Dinner');
    void router.navigate(-1);
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    expect(await screen.findByText('Overview')).toBeVisible();
  });
});
