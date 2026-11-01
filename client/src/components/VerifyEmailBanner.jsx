import { useState } from 'react';
import { MailCheck, X } from 'lucide-react';
import { endpoints } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

/**
 * Gentle prompt for accounts that have not confirmed their address. It is
 * informational only — chat, calls and every other feature keep working.
 */
export default function VerifyEmailBanner() {
  const { user } = useAuth();
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const [hidden, setHidden] = useState(false);

  if (!user || user.emailVerifiedAt || hidden) return null;

  async function resend() {
    setSending(true);
    try {
      const result = await endpoints.resendVerification();
      toast.success(
        result.alreadyVerified ? 'Your email is already verified' : 'Verification email sent — check your inbox'
      );
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="verify-banner" role="status">
      <MailCheck size={17} />
      <div>
        <strong>Confirm your email address</strong>
        <p>It keeps account recovery working. You can keep chatting in the meantime.</p>
      </div>
      <button type="button" className="btn btn-secondary btn-sm" onClick={resend} disabled={sending}>
        {sending ? 'Sending…' : 'Resend link'}
      </button>
      <button
        type="button"
        className="notice-dismiss"
        onClick={() => setHidden(true)}
        aria-label="Hide this reminder"
      >
        <X size={15} />
      </button>
    </div>
  );
}
