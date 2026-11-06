import { usePageAnalytics } from './usePageAnalytics.js';
import { pageForPath } from '../../../analytics/schema.js';
import { AppUpdate } from './AppUpdate';
import { lazy, Suspense, type ReactNode } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { ProtectedRoute } from './routes/ProtectedRoute';
import { QuickSplitPage } from './pages/QuickSplitPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SiteFooter } from './components/SiteFooter';
import { SkipLink } from './components/SkipLink';

const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })),
);
const GroupDetailPage = lazy(() =>
  import('./pages/GroupDetailPage').then((module) => ({ default: module.GroupDetailPage })),
);
const SharedGroupPage = lazy(() =>
  import('./pages/SharedGroupPage').then((module) => ({ default: module.SharedGroupPage })),
);

export function App(): ReactNode {
  const { pathname } = useLocation();
  usePageAnalytics(pageForPath(pathname), pathname);
  return (
    <div className="flex min-h-screen flex-col">
      {/* Before the routes, so it is before every page's sticky header in the tab order. */}
      <SkipLink />
      <div className="flex flex-1 flex-col">
        <Suspense
          fallback={
            <main id="main" tabIndex={-1} className="workspace-width mx-auto w-full px-4 py-8">
              <p className="text-sm text-muted" role="status">
                Opening page…
              </p>
            </main>
          }
        >
          <Routes>
            <Route path="/s/:token" element={<SharedGroupPage />} />
            <Route path="/split" element={<QuickSplitPage />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/groups/:id" element={<GroupDetailPage />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </div>
      <AppUpdate />
      <SiteFooter showCalculator={pathname === '/'} />
    </div>
  );
}
