import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, LogIn, MailCheck } from 'lucide-react';
import AuthShell from '../components/AuthShell';
import { Alert, Button, Field } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { endpoints } from '../lib/api';
import { useToast } from '../context/ToastContext';

export default function LoginPage() {
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [needsVerification, setNeedsVerification] = useState(false);
  const [resending, setResending] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event) {
    event.preventDefault();
    setError('');
    setNeedsVerification(false);
    setLoading(true);
    try {
      await login(identifier.trim(), password);
      const target = location.state?.from || '/';
      navigate(target, { replace: true });
    } catch (err) {
      setError(err.message);
      setNeedsVerification(err.code === 'EMAIL_NOT_VERIFIED');
      if (err.code === 'MAINTENANCE') setError('MinChat is briefly in maintenance. Please try again soon.');
    } finally {
      setLoading(false);
    }
  }

  async function resendLink() {
    if (!identifier.includes('@')) {
      toast.error('Enter the email address on your account first');
      return;
    }
    setResending(true);
    try {
      const res = await endpoints.resendVerificationLink(identifier.trim().toLowerCase());
      toast.success(res.message || 'Verification link sent');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setResending(false);
    }
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to pick up where you left off."
      footer={
        <p>
          New to MinChat? <Link to="/register" className="text-link">Create an account</Link>
        </p>
      }
    >
      <form className="auth-form" onSubmit={onSubmit} noValidate>
        {error ? <Alert tone="error">{error}</Alert> : null}
        {needsVerification ? (
          <Alert tone="info">
            <p style={{ margin: '0 0 8px' }}>Check your inbox for the confirmation link.</p>
            <Button size="sm" variant="secondary" icon={MailCheck} onClick={resendLink} loading={resending}>
              Resend link
            </Button>
          </Alert>
        ) : null}

        <Field label="Username, email or phone" htmlFor="identifier">
          <input
            id="identifier"
            name="identifier"
            autoComplete="username"
            autoFocus
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            placeholder="you@example.com"
            required
          />
        </Field>

        <Field label="Password" htmlFor="password">
          <div className="input-with-action">
            <input
              id="password"
              name="password"
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Your password"
              required
            />
            <button
              type="button"
              className="input-action"
              onClick={() => setShow((value) => !value)}
              aria-label={show ? 'Hide password' : 'Show password'}
            >
              {show ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
        </Field>

        <div className="auth-inline">
          <Link to="/forgot-password" className="text-link">
            Forgot your password?
          </Link>
        </div>

        <Button type="submit" loading={loading} icon={LogIn} className="btn-block">
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}
