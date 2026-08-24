import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Sheet } from './Sheet';

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
