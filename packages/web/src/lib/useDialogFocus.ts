import { useEffect, type RefObject } from 'react';

/*
 * What an aria-modal dialog owes a keyboard, in one place.
 *
 * Sheet had all of this and Confirm had a third of it: Escape and a focused button, but Tab walked
 * straight out into the page behind — on the dialog guarding Delete group and Turn off link, which
 * are the two least recoverable things in the app. It also never gave focus back on close, so
 * dismissing a confirm dropped you at the top of the document.
 *
 * Extracted rather than copied. Two implementations of a focus trap is two things to keep correct,
 * and the one that got copied second is always the one missing a case.
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

    const focusable = (): HTMLElement[] =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

    (initialFocus?.() ?? ref.current)?.focus();

    const onKey = (e: KeyboardEvent): void => {
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
      previouslyFocused?.focus?.();
    };
    // `initialFocus` is read once on open; a caller passing an inline arrow must not restart this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose, ref]);
}
