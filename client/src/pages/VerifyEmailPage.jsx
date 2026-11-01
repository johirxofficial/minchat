import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, MailCheck, XCircle } from 'lucide-react';
import AuthShell from '../components/AuthShell';
import { Alert, Spinner } from '../components/ui';
import { endpoints } from '../lib/api';

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const [state, setState] = useState(token ? 'working' : 'missing');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) return undefined;
    let alive = true;
    endpoints
      .verifyEmail(token)
      .then(() => {
        if (alive) setState('done');
      })
      .catch((err) => {
        if (!alive) return;
        setState('error');
        setMessage(err.message);
      });
    return () => {
      alive = false;
    };
  }, [token]);

  return (
    <AuthShell
      title={state === 'done' ? 'Email confirmed' : 'Confirm your email'}
      subtitle={
        state === 'done'
          ? 'Thank you — account recovery is now available.'
          : 'One quick click keeps your account recoverable.'
      }
      footer={
        <p>
          <Link to="/login" className="text-link">Back to sign in</Link>
        </p>
      }
    >
      {state === 'working' ? (
        <div className="auth-success">
          <Spinner size={26} />
          <h3>Checking your link…</h3>
          <p>This only takes a moment.</p>
        </div>
      ) : null}

      {state === 'missing' ? (
        <Alert tone="error">
          This link does not include a verification token. Open the link from your email again, or
          request a fresh one in Settings → Security.
        </Alert>
      ) : null}

      {state === 'error' ? (
        <div className="auth-success">
          <span className="auth-success-icon is-error">
            <XCircle size={26} />
          </span>
          <h3>Link not accepted</h3>
          <p>{message || 'This verification link is invalid or has expired.'}</p>
          <Link to="/login" className="btn btn-primary btn-block">
            Go to sign in
          </Link>
        </div>
      ) : null}

      {state === 'done' ? (
        <div className="auth-success">
          <span className="auth-success-icon is-success">
            <CheckCircle2 size={26} />
          </span>
          <h3>You're verified</h3>
          <p>You can close this tab and keep using MinChat.</p>
          <Link to="/" className="btn btn-primary btn-block">
            <MailCheck size={17} /> Open MinChat
          </Link>
        </div>
      ) : null}
    </AuthShell>
  );
}
