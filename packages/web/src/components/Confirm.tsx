import { createContext, useCallback, useContext, useRef, useState, type ReactNode, type Ref } from 'react';
import { useDialogFocus } from '../lib/useDialogFocus';

interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' paints the confirm button in the accent color for destructive actions. */
  tone?: 'danger' | 'default';
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

/** A promise-based replacement for window.confirm, themed to match the app. */
export function ConfirmProvider({ children }: { children: ReactNode }): ReactNode {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (options) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  );

  const settle = useCallback((ok: boolean): void => {
    setPending((current) => {
      current?.resolve(ok);
      return null;
    });
  }, []);

  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Trap focus and restore it to the trigger; confirmations initially focus their primary action.
  const cancel = useCallback(() => settle(false), [settle]);
  useDialogFocus(dialogRef, pending !== null, cancel, () => confirmRef.current);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div
          className="animate-fade fixed inset-0 z-50 flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-4"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) settle(false);
          }}
        >
          {/* The dialog is the panel, not the backdrop: a trap that includes the backdrop would
              have nothing to trap against, and aria-modal belongs on the thing being modal. */}
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={pending.title}
            tabIndex={-1}
            /* Fade in without moving the answer while somebody is trying to press it. */
            className="animate-fade surface w-full rounded-t-3xl p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-xl shadow-black/40 sm:max-w-sm sm:rounded-3xl sm:pb-6"
          >
            <h2 className="font-display text-xl font-semibold tracking-tight">{pending.title}</h2>
            {pending.body && <p className="mt-2 text-sm text-muted">{pending.body}</p>}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => settle(false)}
                className="rounded-full border border-line px-4 py-2 text-sm font-medium transition hover:bg-canvas active:scale-[0.98]"
              >
                {pending.cancelLabel ?? 'Cancel'}
              </button>
              <ConfirmButton buttonRef={confirmRef} tone={pending.tone} onClick={() => settle(true)}>
                {pending.confirmLabel ?? 'Confirm'}
              </ConfirmButton>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

function ConfirmButton({
  tone,
  onClick,
  children,
  buttonRef,
}: {
  tone: 'danger' | 'default' | undefined;
  onClick: () => void;
  children: ReactNode;
  /** Handed up so the dialog can open with the answer under the cursor. Not named `ref`: on a
   *  React 18 function component that is a reserved prop and arrives as undefined. */
  buttonRef: Ref<HTMLButtonElement>;
}): ReactNode {
  const base = 'rounded-full px-4 py-2 text-sm font-semibold shadow-sm transition active:scale-[0.98]';
  const color =
    tone === 'danger' ? 'bg-neg-solid text-white hover:brightness-110' : 'btn-gradient hover:opacity-90';
  return (
    <button ref={buttonRef} type="button" onClick={onClick} className={`${base} ${color}`}>
      {children}
    </button>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider');
  return ctx;
}
