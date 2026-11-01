import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MailQuestion } from 'lucide-react';
import AuthShell from '../components/AuthShell';
import { Alert, Button, Field } from '../components/ui';
import { endpoints } from '../lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      await endpoints.forgot(email.trim().toLowerCase());
      setSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We'll email you a link that expires in 30 minutes."
      footer={
        <p>
          Remembered it? <Link to="/login" className="text-link">Back to sign in</Link>
        </p>
      }
    >
      {sent ? (
        <div className="auth-success">
          <span className="auth-success-icon">
            <MailQuestion size={26} />
          </span>
          <h3>Check your inbox</h3>
          <p>
            If <strong>{email}</strong> belongs to a MinChat account, a reset link is on its way. If
            SMTP is not configured on this deployment, the link is written to the server log instead.
          </p>
          <Button variant="secondary" className="btn-block" onClick={() => setSent(false)}>
            Use a different email
          </Button>
        </div>
      ) : (
        <form className="auth-form" onSubmit={onSubmit} noValidate>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Field label="Email" htmlFor="email">
            <input
              id="email"
              type="email"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
            />
          </Field>
          <Button type="submit" loading={loading} icon={MailQuestion} className="btn-block">
            Send reset link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
