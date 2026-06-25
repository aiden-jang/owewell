import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AuthLayout } from '../components/AuthLayout';
import { TextField } from '../components/TextField';
import { Button } from '../components/Button';

export function ForgotPasswordPage(): ReactNode {
  const { forgotPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    try {
      await forgotPassword(email);
    } catch {
      // We intentionally show the same confirmation either way.
    } finally {
      setSent(true);
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Forgot password"
      subtitle="We'll email you a link to set a new one."
      footer={
        <Link className="font-medium text-accent" to="/login">
          Back to log in
        </Link>
      }
    >
      {sent ? (
        <p className="text-sm text-muted">
          If an account uses that email, a reset link is on its way. Check your inbox.
        </p>
      ) : (
        <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
          <TextField
            label="Email"
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Sending...' : 'Send reset link'}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
