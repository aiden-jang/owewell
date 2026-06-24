import type { ReactNode } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';

export function ProtectedRoute(): ReactNode {
  const { user } = useAuth();
  if (!user) {
    // Login is optional: send signed-out visitors to the quick-split calculator.
    return <Navigate to="/split" replace />;
  }
  return <Outlet />;
}
