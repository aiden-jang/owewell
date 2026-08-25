import { useRef, type ReactNode } from 'react';
import { Icon } from './Icon';
import { useDialogFocus } from '../lib/useDialogFocus';

/**
 * A focused overlay surface: a bottom sheet on phones, a centered modal on wider
 * screens. Closes on backdrop click or Escape, and locks background scroll.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  autoFocusField = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Put the cursor in the first field on open. Only for sheets you opened in order to type. */
  autoFocusField?: boolean;
}): ReactNode {
  const dialogRef = useRef<HTMLDivElement>(null);

  /*
   * Focus the sheet itself; reach for a field only when the sheet asks. On a phone, focusing an
   * input slides the keyboard up over the sheet the moment it opens, and typing is the point of
   * exactly one sheet.
   *
   * Never the close button, which is the first focusable thing in the header: a sheet that opens
   * with "Close" under the cursor is offering to undo itself.
   */
  useDialogFocus(dialogRef, open, onClose, () =>
    autoFocusField
      ? dialogRef.current?.querySelector<HTMLElement>(
          'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])',
        )
      : null,
  );

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
            className="tap grid h-8 w-8 place-items-center rounded-full text-muted transition hover:bg-surface2 hover:text-ink"
          >
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="overflow-y-auto px-5 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>
  );
}
