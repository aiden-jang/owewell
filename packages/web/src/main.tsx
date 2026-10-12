import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import { ConfirmProvider } from './components/Confirm';
import './index.css';
import { initTheme } from './lib/theme';

// Before the first paint, or the wrong palette flashes.
initTheme();

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found');
}

const router = createBrowserRouter([{ path: '*', element: <App /> }]);

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <ConfirmProvider>
            <RouterProvider router={router} />
          </ConfirmProvider>
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  </StrictMode>,
);

// Register the service worker for installability + offline shell — production only. In dev a
// cache-first worker serves stale bundles, so instead we unregister any that's lingering.
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js', { updateViaCache: 'none' })
        .then((registration) => {
          const check = (): void => {
            if (document.visibilityState === 'visible' && navigator.onLine)
              void registration.update().catch(() => undefined);
          };
          document.addEventListener('visibilitychange', check);
          window.addEventListener('online', check);
        })
        .catch(() => {
          // Non-fatal: the app works fine without it.
        });
    });
  } else {
    void navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => void r.unregister()));
  }
}
