import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { ProtectedRoute } from './ProtectedRoute';

const retry = vi.fn();
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: null, sessionError: true, retrySession: retry }),
}));

it('offers a session retry without redirecting, and keeps the public calculator reachable', async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={['/groups/g1']}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/groups/:id" element={<p>Group</p>} />
        </Route>
        <Route path="/split" element={<p>Public calculator</p>} />
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading', { level: 1, name: 'Couldn’t check your sign-in.' })).toBeVisible();
  expect(screen.queryByText('Public calculator')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledOnce();
  await user.click(screen.getByRole('link', { name: 'Use quick split without an account' }));
  expect(screen.getByText('Public calculator')).toBeVisible();
});
