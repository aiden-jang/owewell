import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { AuthProvider, useAuth } from './AuthContext';

/**
 * The session, driven.
 *
 * Seventy lines that everything else sits on, and two of its rules are the silent kind:
 *
 *   1. `user.id` is the owewell PERSON id, not the auth service's user id. Every comparison in the
 *      app — isOwner, balances, "which one is me" — is against person ids, so getting this wrong
 *      does not throw anywhere. It just means nothing ever matches you.
 *   2. Sign-out returns to the origin; sign-in returns to where you were. Sending someone back to a
 *      group page they can no longer read is a redirect loop, not a courtesy.
 *
 * And one that is merely fatal: if `loading` never clears the whole app sits on a spinner, so the
 * failure path has to resolve it too.
 */

const get = vi.fn();
vi.mock('../lib/api', () => ({
  api: { get: (path: string) => get(path) },
  AUTH_ORIGIN: 'https://accounts.example.com',
}));

vi.mock('@aidenjang/auth-client', () => ({
  loginUrl: (origin: string, returnTo: string) => `${origin}/login?next=${encodeURIComponent(returnTo)}`,
  signupUrl: (origin: string, returnTo: string) => `${origin}/signup?next=${encodeURIComponent(returnTo)}`,
  logoutUrl: (origin: string, returnTo: string) => `${origin}/logout?next=${encodeURIComponent(returnTo)}`,
}));

const assign = vi.fn();
const realLocation = window.location;

function Probe(): ReactNode {
  const { user, loading, login, signup, logout, accountUrl } = useAuth();
  return (
    <div>
      <span data-testid="state">{loading ? 'loading' : (user?.id ?? 'signed-out')}</span>
      <span data-testid="account">{accountUrl}</span>
      <button onClick={() => login()}>login</button>
      <button onClick={() => signup()}>signup</button>
      <button onClick={() => logout()}>logout</button>
      <button onClick={() => login('https://owewell.example/s/tok?claim=u2')}>login-with-return</button>
    </div>
  );
}

async function mount() {
  const user = userEvent.setup();
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  return user;
}

const state = () => screen.getByTestId('state').textContent;

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      assign,
      href: 'https://owewell.example/groups/g1',
      origin: 'https://owewell.example',
    },
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
});

describe('who the session says you are', () => {
  /*
   * The remapping. Everything downstream compares against person ids, so handing back the auth
   * service's user id would leave every one of those comparisons quietly false.
   */
  it('reports the person id, not the auth service user id', async () => {
    get.mockResolvedValue({
      user: { id: 'auth-user-1', email: 'a@x.com', displayName: 'Aiden' },
      personId: 'person-9',
    });
    await mount();
    await waitFor(() => expect(state()).toBe('person-9'));
  });

  it('keeps the user id when there is no person id to swap in', async () => {
    get.mockResolvedValue({ user: { id: 'auth-user-1', email: 'a@x.com', displayName: 'Aiden' } });
    await mount();
    await waitFor(() => expect(state()).toBe('auth-user-1'));
  });

  it('asks the app’s own origin, not the auth service, who you are', async () => {
    get.mockResolvedValue({ user: null });
    await mount();
    await waitFor(() => expect(get).toHaveBeenCalledWith('/me'));
  });

  it('is signed out when nobody is signed in', async () => {
    get.mockResolvedValue({ user: null });
    await mount();
    await waitFor(() => expect(state()).toBe('signed-out'));
  });

  /*
   * The whole app renders a spinner while `loading` is true, so a rejected /me that never resolved
   * it would be indistinguishable from an app that had hung.
   */
  it('stops loading even when the check fails', async () => {
    get.mockRejectedValue(new Error('offline'));
    await mount();
    expect(state()).toBe('loading');
    await waitFor(() => expect(state()).toBe('signed-out'));
  });
});

describe('where each redirect sends you', () => {
  beforeEach(() => get.mockResolvedValue({ user: null }));

  it.each([
    ['login', '/login'],
    ['signup', '/signup'],
  ])('%s comes back to the page you were on', async (button, path) => {
    const user = await mount();
    await waitFor(() => expect(state()).toBe('signed-out'));
    await user.click(screen.getByRole('button', { name: button }));
    expect(assign).toHaveBeenCalledWith(
      `https://accounts.example.com${path}?next=${encodeURIComponent('https://owewell.example/groups/g1')}`,
    );
  });

  /*
   * Sign-out is the exception: back to the origin, not to the page. Returning a signed-out visitor
   * to a group they can no longer read would bounce them straight back to sign-in.
   */
  it('logout comes back to the front door instead', async () => {
    const user = await mount();
    await waitFor(() => expect(state()).toBe('signed-out'));
    await user.click(screen.getByRole('button', { name: 'logout' }));
    expect(assign).toHaveBeenCalledWith(
      `https://accounts.example.com/logout?next=${encodeURIComponent('https://owewell.example')}`,
    );
  });

  // The share page uses this to carry a seat id through sign-in and finish the claim on the way back.
  it('honours an explicit destination', async () => {
    const user = await mount();
    await waitFor(() => expect(state()).toBe('signed-out'));
    await user.click(screen.getByRole('button', { name: 'login-with-return' }));
    expect(assign).toHaveBeenCalledWith(
      `https://accounts.example.com/login?next=${encodeURIComponent('https://owewell.example/s/tok?claim=u2')}`,
    );
  });

  it('points at the shared account page', async () => {
    await mount();
    expect(screen.getByTestId('account')).toHaveTextContent('https://accounts.example.com/account');
  });
});

describe('using it wrongly', () => {
  // Cheaper to fail here than to debug a component that silently sees no session.
  it('refuses to work outside a provider', () => {
    const Bare = (): ReactNode => {
      useAuth();
      return null;
    };
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Bare />)).toThrow(/within an AuthProvider/);
    quiet.mockRestore();
  });
});
