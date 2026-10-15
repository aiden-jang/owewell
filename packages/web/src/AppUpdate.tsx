import { useEffect, useState } from 'react';

export function AppUpdate({ safe = true }: { safe?: boolean }) {
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const current = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src;
    if (!current) return;
    const controller = new AbortController();
    let checking = false;
    let checkedAt = 0;
    const check = async () => {
      if (document.hidden || !navigator.onLine || checking || Date.now() - checkedAt < 60_000) return;
      checkedAt = Date.now();
      checking = true;
      try {
        const response = await fetch('/', {
          cache: 'no-store',
          signal: controller.signal,
          headers: { Accept: 'text/html' },
        });
        if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) return;
        const next = new DOMParser()
          .parseFromString(await response.text(), 'text/html')
          .querySelector('script[type="module"][src]')
          ?.getAttribute('src');
        if (
          next &&
          new URL(next, location.origin).origin === location.origin &&
          new URL(next, location.origin).href !== current &&
          !controller.signal.aborted
        )
          setAvailable(true);
      } catch {
        // Update discovery must never interrupt offline work or an active session.
      } finally {
        checking = false;
      }
    };
    window.addEventListener('focus', check);
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', check);
    return () => {
      controller.abort();
      window.removeEventListener('focus', check);
      window.removeEventListener('online', check);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  if (!safe || !available || dismissed) return null;
  return (
    <aside
      aria-label="App update"
      role="status"
      style={{
        position: 'fixed',
        bottom: 'max(16px, env(safe-area-inset-bottom))',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        boxSizing: 'border-box',
        width: 'min(440px, calc(100% - 24px))',
        padding: 16,
        borderRadius: 16,
        background: '#fffaf1',
        color: '#183b38',
        boxShadow: '0 6px 32px #0004',
        fontFamily: 'inherit',
        fontSize: 14,
        overflowWrap: 'anywhere',
      }}
    >
      <p style={{ margin: 0, fontWeight: 600 }}>An update is ready.</p>
      <p style={{ margin: '6px 0 10px' }}>
        Save your changes before reloading. This page stays open until you choose.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            minHeight: 44,
            padding: '8px 16px',
            borderRadius: 10,
            border: '1px solid currentColor',
            color: 'inherit',
            background: 'transparent',
            font: 'inherit',
            cursor: 'pointer',
          }}
        >
          Reload app
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          style={{
            minHeight: 44,
            padding: '8px 16px',
            border: 0,
            color: 'inherit',
            background: 'transparent',
            font: 'inherit',
            cursor: 'pointer',
          }}
        >
          Later
        </button>
      </div>
    </aside>
  );
}
