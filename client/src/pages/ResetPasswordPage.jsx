import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { KeyRound, CheckCircle2 } from 'lucide-react';
import AuthShell from '../components/AuthShell';
import { Alert, Button, Field } from '../components/ui';
import { endpoints } from '../lib/api';

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await endpoints.reset(token, password);
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <AuthShell title="Reset link missing" subtitle="That link looks incomplete.">
        <Alert tone="error">This reset link does not include a token. Request a new one.</Alert>
        <Link to="/forgot-password" className="btn btn-primary btn-block" style={{ marginTop: 16 }}>
          Request a new link
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title={done ? 'Password updated' : 'Choose a new password'}
      subtitle={done ? 'You can sign in with your new password now.' : 'Use at least 10 characters.'}
      footer={
        <p>
          <Link to="/login" className="text-link">Back to sign in</Link>
        </p>
      }
    >
      {done ? (
        <div className="auth-success">
          <span className="auth-success-icon is-success">
            <CheckCircle2 size={26} />
          </span>
          <h3>You're all set</h3>
          <p>Your password was changed and all other sessions were signed out.</p>
          <Link to="/login" className="btn btn-primary btn-block">
            Sign in
          </Link>
        </div>
      ) : (
        <form className="auth-form" onSubmit={onSubmit} noValidate>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Field label="New password" htmlFor="password">
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              autoFocus
              minLength={10}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 10 characters"
              required
            />
          </Field>
          <Field label="Confirm new password" htmlFor="confirm">
            <input
              id="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              required
            />
          </Field>
          <Button type="submit" loading={loading} icon={KeyRound} className="btn-block">
            Set new password
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
