import { useEffect, type RefObject } from 'react';

/*
 * What an aria-modal dialog owes a keyboard, in one place: Escape, a Tab trap, focus restored on
 * close, and the page behind locked.
 */
export function useDialogFocus(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
  /** What to focus on open. Omit for the dialog itself, which is the quiet default. */
  initialFocus?: () => HTMLElement | null | undefined,
): void {
  useEffect(() => {
    if (!open) return;
    // Remembered so it can be handed back: closing a dialog should return you where you were.
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const returnKey = previouslyFocused?.dataset.focusReturn;

    const focusable = (): HTMLElement[] =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => {
        if (element.matches(':disabled') || element.closest('[hidden], [inert], [aria-hidden="true"]'))
          return false;
        for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
          const style = getComputedStyle(ancestor);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          if (
            ancestor instanceof HTMLDetailsElement &&
            !ancestor.open &&
            !ancestor.querySelector('summary')?.contains(element)
          )
            return false;
        }
        return true;
      });

    (initialFocus?.() ?? ref.current)?.focus();

    const onKey = (e: KeyboardEvent): void => {
      const activeDialog = document.activeElement?.closest('[role="dialog"]');
      if (activeDialog && activeDialog !== ref.current) return;
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      // Trap Tab within the dialog so focus can't wander to the page behind it.
      if (e.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) {
        e.preventDefault();
        ref.current?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !ref.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !ref.current?.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    // The page behind must not scroll under a modal, whichever modal it is.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
      else if (returnKey) {
        Array.from(document.querySelectorAll<HTMLElement>('[data-focus-return]'))
          .find((element) => element.dataset.focusReturn === returnKey)
          ?.focus();
      }
    };
    // `initialFocus` is read once on open; a caller passing an inline arrow must not restart this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose, ref]);
}
