import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * A focused overlay surface: a bottom sheet on phones, a centered modal on wider
 * screens. Closes on backdrop click or Escape, and locks background scroll.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}): ReactNode {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    // Remember what had focus so we can hand it back when the sheet closes.
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = (): HTMLElement[] =>
      Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

    // Move focus into the sheet on open (first field, else the dialog itself).
    (focusable()[0] ?? dialogRef.current)?.focus();

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
        dialogRef.current?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialogRef.current?.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="animate-fade fixed inset-0 z-50 flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center"
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        className="animate-sheet surface flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border-b-0 sm:mx-4 sm:max-w-lg sm:rounded-3xl sm:border-b"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full text-muted transition hover:bg-surface2 hover:text-ink"
          >
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}
