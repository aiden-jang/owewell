import {
  createContext,
  useCallback,
  useContext,
  useId,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import { useDialogFocus } from '../lib/useDialogFocus';

interface ConfirmOptions {
  title: string;
  body?: string;
  details?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onDismiss?: () => void;
  signal?: AbortSignal;
  /** 'danger' paints the confirm button in the accent color for destructive actions. */
  tone?: 'danger' | 'default';
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
  detach: () => void;
}

/** A promise-based replacement for window.confirm, themed to match the app. */
export function ConfirmProvider({ children }: { children: ReactNode }): ReactNode {
  const [pending, setPending] = useState<Pending | null>(null);
  const active = useRef<Pending | null>(null);

  const settle = useCallback((ok: boolean, dismissed = false): void => {
    const current = active.current;
    active.current = null;
    current?.detach();
    setPending(null);
    if (dismissed) current?.onDismiss?.();
    current?.resolve(ok);
  }, []);

  const confirm = useCallback<ConfirmFn>(
    (options) => {
      if (options.signal?.aborted) return Promise.resolve(false);
      if (active.current) {
        options.onDismiss?.();
        return Promise.resolve(false);
      }
      return new Promise<boolean>((resolve) => {
        const abort = () => settle(false);
        active.current = {
          ...options,
          resolve,
          detach: () => options.signal?.removeEventListener('abort', abort),
        };
        options.signal?.addEventListener('abort', abort, { once: true });
        setPending(active.current);
      });
    },
    [settle],
  );

  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const bodyId = useId();

  const dismiss = useCallback(() => settle(false, true), [settle]);
  useDialogFocus(dialogRef, pending !== null, dismiss, () =>
    pending?.onDismiss ? null : pending?.tone === 'danger' ? cancelRef.current : confirmRef.current,
  );

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div
          className={`animate-fade fixed inset-0 flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-4 ${pending.details ? 'z-60' : 'z-50'}`}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) dismiss();
          }}
        >
          {/* The dialog is the panel, not the backdrop: a trap that includes the backdrop would
              have nothing to trap against, and aria-modal belongs on the thing being modal. */}
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={pending.title}
            aria-describedby={pending.body ? bodyId : undefined}
            tabIndex={-1}
            /* Fade in without moving the answer while somebody is trying to press it. */
            className={`animate-fade surface max-h-[92dvh] w-full overflow-y-auto overscroll-contain rounded-t-3xl p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-xl shadow-black/40 sm:rounded-3xl sm:pb-6 ${pending.details ? 'sm:max-w-xl' : 'sm:max-w-sm'}`}
          >
            <h2 className="break-words font-display text-xl font-semibold tracking-tight">{pending.title}</h2>
            {pending.body && (
              <p id={bodyId} className="mt-2 text-sm text-muted">
                {pending.body}
              </p>
            )}
            {pending.details}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              {pending.onDismiss && (
                <button
                  type="button"
                  onClick={dismiss}
                  className="tap px-3 py-2 text-sm font-medium text-muted hover:underline"
                >
                  Decide later
                </button>
              )}
              <button
                ref={cancelRef}
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
