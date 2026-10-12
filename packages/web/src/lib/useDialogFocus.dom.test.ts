import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { createRef } from 'react';
import { useDialogFocus } from './useDialogFocus';

/**
 * What a modal owes a keyboard, tested directly.
 *
 * Sheet and Confirm both lean on this, and both have their own tests, but those check that a
 * dialog behaves — not that the trap handles the cases a dialog rarely reaches. The ones that go
 * wrong quietly are the two restores: focus back to whatever opened the dialog, and body overflow
 * back to what it was rather than to blank. Neither is visible in a screenshot, and the second
 * only shows up on a page that had set overflow for its own reasons.
 */

function fixture(buttons = 2): { dialog: HTMLDivElement; opener: HTMLButtonElement } {
  const opener = document.createElement('button');
  opener.textContent = 'open';
  document.body.append(opener);

  const dialog = document.createElement('div');
  dialog.tabIndex = -1;
  for (let i = 0; i < buttons; i++) {
    const b = document.createElement('button');
    b.textContent = `b${i}`;
    dialog.append(b);
  }
  document.body.append(dialog);
  return { dialog, opener };
}

const tab = (shiftKey = false): boolean =>
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true, bubbles: true }),
  );

const escape = (): void => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
};

function mount(
  dialog: HTMLElement,
  open: boolean,
  onClose = vi.fn(),
  initialFocus?: () => HTMLElement | null,
) {
  const ref = createRef<HTMLElement>();
  (ref as { current: HTMLElement | null }).current = dialog;
  const view = renderHook(({ isOpen }) => useDialogFocus(ref, isOpen, onClose, initialFocus), {
    initialProps: { isOpen: open },
  });
  return { ...view, onClose };
}

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

afterEach(() => {
  document.body.innerHTML = '';
  document.body.style.overflow = '';
});

describe('what gets focus when it opens', () => {
  it('focuses the dialog itself by default', () => {
    const { dialog } = fixture();
    mount(dialog, true);
    expect(document.activeElement).toBe(dialog);
  });

  // Only for a dialog you opened in order to type; see the Sheet's autoFocusField.
  it('focuses a field when one is nominated', () => {
    const { dialog } = fixture();
    const target = dialog.querySelectorAll('button')[1]!;
    mount(dialog, true, vi.fn(), () => target);
    expect(document.activeElement).toBe(target);
  });

  it('does nothing at all while closed', () => {
    const { dialog, opener } = fixture();
    opener.focus();
    mount(dialog, false);
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe('');
  });
});

describe('keeping Tab inside', () => {
  it('wraps forward off the last one', () => {
    const { dialog } = fixture();
    const [first, last] = [...dialog.querySelectorAll('button')];
    mount(dialog, true);
    last!.focus();
    expect(tab()).toBe(false); // preventDefault
    expect(document.activeElement).toBe(first);
  });

  it('wraps backward off the first one', () => {
    const { dialog } = fixture();
    const [first, last] = [...dialog.querySelectorAll('button')];
    mount(dialog, true);
    first!.focus();
    expect(tab(true)).toBe(false);
    expect(document.activeElement).toBe(last);
  });

  it('leaves a Tab in the middle alone', () => {
    const { dialog } = fixture(3);
    const middle = dialog.querySelectorAll('button')[1]!;
    mount(dialog, true);
    middle.focus();
    expect(tab()).toBe(true); // not prevented; the browser moves on by itself
  });

  /*
   * Focus can start outside the dialog: a click on the page behind, or a browser restoring focus
   * after an alert. The next Tab has to pull it back rather than continue through the page.
   */
  it('pulls focus back in when it has escaped', () => {
    const { dialog, opener } = fixture();
    mount(dialog, true);
    opener.focus();
    tab();
    expect(document.activeElement).toBe(dialog.querySelector('button'));
  });

  it('pulls focus back to the end when shift-tabbing from outside', () => {
    const { dialog, opener } = fixture();
    const last = [...dialog.querySelectorAll('button')].at(-1)!;
    mount(dialog, true);
    opener.focus();
    tab(true);
    expect(document.activeElement).toBe(last);
  });

  // A dialog with nothing focusable in it still must not let Tab walk into the page behind.
  it('holds on to Tab even with nothing to focus', () => {
    const { dialog } = fixture(0);
    mount(dialog, true);
    expect(tab()).toBe(false);
    expect(document.activeElement).toBe(dialog);
  });
});

describe('Escape', () => {
  it('asks the caller to close', () => {
    const { dialog } = fixture();
    const { onClose } = mount(dialog, true);
    escape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // The listener is on the document, so leaving it attached would close dialogs that are not open.
  it('is ignored once the dialog has gone', () => {
    const { dialog } = fixture();
    const { onClose, unmount } = mount(dialog, true);
    unmount();
    escape();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('putting things back', () => {
  /*
   * Without this, dismissing a confirm drops you at the top of the document and a keyboard user has
   * to tab all the way back to the control they just used.
   */
  it('hands focus back to whatever opened it', () => {
    const { dialog, opener } = fixture();
    opener.focus();
    const { rerender } = mount(dialog, true);
    expect(document.activeElement).toBe(dialog);
    rerender({ isOpen: false });
    expect(document.activeElement).toBe(opener);
  });

  it('locks the page behind while it is open', () => {
    const { dialog } = fixture();
    mount(dialog, true);
    expect(document.body.style.overflow).toBe('hidden');
  });

  /*
   * Restored to what it was, not to empty. Blanking it would quietly undo any overflow the page had
   * set for its own reasons — and a second dialog opening over the first is exactly that case.
   */
  it('restores the overflow it found rather than clearing it', () => {
    document.body.style.overflow = 'clip';
    const { dialog } = fixture();
    const { rerender } = mount(dialog, true);
    expect(document.body.style.overflow).toBe('hidden');
    rerender({ isOpen: false });
    expect(document.body.style.overflow).toBe('clip');
  });

  it('unlocks on unmount too, not only on close', () => {
    const { dialog } = fixture();
    const { unmount } = mount(dialog, true);
    unmount();
    expect(document.body.style.overflow).toBe('');
  });
});

describe('visible dialog controls', () => {
  it('wraps past controls inside a closed disclosure', () => {
    const { dialog } = fixture(1);
    const details = document.createElement('details');
    details.innerHTML = '<summary>Optional details</summary><input aria-label="Hidden note">';
    dialog.append(details);
    mount(dialog, true);
    details.querySelector('summary')!.focus();
    expect(tab()).toBe(false);
    expect(document.activeElement).toBe(dialog.querySelector('button'));
  });
  it('does not handle Escape in a different active dialog', () => {
    const { dialog } = fixture(1);
    dialog.setAttribute('role', 'dialog');
    const other = document.createElement('div');
    other.setAttribute('role', 'dialog');
    other.tabIndex = -1;
    document.body.append(other);
    const { onClose } = mount(dialog, true);
    other.focus();
    escape();
    expect(onClose).not.toHaveBeenCalled();
  });
});

it('returns focus to the replacement action when the empty-state opener is removed', () => {
  const { dialog, opener } = fixture();
  opener.dataset.focusReturn = 'add-expense';
  opener.focus();
  const { rerender } = mount(dialog, true);
  opener.remove();
  const replacement = document.createElement('button');
  replacement.dataset.focusReturn = 'add-expense';
  document.body.append(replacement);
  rerender({ isOpen: false });
  expect(document.activeElement).toBe(replacement);
});
