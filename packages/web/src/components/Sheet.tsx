import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';
import { advanceFormField } from '../lib/advanceFormField';
import { SheetNavigationGuard, type BlockedNavigation } from './SheetNavigationGuard';
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
  protectChanges = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Put the cursor in the first field on open. Only for sheets you opened in order to type. */
  autoFocusField?: boolean;
  /** Ask before dismissing an unfinished expense or payment. */
  protectChanges?: boolean;
}): ReactNode {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const dirtyRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [asking, setAsking] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);
  const navigationRef = useRef<BlockedNavigation | null>(null);
  const blockNavigation = useCallback((navigation: BlockedNavigation): void => {
    navigationRef.current = navigation;
    setAsking(true);
  }, []);
  useEffect(() => {
    if (open) return;
    dirtyRef.current = false;
    setDirty(false);
    setAsking(false);
  }, [open]);
  useEffect(() => {
    if (!open || !dirty) return;
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [open, dirty]);
  useEffect(() => {
    if (asking) keepRef.current?.focus();
  }, [asking]);
  const requestClose = useCallback((): void => {
    if (dirtyRef.current && dialogRef.current?.querySelector('button[type="submit"]:disabled')) return;
    if (dirtyRef.current) setAsking(true);
    else closeRef.current();
  }, []);
  function markChanged(): void {
    if (!protectChanges) return;
    dirtyRef.current = true;
    setDirty(true);
  }

  /*
   * Focus the sheet itself; reach for a field only when the sheet asks. On a phone, focusing an
   * input slides the keyboard up over the sheet the moment it opens, and typing is the point of
   * exactly one sheet.
   *
   * Never the close button, which is the first focusable thing in the header: a sheet that opens
   * with "Close" under the cursor is offering to undo itself.
   */
  useDialogFocus(dialogRef, open, requestClose, () =>
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
      onMouseDown={requestClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        onKeyDownCapture={advanceFormField}
        onChangeCapture={markChanged}
        onClickCapture={(event) => {
          if ((event.target as HTMLElement).closest('button[aria-pressed]')) markChanged();
        }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        className="sheet-dialog animate-sheet surface flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border-b-0 sm:mx-4 sm:max-w-lg sm:rounded-3xl sm:border-b"
      >
        <div className="sheet-header flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-display text-lg font-semibold tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            className="tap grid h-8 w-8 place-items-center rounded-full text-muted transition hover:bg-surface2 hover:text-ink"
          >
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="sheet-content overflow-y-auto px-5 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          {asking && (
            <section role="alert" className="mb-5 rounded-2xl border border-line-strong bg-surface2 p-4">
              <h3 className="font-semibold">Discard unsaved changes?</h3>
              <p className="mt-1 text-sm text-muted">These changes haven’t been saved to the group.</p>
              <div className="mt-3 flex flex-wrap gap-3">
                <button
                  ref={keepRef}
                  type="button"
                  className="btn-gradient rounded-full px-4 py-2 text-sm font-semibold"
                  onClick={() => {
                    navigationRef.current?.reset();
                    navigationRef.current = null;
                    setAsking(false);
                  }}
                >
                  Keep editing
                </button>
                <button
                  type="button"
                  className="rounded-full border border-line-strong px-4 py-2 text-sm font-medium"
                  onClick={() => {
                    if (navigationRef.current) navigationRef.current.proceed();
                    else closeRef.current();
                  }}
                >
                  Discard changes
                </button>
              </div>
            </section>
          )}
          <SheetNavigationGuard dirty={dirty} onBlocked={blockNavigation} />
          {children}
        </div>
      </div>
    </div>
  );
}
