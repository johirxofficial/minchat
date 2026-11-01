import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Bell,
  Camera,
  Check,
  CheckCircle2,
  KeyRound,
  Laptop,
  Lock,
  LogOut,
  MailCheck,
  Monitor,
  Phone,
  RefreshCw,
  Save,
  ShieldCheck,
  Smartphone,
  Trash2,
  UserRound,
  X
} from 'lucide-react';
import {
  Alert,
  Avatar,
  Button,
  ConfirmDialog,
  Field,
  IconButton,
  PageLoader,
  Spinner,
  Switch
} from '../components/ui';
import { endpoints } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { fullDate, timeAgo } from '../lib/utils';

const SECTIONS = [
  { id: 'profile', label: 'Profile', icon: UserRound },
  { id: 'privacy', label: 'Privacy', icon: Lock },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'security', label: 'Security', icon: KeyRound },
  { id: 'sessions', label: 'Sessions', icon: Laptop },
  { id: 'danger', label: 'Danger zone', icon: Trash2 }
];

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export default function SettingsPage() {
  const { section } = useParams();
  const { me, user, loading, setMe, updateLocal, refresh } = useAuth();
  const navigate = useNavigate();
  const active = SECTIONS.some((s) => s.id === section) ? section : 'profile';

  useEffect(() => {
    if (!section) navigate('/settings/profile', { replace: true });
    else if (!SECTIONS.some((s) => s.id === section)) navigate('/settings/profile', { replace: true });
  }, [section, navigate]);

  if (loading && !me) return <PageLoader label="Loading settings…" />;
  if (!me) return null;

  return (
    <div className="page settings-page">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Shape how MinChat looks, feels, and protects you.</p>
        </div>
      </header>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={active === item.id ? 'is-active' : ''}
                onClick={() => navigate(`/settings/${item.id}`)}
              >
                <Icon size={17} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="settings-panel">
          {active === 'profile' ? <ProfileSection me={me} setMe={setMe} updateLocal={updateLocal} refresh={refresh} /> : null}
          {active === 'privacy' ? <PrivacySection me={me} setMe={setMe} /> : null}
          {active === 'notifications' ? <NotificationsSection me={me} setMe={setMe} updateLocal={updateLocal} /> : null}
          {active === 'security' ? <SecuritySection user={user} setMe={setMe} /> : null}
          {active === 'sessions' ? <SessionsSection /> : null}
          {active === 'danger' ? <DangerSection me={me} setMe={setMe} /> : null}
        </div>
      </div>
    </div>
  );
}

