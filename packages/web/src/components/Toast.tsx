import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Icon } from './Icon';

type ToastTone = 'success' | 'error';

/** One thing the toast lets you do about what just happened. Undo is the only user so far. */
interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  action?: ToastAction;
}

interface ToastApi {
  success: (message: string, action?: ToastAction) => void;
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
    (message: string, tone: ToastTone, action?: ToastAction): void => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, message, tone, ...(action ? { action } : {}) }]);
      // Errors linger longer than confirmations — you have to actually read them. One with an action
      // linger longest: four seconds is enough to read "deleted", not to notice it was the wrong row,
      // decide, and reach for the button.
      setTimeout(() => dismiss(id), action ? 9000 : tone === 'error' ? 7000 : 4000);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message, action) => push(message, 'success', action),
      error: (message) => push(message, 'error'),
    }),
    [push],
  );

  const shell = (tone: ToastTone): string =>
    `toast pointer-events-auto inline-flex max-w-sm items-center gap-2 animate-rise rounded-full px-4 py-2.5 text-sm font-medium ${
      tone === 'error' ? 'text-rose-300' : 'text-ink'
    }`;

  /*
   * Non-colour cue so tone reads without relying on colour alone.
   *
   * Drawn rather than ⚠️ and ✓: the warning was a full-colour emoji, so the one element in the app
   * that has to read instantly was also the one drawn differently on every platform — and at 14px
   * a platform emoji is a smudge. These inherit the toast's own text colour.
   */
  const glyph = (tone: ToastTone): ReactNode => (
    <Icon name={tone === 'error' ? 'alert' : 'check'} size={14} className="shrink-0" />
  );

  const renderToast = (toast: Toast): ReactNode =>
    toast.action ? (
      // A div, not a button: the whole-toast tap dismisses, and a button inside a button is invalid
      // markup that also swallows the action's own click on some browsers.
      <div key={toast.id} className={shell(toast.tone)}>
        {glyph(toast.tone)}
        <span>{toast.message}</span>
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick();
            dismiss(toast.id);
          }}
          className="-mr-1.5 ml-1 rounded-full px-2.5 py-1 font-semibold text-accent transition hover:bg-surface2"
        >
          {toast.action.label}
        </button>
      </div>
    ) : (
      <button
        key={toast.id}
        type="button"
        onClick={() => dismiss(toast.id)}
        className={`${shell(toast.tone)} transition active:scale-[0.98]`}
      >
        {glyph(toast.tone)}
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
