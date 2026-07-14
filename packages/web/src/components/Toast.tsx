import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type ToastTone = 'success' | 'error';

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Toasts: small, auto-dismissing status messages. Wrap the app once, then call useToast(). */
export function ToastProvider({ children }: { children: ReactNode }): ReactNode {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number): void => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (message: string, tone: ToastTone): void => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, message, tone }]);
      // Errors linger longer than confirmations — you have to actually read them.
      setTimeout(() => dismiss(id), tone === 'error' ? 7000 : 4000);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => push(message, 'success'),
      error: (message) => push(message, 'error'),
    }),
    [push],
  );

  const renderToast = (toast: Toast): ReactNode => (
    <button
      key={toast.id}
      type="button"
      onClick={() => dismiss(toast.id)}
      className={`glass pointer-events-auto inline-flex max-w-sm items-center gap-2 animate-rise rounded-full px-4 py-2.5 text-sm font-medium shadow-md transition active:scale-[0.98] ${
        toast.tone === 'error' ? 'text-rose-300' : 'text-ink'
      }`}
    >
      {/* Non-color cue so tone reads without relying on color alone. */}
      <span aria-hidden="true">{toast.tone === 'error' ? '⚠️' : '✓'}</span>
      {toast.message}
    </button>
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Two persistent live regions: errors are announced assertively (you need to act on them),
          successes politely. Persistent (always mounted) regions announce more reliably than ones
          that appear only when a toast does. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 px-4 pt-4 pb-4 max-sm:pb-[calc(6rem+env(safe-area-inset-bottom))]">
        <div className="flex flex-col items-center gap-2" role="alert" aria-live="assertive">
          {toasts.filter((t) => t.tone === 'error').map(renderToast)}
        </div>
        <div className="flex flex-col items-center gap-2" role="status" aria-live="polite">
          {toasts.filter((t) => t.tone !== 'error').map(renderToast)}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
