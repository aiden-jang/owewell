import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { invitesApi, type InviteInfo } from '../lib/invites';

function Card({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 flex items-center justify-center gap-2 font-display text-3xl font-semibold tracking-tight">
          <span aria-hidden>🧾</span> Owe Well
        </h1>
        <div className="rounded-3xl glass p-7 text-center shadow-sm">{children}</div>
      </div>
    </div>
  );
}

export function InvitePage(): ReactNode {
  const { token = '' } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    invitesApi
      .info(token)
      .then(setInfo)
      .catch(() => setLoadFailed(true));
  }, [token]);

  async function join(): Promise<void> {
    setJoining(true);
    setError(null);
    try {
      const groupId = await invitesApi.accept(token);
      navigate(`/groups/${groupId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join.');
      setJoining(false);
    }
  }

  if (loadFailed) {
    return (
      <Card>
        <p className="text-lg font-medium">This invite link is not valid.</p>
        <Link to="/" className="mt-3 inline-block text-sm font-medium text-accent">
          Go home
        </Link>
      </Card>
    );
  }

  if (!info) {
    return (
      <Card>
        <p className="text-muted">One sec...</p>
      </Card>
    );
  }

  if (info.status !== 'pending') {
    return (
      <Card>
        <p className="text-lg font-medium">
          {info.status === 'accepted'
            ? 'This invite has already been used.'
            : 'This invite has expired.'}
        </p>
        <Link to="/" className="mt-3 inline-block text-sm font-medium text-accent">
          Go home
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      <p className="text-sm text-muted">You&apos;re invited to</p>
      <h2 className="mt-1 font-display text-2xl font-semibold">{info.groupName}</h2>

      {user ? (
        <>
          <button
            type="button"
            disabled={joining}
            onClick={() => void join()}
            className="mt-5 w-full rounded-xl btn-gradient px-4 py-2.5 font-medium transition disabled:opacity-60"
          >
            {joining ? 'Joining...' : 'Join the group'}
          </button>
          {error && <p className="mt-2 text-sm font-medium text-accent">{error}</p>}
        </>
      ) : (
        <>
          <p className="mt-4 text-sm text-muted">Log in or make an account, then open this link again to join.</p>
          <div className="mt-4 flex justify-center gap-3">
            <Link to="/login" className="font-medium text-accent">
              Log in
            </Link>
            <Link to="/signup" className="font-medium text-accent">
              Sign up
            </Link>
          </div>
        </>
      )}
    </Card>
  );
}
