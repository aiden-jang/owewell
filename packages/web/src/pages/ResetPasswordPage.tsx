import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AuthLayout } from '../components/AuthLayout';
import { TextField } from '../components/TextField';
import { Button } from '../components/Button';

export function ResetPasswordPage(): ReactNode {
  const { resetPassword } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate('/login'), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset your password.');
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout
        title="Reset password"
        subtitle="This link looks incomplete."
        footer={
          <Link className="font-medium text-accent" to="/forgot">
            Request a new link
          </Link>
        }
      >
        <p className="text-sm text-muted">No reset token found. Ask for a fresh link.</p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Set a new password"
      subtitle="Almost there."
      footer={
        <Link className="font-medium text-accent" to="/login">
          Back to log in
        </Link>
      }
    >
      {done ? (
        <p className="text-sm text-emerald-600">Password updated. Taking you to log in...</p>
      ) : (
        <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
          <TextField
            label="New password"
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && (
            <p className="text-sm font-medium text-accent" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving...' : 'Reset password'}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
