import { usePageAnalytics } from './usePageAnalytics.js';
import { pageForPath } from '../../../analytics/schema.js';
import { AppUpdate } from './AppUpdate';
import type { ReactNode } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { ProtectedRoute } from './routes/ProtectedRoute';
import { DashboardPage } from './pages/DashboardPage';
import { GroupDetailPage } from './pages/GroupDetailPage';
import { QuickSplitPage } from './pages/QuickSplitPage';
import { SharedGroupPage } from './pages/SharedGroupPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SiteFooter } from './components/SiteFooter';
import { SkipLink } from './components/SkipLink';

export function App(): ReactNode {
  const { pathname } = useLocation();
  usePageAnalytics(pageForPath(pathname), pathname);
  return (
    <div className="flex min-h-screen flex-col">
      {/* Before the routes, so it is before every page's sticky header in the tab order. */}
      <SkipLink />
      <div className="flex flex-1 flex-col">
        <Routes>
          <Route path="/s/:token" element={<SharedGroupPage />} />
          <Route path="/split" element={<QuickSplitPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/groups/:id" element={<GroupDetailPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </div>
      <AppUpdate />
      <SiteFooter />
    </div>
  );
}
