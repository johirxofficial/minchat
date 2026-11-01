import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, MailCheck, UserPlus } from 'lucide-react';
import AuthShell from '../components/AuthShell';
import { Alert, Button, Field } from '../components/ui';
import { useAuth } from '../context/AuthContext';

function strengthOf(password) {
  let score = 0;
  if (password.length >= 10) score += 1;
  if (password.length >= 14) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;
  return Math.min(4, score);
}

const LABELS = ['Too short', 'Getting there', 'Decent', 'Strong', 'Excellent'];

export default function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    displayName: '',
    username: '',
    email: '',
    password: '',
    confirm: ''
  });
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [pendingEmail, setPendingEmail] = useState('');

  const strength = useMemo(() => strengthOf(form.password), [form.password]);

  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  async function onSubmit(event) {
    event.preventDefault();
    setError('');
    setFieldErrors({});
    if (form.password !== form.confirm) {
      setFieldErrors({ confirm: 'Passwords do not match' });
      return;
    }
    setLoading(true);
    try {
      const result = await register({
        displayName: form.displayName.trim(),
        username: form.username.trim().toLowerCase(),
        email: form.email.trim().toLowerCase(),
        password: form.password
      });
      if (result?.verificationRequired) {
        setPendingEmail(result.email || form.email.trim().toLowerCase());
      } else {
        navigate('/', { replace: true });
      }
    } catch (err) {
      setError(err.message);
      if (err.details) setFieldErrors(err.details);
    } finally {
      setLoading(false);
    }
  }

  if (pendingEmail) {
    return (
      <AuthShell
        title="Check your inbox"
        subtitle="One more step to finish creating your account."
        footer={
          <p>
            Already confirmed? <Link to="/login" className="text-link">Sign in</Link>
          </p>
        }
      >
        <div className="auth-success">
          <span className="auth-success-icon is-success">
            <MailCheck size={26} />
          </span>
          <h3>Verify {pendingEmail}</h3>
          <p>
            We sent a confirmation link to your address. Open it to activate sign-in, then come back
            here. The link expires in 24 hours.
          </p>
          <Link to="/login" className="btn btn-primary btn-block">
            Back to sign in
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="A username, an email, and you're in."
      footer={
        <p>
          Already have an account? <Link to="/login" className="text-link">Sign in</Link>
        </p>
      }
    >
      <form className="auth-form" onSubmit={onSubmit} noValidate>
        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="auth-grid">
          <Field label="Display name" htmlFor="displayName" error={fieldErrors.displayName}>
            <input
              id="displayName"
              autoComplete="name"
              autoFocus
              maxLength={60}
              value={form.displayName}
              onChange={(event) => update('displayName', event.target.value)}
              placeholder="Maya Rahman"
              required
            />
          </Field>

          <Field
            label="Username"
            htmlFor="username"
            error={fieldErrors.username}
            hint="Lowercase letters, numbers and underscores."
          >
            <input
              id="username"
              autoComplete="username"
              value={form.username}
              onChange={(event) => update('username', event.target.value.toLowerCase())}
              placeholder="maya"
              pattern="[a-z0-9_]{3,30}"
              required
            />
          </Field>
        </div>

        <Field label="Email" htmlFor="email" error={fieldErrors.email}>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(event) => update('email', event.target.value)}
            placeholder="you@example.com"
            required
          />
        </Field>

        <Field label="Password" htmlFor="password" error={fieldErrors.password}>
          <div className="input-with-action">
            <input
              id="password"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              value={form.password}
              onChange={(event) => update('password', event.target.value)}
              placeholder="At least 10 characters"
              minLength={10}
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
          {form.password ? (
            <span className="strength" data-strength={strength}>
              <span className="strength-bars">
                {[0, 1, 2, 3].map((index) => (
                  <i key={index} className={index < strength ? 'is-on' : ''} />
                ))}
              </span>
              <span className="strength-label">{LABELS[strength]}</span>
            </span>
          ) : null}
        </Field>

        <Field label="Confirm password" htmlFor="confirm" error={fieldErrors.confirm}>
          <input
            id="confirm"
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            value={form.confirm}
            onChange={(event) => update('confirm', event.target.value)}
            placeholder="Repeat your password"
            required
          />
        </Field>

        <Button type="submit" loading={loading} icon={UserPlus} className="btn-block">
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
