import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

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

  const settle = useCallback(
    (ok: boolean): void => {
      setPending((current) => {
        current?.resolve(ok);
        return null;
      });
    },
    [],
  );

  // Let Escape cancel and Enter confirm while the dialog is open.
  useEffect(() => {
    if (!pending) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') settle(false);
      if (event.key === 'Enter') settle(true);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, settle]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={pending.title}
          onClick={() => settle(false)}
        >
          <div
            className="w-full max-w-sm animate-rise rounded-3xl glass p-6 shadow-md"
            onClick={(e) => e.stopPropagation()}
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
              <ConfirmButton tone={pending.tone} onClick={() => settle(true)}>
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
}: {
  tone: 'danger' | 'default' | undefined;
  onClick: () => void;
  children: ReactNode;
}): ReactNode {
  const ref = useRef<HTMLButtonElement>(null);
  // Focus the confirm button when the dialog opens.
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const base = 'rounded-full px-4 py-2 text-sm font-semibold shadow-sm transition active:scale-[0.98]';
  const color =
    tone === 'danger'
      ? 'bg-rose-500 text-white hover:bg-rose-600'
      : 'btn-gradient hover:opacity-90';
  return (
    <button ref={ref} type="button" onClick={onClick} className={`${base} ${color}`}>
      {children}
    </button>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within a ConfirmProvider');
  return ctx;
}