function SectionHead({ title, description }) {
  return (
    <div className="settings-section-head">
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

function ProfileSection({ me, setMe, updateLocal, refresh }) {
  const toast = useToast();
  const [displayName, setDisplayName] = useState(me.user.displayName || '');
  const [username, setUsername] = useState(me.user.username || '');
  const [bio, setBio] = useState(me.user.bio || '');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [removeOpen, setRemoveOpen] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    setDisplayName(me.user.displayName || '');
    setUsername(me.user.username || '');
    setBio(me.user.bio || '');
  }, [me.user.displayName, me.user.username, me.user.bio]);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const data = await endpoints.updateProfile({
        displayName: displayName.trim(),
        username: username.trim().toLowerCase(),
        bio: bio.trim()
      });
      setMe(data);
      toast.success('Profile updated');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function uploadAvatar(file) {
    if (!file) return;
    setUploading(true);
    setProgress(0);
    try {
      const data = await endpoints.uploadAvatar(file, setProgress);
      updateLocal((current) =>
        current ? { ...current, user: { ...current.user, avatarUrl: data.avatarUrl } } : current
      );
      refresh().catch(() => {});
      toast.success('Profile photo updated');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

  async function removeAvatar() {
    try {
      await endpoints.removeAvatar();
      updateLocal((current) =>
        current ? { ...current, user: { ...current.user, avatarUrl: null } } : current
      );
      setRemoveOpen(false);
      toast.success('Profile photo removed');
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div className="settings-section">
      <SectionHead title="Profile" description="How you appear to friends and people who find you." />

      <div className="avatar-editor">
        <div className="avatar-editor-photo">
          <Avatar name={me.user.displayName} src={me.user.avatarUrl} size={92} />
          {uploading ? <span className="avatar-editor-progress">{progress}%</span> : null}
        </div>
        <div className="avatar-editor-actions">
          <Button size="sm" variant="secondary" icon={Camera} onClick={() => fileRef.current?.click()} loading={uploading}>
            Change photo
          </Button>
          {me.user.avatarUrl ? (
            <Button size="sm" variant="ghost" icon={X} onClick={() => setRemoveOpen(true)}>
              Remove
            </Button>
          ) : null}
          <p>JPEG, PNG, WebP or GIF, up to 8 MB.</p>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={(event) => {
              uploadAvatar(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </div>
      </div>

      <form className="settings-form" onSubmit={save}>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="settings-grid">
          <Field label="Display name">
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={60} />
          </Field>
          <Field label="Username" hint="Friends can find you with @username.">
            <input value={username} onChange={(event) => setUsername(event.target.value.toLowerCase())} maxLength={30} />
          </Field>
        </div>
        <Field label="Bio" optional hint={`${bio.length}/300 characters`}>
          <textarea value={bio} onChange={(event) => setBio(event.target.value.slice(0, 300))} rows={3} placeholder="A sentence about you." />
        </Field>
        <dl className="settings-facts">
          <div>
            <dt>Email</dt>
            <dd>{me.user.email}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd>{me.user.role === 'admin' ? 'Administrator' : 'Member'}</dd>
          </div>
          <div>
            <dt>Joined</dt>
            <dd>{fullDate(me.user.createdAt)}</dd>
          </div>
        </dl>
        <div className="settings-actions">
          <Button type="submit" icon={Save} loading={saving}>
            Save changes
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={removeOpen}
        onClose={() => setRemoveOpen(false)}
        onConfirm={removeAvatar}
        title="Remove your profile photo?"
        description="Your initials will be shown instead. You can upload a new photo anytime."
        confirmLabel="Remove photo"
      />
    </div>
  );
}

function PrivacySection({ me, setMe }) {
  const toast = useToast();
  const [form, setForm] = useState(me.user.settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => setForm(me.user.settings), [me.user.settings]);

  function set(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const data = await endpoints.updateSettings({
        visibility: form.visibility,
        bioVisibility: form.bioVisibility,
        avatarVisibility: form.avatarVisibility,
        showLastActive: form.showLastActive,
        showOnlineStatus: form.showOnlineStatus,
        friendRequestPolicy: form.friendRequestPolicy,
        contactPolicy: form.contactPolicy,
        discoverable: form.discoverable
      });
      setMe(data);
      toast.success('Privacy settings saved');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-section">
      <SectionHead title="Privacy" description="Decide what strangers, friends and friends-of-friends can see." />
      <form className="settings-form" onSubmit={save}>
        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="settings-grid">
          <Field label="Profile visibility" hint="Private profiles hide your bio and photo from non-friends.">
            <select value={form.visibility} onChange={(event) => set('visibility', event.target.value)}>
              <option value="public">Public</option>
              <option value="private">Private — friends only</option>
            </select>
          </Field>
          <Field label="Who can see your bio">
            <select value={form.bioVisibility} onChange={(event) => set('bioVisibility', event.target.value)}>
              <option value="public">Everyone</option>
              <option value="friends">Friends only</option>
            </select>
          </Field>
          <Field label="Who can see your photo">
            <select value={form.avatarVisibility} onChange={(event) => set('avatarVisibility', event.target.value)}>
              <option value="public">Everyone</option>
              <option value="friends">Friends only</option>
            </select>
          </Field>
          <Field label="Who can see when you were last active">
            <select value={form.showLastActive} onChange={(event) => set('showLastActive', event.target.value)}>
              <option value="everyone">Everyone</option>
              <option value="friends">Friends only</option>
              <option value="nobody">Nobody</option>
            </select>
          </Field>
          <Field label="Who can send friend requests">
            <select value={form.friendRequestPolicy} onChange={(event) => set('friendRequestPolicy', event.target.value)}>
              <option value="everyone">Everyone</option>
              <option value="friends_of_friends">Friends of friends</option>
              <option value="nobody">Nobody</option>
            </select>
          </Field>
          <Field label="Who can message you">
            <select value={form.contactPolicy} onChange={(event) => set('contactPolicy', event.target.value)}>
              <option value="friends">Friends only (recommended)</option>
              <option value="nobody">Nobody</option>
            </select>
          </Field>
        </div>

        <div className="switch-stack">
          <Switch
            checked={form.showOnlineStatus}
            onChange={(value) => set('showOnlineStatus', value)}
            label="Show online status"
            description="Friends see a green dot while you're connected."
          />
          <Switch
            checked={form.discoverable}
            onChange={(value) => set('discoverable', value)}
            label="Appear in search"
            description="Turn this off to keep your profile out of Discover. Friends can still find you."
          />
        </div>

        <div className="settings-actions">
          <Button type="submit" icon={Save} loading={saving}>
            Save privacy settings
          </Button>
        </div>
      </form>
    </div>
  );
}

function NotificationsSection({ me, setMe, updateLocal }) {
  const toast = useToast();
  const [form, setForm] = useState({
    notifyMessages: me.user.settings.notifyMessages,
    notifyCalls: me.user.settings.notifyCalls,
    notifyFriendRequests: me.user.settings.notifyFriendRequests,
    pushEnabled: me.user.settings.pushEnabled
  });
  const [saving, setSaving] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushSupported, setPushSupported] = useState(true);

  useEffect(() => {
    setPushSupported(
      'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    );
  }, []);

  useEffect(() => {
    setForm({
      notifyMessages: me.user.settings.notifyMessages,
      notifyCalls: me.user.settings.notifyCalls,
      notifyFriendRequests: me.user.settings.notifyFriendRequests,
      pushEnabled: me.user.settings.pushEnabled
    });
  }, [me.user.settings]);

  function set(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const data = await endpoints.updateSettings({
        notifyMessages: form.notifyMessages,
        notifyCalls: form.notifyCalls,
        notifyFriendRequests: form.notifyFriendRequests
      });
      setMe(data);
      toast.success('Notification preferences saved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function enablePush(enable) {
    if (!pushSupported) {
      toast.error('Browser push is not supported in this browser.');
      return;
    }
    setPushBusy(true);
    try {
      if (enable) {
        const { enabled, publicKey } = await endpoints.pushKey();
        if (!enabled || !publicKey) {
          toast.error('Push is not configured on this server yet.');
          return;
        }
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          toast.error('Notification permission was not granted.');
          return;
        }
        const registration = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        const subscription =
          existing ||
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey)
          }));
        const json = subscription.toJSON();
        await endpoints.pushSubscribe({
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth }
        });
        setForm((prev) => ({ ...prev, pushEnabled: true }));
        updateLocal((current) =>
          current
            ? { ...current, user: { ...current.user, settings: { ...current.user.settings, pushEnabled: true } } }
            : current
        );
        toast.success('Browser push notifications enabled');
      } else {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription) {
          await endpoints.pushUnsubscribe(subscription.endpoint).catch(() => {});
          await subscription.unsubscribe();
        }
        const data = await endpoints.updateSettings({ pushEnabled: false });
        setMe(data);
        setForm((prev) => ({ ...prev, pushEnabled: false }));
        toast.info('Browser push notifications disabled');
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <div className="settings-section">
      <SectionHead title="Notifications" description="Choose what deserves your attention, and where." />
      <form className="settings-form" onSubmit={save}>
        <div className="switch-stack">
          <Switch
            checked={form.notifyMessages}
            onChange={(value) => set('notifyMessages', value)}
            label="New messages"
            description="In-app alerts and push (when you're offline)."
          />
          <Switch
            checked={form.notifyCalls}
            onChange={(value) => set('notifyCalls', value)}
            label="Missed calls"
            description="Get told when a friend tried to reach you."
          />
          <Switch
            checked={form.notifyFriendRequests}
            onChange={(value) => set('notifyFriendRequests', value)}
            label="Friend requests"
            description="Know when someone wants to connect."
          />
        </div>

        <div className="push-card">
          <div>
            <h3>Browser push</h3>
            <p>
              {pushSupported
                ? 'Receive notifications even when MinChat is closed. Requires HTTPS and browser permission.'
                : 'This browser does not support web push notifications.'}
            </p>
          </div>
          <Button
            variant={form.pushEnabled ? 'secondary' : 'primary'}
            size="sm"
            loading={pushBusy}
            disabled={!pushSupported}
            onClick={() => enablePush(!form.pushEnabled)}
          >
            {form.pushEnabled ? 'Disable push' : 'Enable push'}
          </Button>
        </div>

        <div className="settings-actions">
          <Button type="submit" icon={Save} loading={saving}>
            Save preferences
          </Button>
        </div>
      </form>
    </div>
  );
}

function SecuritySection({ user, setMe }) {
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const [emailSending, setEmailSending] = useState(false);
  const [phone, setPhone] = useState('');
  const [pendingPhone, setPendingPhone] = useState('');
  const [code, setCode] = useState('');
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [phoneError, setPhoneError] = useState('');
  const [removePassword, setRemovePassword] = useState('');
  const [removeOpen, setRemoveOpen] = useState(false);

  async function save(event) {
    event.preventDefault();
    setError('');
    if (newPassword !== confirm) {
      setError('New passwords do not match');
      return;
    }
    setSaving(true);
    try {
      const res = await endpoints.changePassword(currentPassword, newPassword);
      setDone(true);
      toast.success(`Password updated. ${res.revokedSessions || 0} other session(s) signed out.`);
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function resendEmail() {
    setEmailSending(true);
    try {
      const res = await endpoints.resendVerification();
      toast.success(res.alreadyVerified ? 'Your email is already verified' : 'Verification email sent');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setEmailSending(false);
    }
  }

  async function sendPhoneCode(event) {
    event.preventDefault();
    setPhoneError('');
    setPhoneBusy(true);
    try {
      const res = await endpoints.requestPhone(phone.trim());
      setPendingPhone(res.phone || phone.trim());
      setCode('');
      toast.success('We emailed a 6-digit code to your account address');
    } catch (err) {
      setPhoneError(err.message);
    } finally {
      setPhoneBusy(false);
    }
  }

  async function verifyCode(event) {
    event.preventDefault();
    setPhoneError('');
    setPhoneBusy(true);
    try {
      const res = await endpoints.verifyPhone(code.trim());
      setMe(res.me);
      setPendingPhone('');
      setPhone('');
      setCode('');
      toast.success('Phone number verified and linked');
    } catch (err) {
      setPhoneError(err.message);
    } finally {
      setPhoneBusy(false);
    }
  }

  async function removeNumber(event) {
    event.preventDefault();
    setPhoneError('');
    setPhoneBusy(true);
    try {
      const res = await endpoints.removePhone(removePassword);
      setMe(res.me);
      setRemoveOpen(false);
      setRemovePassword('');
      toast.success('Phone number removed');
    } catch (err) {
      setPhoneError(err.message);
    } finally {
      setPhoneBusy(false);
    }
  }

  return (
    <div className="settings-section">
      <SectionHead title="Security" description="Password, recovery email and an optional phone number." />

      <div className="security-note">
        <ShieldCheck size={20} />
        <div>
          <strong>Your sessions are protected with HttpOnly cookies.</strong>
          <p>Password changes sign out every other session automatically. Changing your password here keeps you signed in.</p>
        </div>
      </div>

      <section className="security-block">
        <div className="security-block-head">
          <span className="security-block-icon"><MailCheck size={18} /></span>
          <div>
            <h3>Email address</h3>
            <p>
              {user?.email}{' '}
              {user?.emailVerifiedAt
                ? `· verified ${fullDate(user.emailVerifiedAt)}`
                : '· not verified yet'}
            </p>
          </div>
          {user?.emailVerifiedAt ? (
            <span className="security-status is-ok"><CheckCircle2 size={15} /> Verified</span>
          ) : (
            <Button size="sm" variant="secondary" icon={RefreshCw} onClick={resendEmail} loading={emailSending}>
              Resend link
            </Button>
          )}
        </div>
      </section>

      <section className="security-block">
        <div className="security-block-head">
          <span className="security-block-icon"><Phone size={18} /></span>
          <div>
            <h3>Phone number</h3>
            <p>
              {user?.phone
                ? `${user.phone} · confirms sign-ins and recovery`
                : 'Optional. Adds a second way to sign in and gives you a recovery path.'}
            </p>
          </div>
          {user?.phone ? (
            <span className="security-status is-ok"><CheckCircle2 size={15} /> Linked</span>
          ) : null}
        </div>

        {phoneError ? <Alert tone="error">{phoneError}</Alert> : null}

        {!user?.phone && !pendingPhone ? (
          <form className="settings-form" onSubmit={sendPhoneCode}>
            <Field label="Add a phone number" hint="International format, for example +8801712345678.">
              <input
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+8801712345678"
                autoComplete="tel"
                required
              />
            </Field>
            <div className="settings-actions">
              <Button type="submit" variant="secondary" icon={Phone} loading={phoneBusy}>
                Send verification code
              </Button>
            </div>
          </form>
        ) : null}

        {pendingPhone ? (
          <form className="settings-form" onSubmit={verifyCode}>
            <Field label={`Code sent for ${pendingPhone}`} hint="The code is emailed to your account address and expires in 10 minutes.">
              <input
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                required
              />
            </Field>
            <div className="settings-actions">
              <Button type="submit" icon={Check} loading={phoneBusy}>
                Verify and link
              </Button>
              <Button type="button" variant="ghost" onClick={() => setPendingPhone('')} disabled={phoneBusy}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}

        {user?.phone ? (
          <div className="settings-actions">
            <Button variant="ghost" icon={Trash2} onClick={() => setRemoveOpen(true)}>
              Remove phone number
            </Button>
          </div>
        ) : null}

        <ConfirmDialog
          open={removeOpen}
          onClose={() => {
            setRemoveOpen(false);
            setRemovePassword('');
          }}
          onConfirm={removeNumber}
          loading={phoneBusy}
          title="Remove your phone number?"
          description="It will no longer be usable for sign-in. Enter your password to confirm."
          confirmLabel="Remove number"
        >
          <Field label="Password">
            <input
              type="password"
              autoComplete="current-password"
              value={removePassword}
              onChange={(event) => setRemovePassword(event.target.value)}
              required
            />
          </Field>
        </ConfirmDialog>
      </section>

      <form className="settings-form" onSubmit={save}>
        <h3 className="settings-subhead">Change password</h3>
        {error ? <Alert tone="error">{error}</Alert> : null}
        {done ? <Alert tone="success">Password changed successfully.</Alert> : null}
        <Field label="Current password">
          <input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
        </Field>
        <div className="settings-grid">
          <Field label="New password" hint="At least 10 characters.">
            <input type="password" autoComplete="new-password" minLength={10} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
          </Field>
          <Field label="Confirm new password">
            <input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required />
          </Field>
        </div>
        <div className="settings-actions">
          <Button type="submit" icon={KeyRound} loading={saving}>
            Change password
          </Button>
        </div>
      </form>
    </div>
  );
}

function SessionsSection() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmOthers, setConfirmOthers] = useState(false);
  const toast = useToast();

  async function load() {
    try {
      const data = await endpoints.sessions();
      setSessions(data.sessions || []);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function revoke(id) {
    setBusy(true);
    try {
      await endpoints.revokeSession(id);
      toast.success('Session signed out');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function revokeOthers() {
    setBusy(true);
    try {
      const res = await endpoints.revokeOtherSessions();
      toast.success(`${res.revoked || 0} other session(s) signed out`);
      setConfirmOthers(false);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  function deviceIcon(userAgent = '') {
    if (/mobile|android|iphone|ipad/i.test(userAgent)) return Smartphone;
    if (/tablet/i.test(userAgent)) return Monitor;
    return Laptop;
  }

  return (
    <div className="settings-section">
      <SectionHead title="Sessions" description="Every device currently signed in to your account." />

      {loading ? (
        <div className="page-loading">
          <Spinner size={18} /> Loading sessions…
        </div>
      ) : (
        <div className="session-list">
          {sessions.map((session) => {
            const Icon = deviceIcon(session.userAgent);
            return (
              <article className="session-row" key={session.id}>
                <span className="session-icon">
                  <Icon size={19} />
                </span>
                <div className="session-copy">
                  <h3>
                    {session.userAgent ? session.userAgent.slice(0, 70) : 'Unknown device'}
                    {session.current ? <span className="session-current">This device</span> : null}
                  </h3>
                  <span>
                    {session.ip || 'Unknown IP'} · signed in {timeAgo(session.createdAt)} · last seen {timeAgo(session.lastSeenAt)}
                  </span>
                </div>
                {!session.current ? (
                  <Button size="sm" variant="ghost" loading={busy} onClick={() => revoke(session.id)}>
                    Sign out
                  </Button>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      <div className="settings-actions">
        <Button variant="secondary" icon={LogOut} onClick={() => setConfirmOthers(true)} disabled={busy || sessions.length <= 1}>
          Sign out other sessions
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOthers}
        onClose={() => setConfirmOthers(false)}
        onConfirm={revokeOthers}
        loading={busy}
        title="Sign out everywhere else?"
        description="You will stay signed in on this device. Every other browser and device will need to sign in again."
        confirmLabel="Sign out others"
      />
    </div>
  );
}

function DangerSection({ me, setMe }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isAdmin = me.user.role === 'admin';

  async function removeAccount(event) {
    event.preventDefault();
    setError('');
    if (confirmation !== 'DELETE') {
      setError('Type DELETE exactly to confirm');
      return;
    }
    setBusy(true);
    try {
      await endpoints.deleteAccount(password);
      setMe(null);
      toast.success('Your account has been deleted');
      navigate('/login', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-section">
      <SectionHead title="Danger zone" description="Irreversible actions. Take a breath before continuing." />

      <div className="danger-card">
        <div>
          <h3>Delete your account</h3>
          <p>
            This removes your profile, friendships, blocks, sessions and uploaded files. Your
            messages remain visible to others as “Deleted user”. This cannot be undone.
          </p>
          {isAdmin ? (
            <Alert tone="warning">
              Administrator accounts cannot be self-deleted. Ask another administrator to demote this
              account first.
            </Alert>
          ) : null}
        </div>
        <Button variant="danger" icon={Trash2} onClick={() => setOpen(true)} disabled={isAdmin}>
          Delete account
        </Button>
      </div>

      {open ? (
        <form className="danger-form" onSubmit={removeAccount}>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <Field label="Your password">
            <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </Field>
          <Field label="Type DELETE to confirm">
            <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="DELETE" required />
          </Field>
          <div className="settings-actions">
            <Button variant="ghost" type="button" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" type="submit" loading={busy} disabled={confirmation !== 'DELETE' || !password}>
              Permanently delete account
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
