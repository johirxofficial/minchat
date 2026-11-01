import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Database,
  Eye,
  FileText,
  Flag,
  HardDrive,
  KeyRound,
  Laptop,
  Mail,
  MailCheck,
  Megaphone,
  Pencil,
  Phone,
  Pin,
  Plus,
  RefreshCw,
  Save,
  ScrollText,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  ShieldOff,
  Server,
  Trash2,
  UserCog,
  Users2,
  Wrench,
  XCircle
} from 'lucide-react';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  IconButton,
  Modal,
  Segmented,
  Spinner,
  Spinner as InlineSpinner,
  Switch
} from '../components/ui';
import { endpoints } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { fileSize, fullDate, timeAgo, truncate } from '../lib/utils';

const TABS = [
  { id: 'overview', label: 'Overview', icon: Activity, capability: 'console.access' },
  { id: 'users', label: 'Users', icon: Users2, capability: 'users.view' },
  { id: 'reports', label: 'Reports', icon: Flag, capability: 'reports.view' },
  { id: 'notices', label: 'Notices', icon: Megaphone, capability: 'notices.view' },
  { id: 'mail', label: 'Mail', icon: Mail, capability: 'mail.view' },
  { id: 'settings', label: 'Settings', icon: Settings2, capability: 'settings.manage' },
  { id: 'audit', label: 'Audit log', icon: ScrollText, capability: 'audit.view' },
  { id: 'developer', label: 'Developer', icon: Wrench, capability: 'developer.access' }
];

const ROLES = [
  { value: 'user', label: 'Member' },
  { value: 'staff', label: 'Staff' },
  { value: 'manager', label: 'Manager' },
  { value: 'admin', label: 'Administrator' }
];

const REPORT_STATUS_TONE = {
  open: 'warning',
  reviewing: 'info',
  resolved: 'success',
  dismissed: 'neutral'
};

function StatCard({ icon: Icon, label, value, hint, tone = 'default' }) {
  return (
    <article className={`stat-card stat-${tone}`}>
      <span className="stat-icon">
        <Icon size={19} />
      </span>
      <div>
        <span className="stat-label">{label}</span>
        <strong className="stat-value">{value}</strong>
        {hint ? <span className="stat-hint">{hint}</span> : null}
      </div>
    </article>
  );
}

function formatUptime(seconds) {
  if (!seconds && seconds !== 0) return '—';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export default function AdminPage() {
  const [params, setParams] = useSearchParams();
  const { can, user } = useAuth();
  const toast = useToast();
  const tabs = useMemo(() => TABS.filter((tab) => can(tab.capability)), [can]);
  const requested = params.get('tab');
  const active = tabs.some((tab) => tab.id === requested) ? requested : tabs[0]?.id || 'overview';

  function changeTab(value) {
    const next = new URLSearchParams(params);
    if (value === 'overview') next.delete('tab');
    else next.set('tab', value);
    setParams(next, { replace: true });
  }

  return (
    <div className="page admin-page">
      <header className="page-head">
        <div>
          <h1>
            <ShieldCheck size={22} className="page-head-icon" /> Console
          </h1>
          <p>
            Signed in as <strong>{user?.roleLabel || user?.role}</strong> · moderate reports, manage
            accounts, publish notices and keep an eye on the deployment.
          </p>
        </div>
      </header>

      <nav className="admin-tabs" aria-label="Admin sections">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              className={active === tab.id ? 'is-active' : ''}
              onClick={() => changeTab(tab.id)}
            >
              <Icon size={16} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {active === 'overview' ? <OverviewTab onGoTo={changeTab} toast={toast} /> : null}
      {active === 'users' ? <UsersTab toast={toast} /> : null}
      {active === 'reports' ? <ReportsTab toast={toast} /> : null}
      {active === 'notices' ? <NoticesTab toast={toast} /> : null}
      {active === 'mail' ? <MailTab toast={toast} /> : null}
      {active === 'settings' ? <SettingsTab toast={toast} /> : null}
      {active === 'audit' ? <AuditTab toast={toast} /> : null}
      {active === 'developer' ? <SystemTab toast={toast} /> : null}
    </div>
  );
}

function OverviewTab({ onGoTo, toast }) {
  const [stats, setStats] = useState(null);
  const [storage, setStorage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [statsData, storageData] = await Promise.all([
        endpoints.adminStats(),
        endpoints.adminStorage().catch(() => null)
      ]);
      setStats(statsData);
      setStorage(storageData);
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading && !stats) {
    return (
      <div className="page-loading">
        <Spinner size={22} /> Loading deployment overview…
      </div>
    );
  }

  if (error && !stats) {
    return <Alert tone="error">{error}</Alert>;
  }

  const counts = stats?.counts || {};
  const quota = storage?.quotaPerUserBytes || 0;
  const totalBytes = storage?.total?.bytes || stats?.storage?.bytes || 0;
  const topUsers = (storage?.users || []).slice(0, 5);

  return (
    <div className="admin-stack">
      <div className="admin-toolbar">
        <span className="admin-updated">
          Live snapshot · updated {new Date().toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
        </span>
        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={load} loading={loading}>
          Refresh
        </Button>
      </div>

      <div className="stat-grid">
        <StatCard icon={Users2} label="Active users" value={counts.active_users ?? 0} hint={`${counts.admins ?? 0} administrator(s)`} />
        <StatCard icon={Activity} label="Online now" value={counts.online ?? 0} hint="Realtime connections" tone="accent" />
        <StatCard icon={Flag} label="Open reports" value={counts.open_reports ?? 0} hint="Waiting for review" tone={counts.open_reports ? 'warning' : 'default'} />
        <StatCard icon={UserCog} label="Pending requests" value={counts.pending_requests ?? 0} hint="Friend requests" />
        <StatCard icon={FileText} label="Messages · 24h" value={counts.messages_24h ?? 0} />
        <StatCard icon={Server} label="Calls · 24h" value={counts.calls_24h ?? 0} />
        <StatCard icon={HardDrive} label="Stored media" value={fileSize(totalBytes)} hint={`${stats?.storage?.files ?? 0} files`} />
        <StatCard icon={ShieldOff} label="Suspended" value={counts.suspended_users ?? 0} />
      </div>

      <div className="admin-columns">
        <section className="admin-card">
          <header className="admin-card-head">
            <h2>Needs attention</h2>
            <Button variant="ghost" size="sm" onClick={() => onGoTo('reports')}>
              Open reports <ArrowRight size={14} />
            </Button>
          </header>
          {counts.open_reports ? (
            <p className="admin-note">
              <Flag size={16} /> {counts.open_reports} report{counts.open_reports === 1 ? '' : 's'} awaiting review.
              Evidence access is written to the audit log.
            </p>
          ) : (
            <p className="admin-note is-clear">
              <CheckCircle2 size={16} /> The moderation queue is clear.
            </p>
          )}
          <dl className="admin-facts">
            <div>
              <dt>Server uptime</dt>
              <dd>{formatUptime(stats?.server?.uptimeSeconds)}</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>{stats?.server?.version || '—'}</dd>
            </div>
            <div>
              <dt>Per-user quota</dt>
              <dd>{quota ? fileSize(quota) : '—'}</dd>
            </div>
          </dl>
        </section>

        <section className="admin-card">
          <header className="admin-card-head">
            <h2>Largest storage users</h2>
            <Button variant="ghost" size="sm" onClick={() => onGoTo('system')}>
              System <ArrowRight size={14} />
            </Button>
          </header>
          {topUsers.length === 0 ? (
            <p className="admin-note is-clear">
              <HardDrive size={16} /> No uploaded media yet.
            </p>
          ) : (
            <div className="admin-mini-list">
              {topUsers.map((person) => (
                <div className="admin-mini-row" key={person.id}>
                  <Avatar name={person.displayName || person.username} size={32} />
                  <span>
                    <strong>{person.displayName || person.username}</strong>
                    <em>
                      @{person.username} · {person.files} file{person.files === 1 ? '' : 's'}
                    </em>
                  </span>
                  <Badge tone="neutral">{fileSize(person.bytes)}</Badge>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function UsersTab({ toast }) {
  const { can, user: me } = useAuth();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [role, setRole] = useState('');
  const [verified, setVerified] = useState('');
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailId, setDetailId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), limit: '25' });
      if (query.trim()) params.set('q', query.trim());
      if (status) params.set('status', status);
      if (role) params.set('role', role);
      if (verified) params.set('verified', verified);
      const data = await endpoints.adminUsers(`?${params}`);
      setUsers(data.users || []);
      setPagination(data.pagination);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, query, status, role, verified]);

  useEffect(() => {
    const timer = setTimeout(load, query ? 350 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  async function openDetail(person) {
    setDetailId(person.id);
    setDetail(null);
    setDetailLoading(true);
    try {
      const data = await endpoints.adminUserDetail(person.id);
      setDetail(data);
    } catch (err) {
      toast.error(err.message);
      setDetailId(null);
    } finally {
      setDetailLoading(false);
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    setBusy(true);
    try {
      const person = confirm.user;
      if (confirm.type === 'suspend') {
        await endpoints.adminUser(person.id, { status: 'suspended' });
        toast.success(`${person.displayName || person.username} suspended`);
      }
      if (confirm.type === 'restore') {
        await endpoints.adminUser(person.id, { status: 'active' });
        toast.success('Account restored');
      }
      if (confirm.type === 'role') {
        await endpoints.adminUser(person.id, { role: confirm.role });
        toast.success(`Role changed to ${confirm.role}`);
      }
      if (confirm.type === 'verify') {
        await endpoints.adminUser(person.id, { verifyEmail: true });
        toast.success('Email marked verified');
      }
      if (confirm.type === 'clearPhone') {
        await endpoints.adminUser(person.id, { clearPhone: true });
        toast.success('Phone number removed');
      }
      if (confirm.type === 'unlock') {
        await endpoints.adminUser(person.id, { unlock: true });
        toast.success('Sign-in lock cleared');
      }
      if (confirm.type === 'reset') {
        await endpoints.adminResetPassword(person.id);
        toast.success('Password reset link queued');
      }
      if (confirm.type === 'logout') {
        const result = await endpoints.forceLogout(person.id);
        toast.success(`${result.revoked || 0} session(s) revoked`);
      }
      if (confirm.type === 'delete') {
        await endpoints.adminDeleteUser(person.id);
        toast.success('Account deleted');
      }
      setConfirm(null);
      await load();
      if (detailId === person.id) {
        if (confirm.type === 'delete') setDetailId(null);
        else openDetail(person);
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const canModerate = can('users.moderate');
  const canDelete = can('users.delete');
  const canRoles = me?.role === 'admin';

  return (
    <div className="admin-stack">
      <div className="admin-filters">
        <div className="search-box">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
            placeholder="Search by name, username, email or phone…"
            aria-label="Search users"
          />
          {loading ? <InlineSpinner size={16} /> : null}
        </div>
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="deleted">Deleted</option>
        </select>
        <select
          value={role}
          onChange={(event) => {
            setRole(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by role"
        >
          <option value="">All roles</option>
          {ROLES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <select
          value={verified}
          onChange={(event) => {
            setVerified(event.target.value);
            setPage(1);
          }}
          aria-label="Filter by email verification"
        >
          <option value="">Any verification</option>
          <option value="yes">Email verified</option>
          <option value="no">Email unverified</option>
        </select>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {loading && users.length === 0 ? (
        <div className="page-loading">
          <Spinner size={20} /> Loading users…
        </div>
      ) : users.length === 0 ? (
        <EmptyState icon={Users2} title="No users matched" description="Try a different search term or filter." compact />
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Verified</th>
                <th>Storage</th>
                <th>Reports</th>
                <th>Joined</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {users.map((person) => (
                <tr key={person.id}>
                  <td>
                    <button type="button" className="admin-user-cell admin-user-link" onClick={() => openDetail(person)}>
                      <Avatar name={person.displayName || person.username} src={person.avatarUrl} size={34} />
                      <span>
                        <strong>{person.displayName || person.username}</strong>
                        <em>
                          @{person.username} · {person.email}
                        </em>
                      </span>
                    </button>
                  </td>
                  <td>
                    <Badge tone={person.role === 'admin' ? 'accent' : person.role === 'manager' ? 'info' : person.role === 'staff' ? 'warning' : 'neutral'}>
                      {person.roleLabel || person.role}
                    </Badge>
                  </td>
                  <td>
                    <Badge tone={person.status === 'active' ? 'success' : person.status === 'suspended' ? 'danger' : 'neutral'}>
                      {person.status}
                    </Badge>
                  </td>
                  <td>
                    <span className="admin-verify-cell">
                      {person.emailVerified ? (
                        <span className="is-ok" title="Email verified"><MailCheck size={15} /> Email</span>
                      ) : (
                        <span className="is-warn" title="Email not verified"><Mail size={15} /> Email</span>
                      )}
                      {person.phone ? (
                        <span className={person.phoneVerified ? 'is-ok' : 'is-warn'} title={person.phone}>
                          <Phone size={15} /> Phone
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td>{person.storageBytes ? fileSize(person.storageBytes) : '—'}</td>
                  <td>
                    {person.openReports ? (
                      <Badge tone="warning">{person.openReports} open</Badge>
                    ) : (
                      <span className="admin-muted">—</span>
                    )}
                  </td>
                  <td className="admin-muted">{fullDate(person.createdAt)}</td>
                  <td>
                    <div className="admin-row-actions">
                      {canModerate && person.id !== me?.id ? (
                        <IconButton
                          label="Sign out all sessions"
                          icon={KeyRound}
                          size={15}
                          onClick={() => setConfirm({ type: 'logout', user: person, title: `Sign ${person.displayName || person.username} out everywhere?`, description: 'All active sessions will be revoked immediately.', label: 'Force logout' })}
                        />
                      ) : null}
                      {canModerate && person.id !== me?.id && person.status === 'active' ? (
                        <IconButton
                          label="Suspend account"
                          icon={ShieldOff}
                          size={15}
                          onClick={() => setConfirm({ type: 'suspend', user: person, title: `Suspend ${person.displayName || person.username}?`, description: 'They are signed out and cannot sign back in until restored.', label: 'Suspend' })}
                        />
                      ) : null}
                      {canModerate && person.id !== me?.id && person.status === 'suspended' ? (
                        <IconButton
                          label="Restore account"
                          icon={ShieldCheck}
                          size={15}
                          onClick={() => setConfirm({ type: 'restore', user: person, title: 'Restore this account?', description: 'The user will be able to sign in again.', label: 'Restore', tone: 'primary' })}
                        />
                      ) : null}
                      <IconButton
                        label="Manage account"
                        icon={Pencil}
                        size={15}
                        onClick={() => openDetail(person)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pagination && pagination.total > pagination.limit ? (
        <div className="admin-pagination">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Previous
          </Button>
          <span>
            Page {pagination.page} · {pagination.total} user{pagination.total === 1 ? '' : 's'}
          </span>
          <Button variant="secondary" size="sm" disabled={!pagination.hasMore} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      ) : null}

      <Modal
        open={Boolean(detailId)}
        onClose={() => setDetailId(null)}
        title="Account details"
        description="Administrative changes are recorded in the audit log."
        size="lg"
        footer={<Button variant="ghost" onClick={() => setDetailId(null)}>Close</Button>}
      >
        {detailLoading ? (
          <div className="page-loading"><Spinner size={18} /> Loading account…</div>
        ) : detail ? (
          <div className="admin-stack">
            <div className="admin-user-head">
              <Avatar name={detail.user.displayName || detail.user.username} src={detail.user.avatarUrl} size={56} />
              <div>
                <h3>{detail.user.displayName || detail.user.username}</h3>
                <p>
                  @{detail.user.username} · {detail.user.email}
                </p>
                <div className="admin-badge-row">
                  <Badge tone={detail.user.role === 'admin' ? 'accent' : 'neutral'}>{detail.user.roleLabel}</Badge>
                  <Badge tone={detail.user.status === 'active' ? 'success' : 'danger'}>{detail.user.status}</Badge>
                  <Badge tone={detail.user.emailVerified ? 'success' : 'warning'}>
                    {detail.user.emailVerified ? 'Email verified' : 'Email unverified'}
                  </Badge>
                  {detail.user.phone ? (
                    <Badge tone={detail.user.phoneVerified ? 'success' : 'warning'}>{detail.user.phone}</Badge>
                  ) : null}
                </div>
              </div>
            </div>

            <dl className="admin-facts">
              <div><dt>Joined</dt><dd>{fullDate(detail.user.createdAt)}</dd></div>
              <div><dt>Last active</dt><dd>{detail.user.lastActiveAt ? timeAgo(detail.user.lastActiveAt) : '—'}</dd></div>
              <div><dt>Last sign-in</dt><dd>{detail.user.lastLoginAt ? timeAgo(detail.user.lastLoginAt) : '—'}</dd></div>
              <div><dt>Messages</dt><dd>{detail.counts?.messages ?? 0}</dd></div>
              <div><dt>Friends</dt><dd>{detail.counts?.friends ?? 0}</dd></div>
              <div><dt>Conversations</dt><dd>{detail.counts?.conversations ?? 0}</dd></div>
              <div><dt>Open reports</dt><dd>{detail.counts?.open_reports ?? 0}</dd></div>
              <div><dt>Storage</dt><dd>{fileSize(detail.counts?.storage_bytes || 0)}</dd></div>
            </dl>

            {canRoles && detail.user.id !== me?.id ? (
              <Field label="Role" hint="Staff and managers gain console access but keep full chat and call features.">
                <select
                  value={detail.user.role}
                  disabled={busy}
                  onChange={(event) => {
                    const nextRole = event.target.value;
                    if (nextRole === detail.user.role) return;
                    setConfirm({
                      type: 'role',
                      role: nextRole,
                      user: detail.user,
                      title: `Change role to ${nextRole}?`,
                      description: 'The account keeps normal messaging. Role changes are emailed to the account owner.',
                      label: 'Change role',
                      tone: nextRole === 'admin' ? 'primary' : 'danger'
                    });
                  }}
                >
                  {ROLES.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </Field>
            ) : null}

            {canModerate && detail.user.id !== me?.id ? (
              <div className="admin-action-grid">
                {detail.user.status === 'active' ? (
                  <Button variant="secondary" size="sm" icon={ShieldOff} onClick={() => setConfirm({ type: 'suspend', user: detail.user, title: 'Suspend this account?', description: 'They are signed out immediately.', label: 'Suspend' })}>
                    Suspend
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" icon={ShieldCheck} onClick={() => setConfirm({ type: 'restore', user: detail.user, title: 'Restore this account?', description: 'They can sign in again.', label: 'Restore', tone: 'primary' })}>
                    Restore
                  </Button>
                )}
                <Button variant="secondary" size="sm" icon={KeyRound} onClick={() => setConfirm({ type: 'logout', user: detail.user, title: 'Sign out everywhere?', description: 'All active sessions will be revoked.', label: 'Force logout' })}>
                  Force logout
                </Button>
                <Button variant="secondary" size="sm" icon={Send} onClick={() => setConfirm({ type: 'reset', user: detail.user, title: 'Send a password reset link?', description: 'A reset link is emailed to the account address.', label: 'Send reset link', tone: 'primary' })}>
                  Send reset link
                </Button>
                {!detail.user.emailVerified ? (
                  <Button variant="secondary" size="sm" icon={MailCheck} onClick={() => setConfirm({ type: 'verify', user: detail.user, title: 'Mark email as verified?', description: 'Use this only when you have confirmed the address another way.', label: 'Mark verified', tone: 'primary' })}>
                    Verify email
                  </Button>
                ) : null}
                {detail.user.phone ? (
                  <Button variant="secondary" size="sm" icon={Phone} onClick={() => setConfirm({ type: 'clearPhone', user: detail.user, title: 'Remove the phone number?', description: 'The owner is emailed about the change.', label: 'Remove phone' })}>
                    Remove phone
                  </Button>
                ) : null}
                <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => setConfirm({ type: 'unlock', user: detail.user, title: 'Clear sign-in lock?', description: 'Failed attempt counters and lockouts are reset.', label: 'Unlock', tone: 'primary' })}>
                  Unlock sign-in
                </Button>
                {canDelete ? (
                  <Button variant="danger" size="sm" icon={Trash2} onClick={() => setConfirm({ type: 'delete', user: detail.user, title: 'Delete this account?', description: 'Profile, friendships, sessions and uploaded files are removed. This cannot be undone.', label: 'Delete account' })}>
                    Delete account
                  </Button>
                ) : null}
              </div>
            ) : null}

            <section>
              <h4 className="admin-subhead">Active sessions</h4>
              {detail.sessions?.length ? (
                <div className="admin-mini-list">
                  {detail.sessions.map((session) => (
                    <div className="admin-mini-row" key={session.id}>
                      <span className="admin-mini-icon"><Laptop size={16} /></span>
                      <span>
                        <strong>{session.userAgent ? session.userAgent.slice(0, 60) : 'Unknown device'}</strong>
                        <em>{session.ip || 'unknown IP'} · last seen {timeAgo(session.lastSeenAt)}</em>
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="admin-muted">No active sessions.</p>
              )}
            </section>

            {detail.reports?.length ? (
              <section>
                <h4 className="admin-subhead">Recent reports</h4>
                <div className="admin-mini-list">
                  {detail.reports.map((report) => (
                    <div className="admin-mini-row" key={report.id}>
                      <span className="admin-mini-icon"><Flag size={16} /></span>
                      <span>
                        <strong>{report.reason.replace(/_/g, ' ')}</strong>
                        <em>{timeAgo(report.created_at)}</em>
                      </span>
                      <Badge tone={REPORT_STATUS_TONE[report.status] || 'neutral'}>{report.status}</Badge>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {detail.mail?.length ? (
              <section>
                <h4 className="admin-subhead">Recent email</h4>
                <div className="admin-mini-list">
                  {detail.mail.map((mail) => (
                    <div className="admin-mini-row" key={mail.id}>
                      <span className="admin-mini-icon"><Mail size={16} /></span>
                      <span>
                        <strong>{mail.subject}</strong>
                        <em>{mail.template} · {timeAgo(mail.created_at)}</em>
                      </span>
                      <Badge tone={mail.status === 'sent' ? 'success' : mail.status === 'failed' ? 'danger' : 'warning'}>{mail.status}</Badge>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirm}
        loading={busy}
        tone={confirm?.tone || 'danger'}
        title={confirm?.title}
        description={confirm?.description}
        confirmLabel={confirm?.label}
      />
    </div>
  );
}

function CrownIcon(props) {
  return <ShieldCheck {...props} />;
}

function ReportsTab({ toast }) {
  const [status, setStatus] = useState('open');
  const [reports, setReports] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [evidence, setEvidence] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolutionStatus, setResolutionStatus] = useState('resolved');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await endpoints.adminReports(status, page);
      setReports(data.reports || []);
      setPagination(data.pagination);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, status]);

  useEffect(() => {
    setPage(1);
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  async function openReport(report) {
    setDetail(report);
    setEvidence(null);
    setDetailLoading(true);
    try {
      const data = await endpoints.adminReport(report.id);
      setDetail(data.report);
      if (data.report?.hasEvidence) {
        const ev = await endpoints.adminEvidence(report.id).catch(() => null);
        if (ev) setEvidence(ev);
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDetailLoading(false);
    }
  }

  async function review() {
    if (!detail) return;
    setBusy(true);
    try {
      await endpoints.adminReview(detail.id, resolutionStatus, note.trim() || undefined);
      toast.success(`Report marked ${resolutionStatus}`);
      setResolveOpen(false);
      setNote('');
      setDetail(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function suspendReported() {
    if (!detail?.reportedUser?.id) return;
    setBusy(true);
    try {
      await endpoints.adminUser(detail.reportedUser.id, { status: 'suspended' });
      toast.success('Reported account suspended');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-stack">
      <Segmented
        ariaLabel="Report status"
        value={status}
        onChange={(value) => setStatus(value)}
        options={[
          { value: 'open', label: 'Open' },
          { value: 'reviewing', label: 'Reviewing' },
          { value: 'resolved', label: 'Resolved' },
          { value: 'dismissed', label: 'Dismissed' },
          { value: 'all', label: 'All' }
        ]}
      />

      {error ? <Alert tone="error">{error}</Alert> : null}

      {loading && reports.length === 0 ? (
        <div className="page-loading">
          <Spinner size={20} /> Loading reports…
        </div>
      ) : reports.length === 0 ? (
        <EmptyState
          icon={Flag}
          title={status === 'open' ? 'No open reports' : 'Nothing here'}
          description={status === 'open' ? 'The moderation queue is clear. Nice work.' : 'No reports match this filter.'}
          compact
        />
      ) : (
        <div className="report-list">
          {reports.map((report) => (
            <article className="admin-report-card" key={report.id}>
              <div className="admin-report-top">
                <Badge tone={REPORT_STATUS_TONE[report.status] || 'neutral'}>{report.status}</Badge>
                <span className="admin-muted">{timeAgo(report.createdAt)}</span>
              </div>
              <h3>{report.reason.replace(/_/g, ' ')}</h3>
              <p>{report.details ? truncate(report.details, 200) : 'No additional details were provided.'}</p>
              <div className="admin-report-meta">
                <span>
                  Reporter <strong>{report.reporter?.displayName || report.reporter?.username || 'unknown'}</strong>
                </span>
                <span>
                  Reported <strong>{report.reportedUser?.displayName || report.reportedUser?.username || 'unknown'}</strong>
                </span>
                {report.hasEvidence ? (
                  <Badge tone="info">
                    <FileText size={12} /> Message attached
                  </Badge>
                ) : null}
              </div>
              <div className="admin-report-actions">
                <Button size="sm" variant="secondary" icon={Eye} onClick={() => openReport(report)}>
                  Review
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      {pagination && pagination.total > pagination.limit ? (
        <div className="admin-pagination">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Previous
          </Button>
          <span>
            Page {pagination.page} · {pagination.total} report{pagination.total === 1 ? '' : 's'}
          </span>
          <Button variant="secondary" size="sm" disabled={!pagination.hasMore} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      ) : null}

      <Modal
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title="Report details"
        description="Evidence access is recorded in the audit log."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDetail(null)} disabled={busy}>
              Close
            </Button>
            {detail?.reportedUser ? (
              <Button variant="secondary" icon={ShieldOff} onClick={suspendReported} loading={busy}>
                Suspend reported user
              </Button>
            ) : null}
            <Button variant="primary" icon={CheckCircle2} onClick={() => { setResolutionStatus('resolved'); setResolveOpen(true); }}>
              Resolve
            </Button>
          </>
        }
      >
        {detailLoading ? (
          <div className="page-loading">
            <Spinner size={18} /> Loading report…
          </div>
        ) : detail ? (
          <div className="admin-stack">
            <dl className="admin-facts">
              <div>
                <dt>Status</dt>
                <dd>
                  <Badge tone={REPORT_STATUS_TONE[detail.status] || 'neutral'}>{detail.status}</Badge>
                </dd>
              </div>
              <div>
                <dt>Reason</dt>
                <dd>{detail.reason.replace(/_/g, ' ')}</dd>
              </div>
              <div>
                <dt>Reported user</dt>
                <dd>
                  {detail.reportedUser?.displayName || detail.reportedUser?.username}{' '}
                  <span className="admin-muted">@{detail.reportedUser?.username}</span>
                </dd>
              </div>
              <div>
                <dt>Reporter</dt>
                <dd>@{detail.reporter?.username}</dd>
              </div>
              <div>
                <dt>Submitted</dt>
                <dd>{fullDate(detail.createdAt)}</dd>
              </div>
              {detail.resolutionNote ? (
                <div>
                  <dt>Resolution note</dt>
                  <dd>{detail.resolutionNote}</dd>
                </div>
              ) : null}
            </dl>

            <section>
              <h4 className="admin-subhead">User description</h4>
              <p className="admin-quote">{detail.details || 'No additional details were provided.'}</p>
            </section>

            <section>
              <h4 className="admin-subhead">Attached evidence</h4>
              {!detail.hasEvidence ? (
                <p className="admin-muted">No message was attached to this report.</p>
              ) : evidence ? (
                <div className="admin-evidence">
                  <div className="admin-evidence-head">
                    <strong>{evidence.evidence.sender?.displayName || evidence.evidence.sender?.username}</strong>
                    <span>{fullDate(evidence.evidence.createdAt)}</span>
                  </div>
                  <p>
                    {evidence.evidence.deletedAt
                      ? 'This message was deleted before review.'
                      : evidence.evidence.body || '(attachment only)'}
                  </p>
                  {evidence.evidence.attachments?.length ? (
                    <ul className="admin-evidence-files">
                      {evidence.evidence.attachments.map((file) => (
                        <li key={`${file.name}-${file.mime}`}>
                          <FileText size={13} /> {file.name} · {fileSize(file.size)}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="admin-muted">{evidence.notice}</p>
                </div>
              ) : (
                <p className="admin-muted">Evidence could not be loaded.</p>
              )}
            </section>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={resolveOpen}
        onClose={() => setResolveOpen(false)}
        title="Review this report"
        description="Choose the outcome and leave an internal note. The reporter is not notified of the outcome."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResolveOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={review} loading={busy} icon={CheckCircle2}>
              Save decision
            </Button>
          </>
        }
      >
        <Field label="Decision">
          <select value={resolutionStatus} onChange={(event) => setResolutionStatus(event.target.value)}>
            <option value="reviewing">Keep open for review</option>
            <option value="resolved">Resolved — action taken</option>
            <option value="dismissed">Dismissed — no action</option>
          </select>
        </Field>
        <Field label="Internal note" optional hint="Only administrators can see this.">
          <textarea
            rows={3}
            maxLength={1000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="What did you decide, and why?"
          />
        </Field>
      </Modal>
    </div>
  );
}

const NOTICE_LEVELS = [
  { value: 'info', label: 'Info — neutral blue' },
  { value: 'success', label: 'Success — green' },
  { value: 'warning', label: 'Warning — amber' },
  { value: 'critical', label: 'Critical — red' }
];

const NOTICE_TONE = { info: 'info', success: 'success', warning: 'warning', critical: 'danger' };

function emptyNotice() {
  return {
    title: '',
    body: '',
    level: 'info',
    audience: 'everyone',
    status: 'draft',
    pinned: false,
    dismissible: true,
    startsAt: '',
    endsAt: ''
  };
}

function NoticesTab({ toast }) {
  const { can, user } = useAuth();
  const [status, setStatus] = useState('all');
  const [notices, setNotices] = useState([]);
  const [counts, setCounts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState(null);
  const [form, setForm] = useState(emptyNotice());
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);

  const canManage = can('notices.manage');
  const canEmail = user?.role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ status, limit: '100' });
      const data = await endpoints.adminNotices(`?${params}`);
      setNotices(data.notices || []);
      setCounts(data.counts || null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setForm(emptyNotice());
    setEditor('create');
  }

  function openEdit(notice) {
    setForm({
      title: notice.title,
      body: notice.body,
      level: notice.level,
      audience: notice.audience,
      status: notice.status === 'archived' ? 'draft' : notice.status,
      pinned: Boolean(notice.pinned),
      dismissible: Boolean(notice.dismissible),
      startsAt: notice.startsAt ? notice.startsAt.slice(0, 16) : '',
      endsAt: notice.endsAt ? notice.endsAt.slice(0, 16) : ''
    });
    setEditor(notice);
  }

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(),
        body: form.body.trim(),
        level: form.level,
        audience: form.audience,
        status: form.status,
        pinned: form.pinned,
        dismissible: form.dismissible,
        startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
        endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null
      };
      if (editor === 'create') {
        await endpoints.adminCreateNotice(payload);
        toast.success('Notice saved');
      } else {
        await endpoints.adminUpdateNotice(editor.id, payload);
        toast.success('Notice updated');
      }
      setEditor(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function runConfirm() {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.type === 'publish') {
        await endpoints.adminPublishNotice(confirm.notice.id, Boolean(confirm.sendEmail));
        toast.success(confirm.sendEmail ? 'Published and emailing members' : 'Notice published');
      }
      if (confirm.type === 'archive') {
        await endpoints.adminArchiveNotice(confirm.notice.id);
        toast.success('Notice archived');
      }
      if (confirm.type === 'delete') {
        await endpoints.adminDeleteNotice(confirm.notice.id);
        toast.success('Notice deleted');
      }
      setConfirm(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-stack">
      <div className="admin-toolbar">
        <div className="admin-filter-row">
          <Segmented
            ariaLabel="Notice status"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: `All${counts ? ` (${counts.published + counts.draft})` : ''}` },
              { value: 'published', label: `Published${counts ? ` (${counts.published})` : ''}` },
              { value: 'draft', label: `Drafts${counts ? ` (${counts.draft})` : ''}` },
              { value: 'archived', label: 'Archived' }
            ]}
          />
        </div>
        {canManage ? (
          <Button size="sm" icon={Plus} onClick={openCreate}>New notice</Button>
        ) : null}
      </div>

      <p className="admin-note">
        <Megaphone size={16} /> Published notices appear at the top of every member’s conversation
        list. Members can dismiss them unless you make the notice permanent.
      </p>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {loading && notices.length === 0 ? (
        <div className="page-loading"><Spinner size={20} /> Loading notices…</div>
      ) : notices.length === 0 ? (
        <EmptyState icon={Megaphone} title="No notices yet" description="Publish an announcement to greet everyone at the top of their chat list." compact />
      ) : (
        <div className="notice-admin-list">
          {notices.map((notice) => (
            <article className="admin-card notice-admin-card" key={notice.id}>
              <div className="notice-admin-top">
                <Badge tone={NOTICE_TONE[notice.level] || 'info'}>{notice.level}</Badge>
                <Badge tone={notice.status === 'published' ? 'success' : notice.status === 'draft' ? 'warning' : 'neutral'}>
                  {notice.status}
                </Badge>
                {notice.pinned ? <Badge tone="accent"><Pin size={11} /> Pinned</Badge> : null}
                {notice.dismissible ? null : <Badge tone="neutral">Permanent</Badge>}
                <span className="admin-muted">{timeAgo(notice.createdAt)}</span>
              </div>
              <h3>{notice.title}</h3>
              <p>{truncate(notice.body, 260)}</p>
              <div className="notice-admin-meta">
                <span>Audience <strong>{notice.audience}</strong></span>
                <span>Dismissed by <strong>{notice.dismissals ?? 0}</strong></span>
                {notice.author ? <span>By <strong>{notice.author.displayName || notice.author.username}</strong></span> : null}
                {notice.startsAt ? <span>Starts <strong>{fullDate(notice.startsAt)}</strong></span> : null}
                {notice.endsAt ? <span>Ends <strong>{fullDate(notice.endsAt)}</strong></span> : null}
              </div>
              {canManage ? (
                <div className="admin-report-actions">
                  {notice.status !== 'published' ? (
                    <Button size="sm" icon={Send} onClick={() => setConfirm({ type: 'publish', notice, sendEmail: false, title: 'Publish this notice?', description: 'It will appear above the conversation list for the selected audience.', label: 'Publish', tone: 'primary' })}>
                      Publish
                    </Button>
                  ) : null}
                  {notice.status !== 'published' && canEmail ? (
                    <Button size="sm" variant="secondary" icon={Mail} onClick={() => setConfirm({ type: 'publish', notice, sendEmail: true, title: 'Publish and email everyone?', description: 'This queues an announcement email to every active account in the audience. Large sends are capped per run.', label: 'Publish + email', tone: 'primary' })}>
                      Publish + email
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" icon={Pencil} onClick={() => openEdit(notice)}>Edit</Button>
                  {notice.status === 'published' ? (
                    <Button size="sm" variant="ghost" icon={XCircle} onClick={() => setConfirm({ type: 'archive', notice, title: 'Archive this notice?', description: 'It disappears from chat lists immediately and can no longer be published.', label: 'Archive' })}>
                      Archive
                    </Button>
                  ) : null}
                  {user?.role === 'admin' ? (
                    <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setConfirm({ type: 'delete', notice, title: 'Delete this notice?', description: 'This permanently removes the notice and its dismissal records.', label: 'Delete' })}>
                      Delete
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        title={editor === 'create' ? 'New notice' : 'Edit notice'}
        description="Keep announcements short and actionable. Markdown is not rendered."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditor(null)} disabled={saving}>Cancel</Button>
            <Button onClick={save} loading={saving} icon={Save}>Save notice</Button>
          </>
        }
      >
        <form className="settings-form" onSubmit={save}>
          <Field label="Title" hint="Up to 120 characters.">
            <input maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required />
          </Field>
          <Field label="Message" hint="Up to 2000 characters.">
            <textarea rows={4} maxLength={2000} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} required />
          </Field>
          <div className="settings-grid">
            <Field label="Level">
              <select value={form.level} onChange={(event) => setForm({ ...form, level: event.target.value })}>
                {NOTICE_LEVELS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </Field>
            <Field label="Audience">
              <select value={form.audience} onChange={(event) => setForm({ ...form, audience: event.target.value })}>
                <option value="everyone">Everyone</option>
                <option value="staff">Staff and managers</option>
                <option value="admins">Administrators only</option>
              </select>
            </Field>
          </div>
          <div className="settings-grid">
            <Field label="Starts at" optional hint="Leave blank to start immediately.">
              <input type="datetime-local" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} />
            </Field>
            <Field label="Ends at" optional hint="Leave blank to run indefinitely.">
              <input type="datetime-local" value={form.endsAt} onChange={(event) => setForm({ ...form, endsAt: event.target.value })} />
            </Field>
          </div>
          <div className="settings-toggles">
            <Switch checked={form.pinned} onChange={(value) => setForm({ ...form, pinned: value })} label="Pin to the top" description="Pinned notices sort above other announcements." />
            <Switch checked={form.dismissible} onChange={(value) => setForm({ ...form, dismissible: value })} label="Members can dismiss" description="Turn this off for permanent policy notices." />
          </div>
          <Field label="Save as">
            <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
              <option value="draft">Draft — not visible</option>
              <option value="published">Published — visible immediately</option>
            </select>
          </Field>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={runConfirm}
        loading={busy}
        tone={confirm?.tone || 'danger'}
        title={confirm?.title}
        description={confirm?.description}
        confirmLabel={confirm?.label}
      />
    </div>
  );
}

function MailTab({ toast }) {
  const { can } = useAuth();
  const canManage = can('mail.manage');
  const [status, setStatus] = useState('all');
  const [query, setQuery] = useState('');
  const [mail, setMail] = useState([]);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ status, limit: '50' });
      if (query.trim()) params.set('q', query.trim());
      const data = await endpoints.adminMail(`?${params}`);
      setMail(data.mail || []);
      setMeta(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [status, query]);

  useEffect(() => {
    const timer = setTimeout(load, query ? 350 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  async function runTest(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const res = await endpoints.adminTestMail(testTo.trim());
      toast.success(res.message || 'Test email queued');
      setTestTo('');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function processQueue() {
    setBusy(true);
    try {
      const res = await endpoints.adminProcessMail();
      toast.success(`Processed ${res.processed ?? 0} queued message(s)`);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function retry(id) {
    setBusy(true);
    try {
      await endpoints.adminRetryMail(id);
      toast.success('Message queued for retry');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id) {
    setBusy(true);
    try {
      await endpoints.adminCancelMail(id);
      toast.success('Message cancelled');
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  const mode = meta?.status?.mode;
  const stats = meta?.stats;

  return (
    <div className="admin-stack">
      {mode !== 'smtp' ? (
        <Alert tone="warning" title="Outbound email is not fully configured">
          {mode === 'development'
            ? 'SMTP is not configured. Messages are recorded in the outbox and logged, which is fine for testing but no real email leaves the server.'
            : 'SMTP is disabled and ALLOW_DEV_EMAIL is off, so queued mail will fail. Add SMTP credentials and restart the service.'}
        </Alert>
      ) : (
        <Alert tone="success" title="SMTP is configured">
          Messages are delivered by the background worker with automatic retries.
        </Alert>
      )}

      <div className="stat-grid">
        <StatCard icon={Mail} label="Queued" value={stats?.counts?.queued ?? 0} tone={stats?.counts?.queued ? 'warning' : 'default'} />
        <StatCard icon={Send} label="Sent · 24h" value={stats?.sent_24h ?? 0} />
        <StatCard icon={XCircle} label="Failed · 24h" value={stats?.failed_24h ?? 0} tone={stats?.failed_24h ? 'danger' : 'default'} />
        <StatCard icon={Activity} label="Total sent" value={stats?.counts?.sent ?? 0} />
      </div>

      <div className="admin-filters">
        <div className="search-box">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search recipient or subject…"
            aria-label="Search mail"
          />
          {loading ? <InlineSpinner size={16} /> : null}
        </div>
        <select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter mail by status">
          <option value="all">All statuses</option>
          <option value="queued">Queued</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={load} loading={loading}>Refresh</Button>
        {canManage ? (
          <Button variant="secondary" size="sm" icon={Send} onClick={processQueue} loading={busy}>Process queue</Button>
        ) : null}
      </div>

      {canManage ? (
        <form className="admin-inline-form" onSubmit={runTest}>
          <Field label="Send a test email">
            <input type="email" value={testTo} onChange={(event) => setTestTo(event.target.value)} placeholder="you@example.com" required />
          </Field>
          <Button type="submit" variant="secondary" icon={Mail} loading={busy}>Send test</Button>
        </form>
      ) : null}

      {error ? <Alert tone="error">{error}</Alert> : null}

      {loading && mail.length === 0 ? (
        <div className="page-loading"><Spinner size={20} /> Loading mail…</div>
      ) : mail.length === 0 ? (
        <EmptyState icon={Mail} title="No email in the outbox" description="Account, security and announcement messages will appear here." compact />
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Subject</th>
                <th>Template</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Queued</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {mail.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="admin-user-cell">
                      <span>
                        <strong>{item.recipient?.displayName || item.recipient?.username || item.to}</strong>
                        <em>{item.to}</em>
                      </span>
                    </div>
                  </td>
                  <td>{truncate(item.subject, 60)}{item.lastError ? <em className="admin-error-text">{truncate(item.lastError, 80)}</em> : null}</td>
                  <td><code className="admin-code">{item.template}</code></td>
                  <td>
                    <Badge tone={item.status === 'sent' ? 'success' : item.status === 'failed' ? 'danger' : item.status === 'queued' ? 'warning' : 'neutral'}>
                      {item.status}
                    </Badge>
                    {item.meta?.development ? <Badge tone="info">dev</Badge> : null}
                  </td>
                  <td>{item.attempts}</td>
                  <td className="admin-muted">{timeAgo(item.createdAt)}</td>
                  <td>
                    {canManage && (item.status === 'failed' || item.status === 'cancelled') ? (
                      <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => retry(item.id)} disabled={busy}>Retry</Button>
                    ) : null}
                    {canManage && (item.status === 'queued' || item.status === 'failed') ? (
                      <Button size="sm" variant="ghost" icon={XCircle} onClick={() => cancel(item.id)} disabled={busy}>Cancel</Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SettingsTab({ toast }) {
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(null);
  const [mail, setMail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await endpoints.adminSettings();
      setSettings(data.settings);
      setMail(data.mail);
      setForm({
        registration_open: data.settings.registration_open,
        maintenance_mode: data.settings.maintenance_mode,
        maintenance_message: data.settings.maintenance_message,
        require_email_verification: data.settings.require_email_verification,
        public_directory: data.settings.public_directory,
        max_upload_mb: String(data.settings.max_upload_mb),
        support_email: data.settings.support_email
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        max_upload_mb: Number(form.max_upload_mb)
      };
      const data = await endpoints.adminUpdateSettings(payload);
      setSettings(data.settings);
      toast.success('Settings saved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading && !form) {
    return <div className="page-loading"><Spinner size={22} /> Loading settings…</div>;
  }
  if (error && !form) return <Alert tone="error">{error}</Alert>;
  if (!form) return null;

  return (
    <div className="admin-stack">
      {form.maintenance_mode ? (
        <Alert tone="warning" title="Maintenance mode is on">
          Members see a maintenance screen and member API calls return 503. Sign-in, health, notices
          and this console stay available so you can finish the work.
        </Alert>
      ) : null}

      <form className="admin-card settings-form" onSubmit={save}>
        <header className="admin-card-head">
          <h2>Site behaviour</h2>
          <span className="admin-muted">Changes take effect within seconds.</span>
        </header>

        <div className="settings-toggles">
          <Switch
            checked={form.registration_open}
            onChange={(value) => setForm({ ...form, registration_open: value })}
            label="Registration open"
            description="Allow visitors to create new accounts."
          />
          <Switch
            checked={form.require_email_verification}
            onChange={(value) => setForm({ ...form, require_email_verification: value })}
            label="Require email verification"
            description="New members must confirm their address before signing in. Existing verified accounts are unaffected."
          />
          <Switch
            checked={form.public_directory}
            onChange={(value) => setForm({ ...form, public_directory: value })}
            label="Public member directory"
            description="Let members find each other in Discover. Private profiles remain hidden."
          />
          <Switch
            checked={form.maintenance_mode}
            onChange={(value) => setForm({ ...form, maintenance_mode: value })}
            label="Maintenance mode"
            description="Pause member traffic while keeping the console reachable."
          />
        </div>

        <div className="settings-grid">
          <Field label="Maintenance message" hint="Shown on the maintenance screen and in API errors.">
            <input maxLength={300} value={form.maintenance_message} onChange={(event) => setForm({ ...form, maintenance_message: event.target.value })} />
          </Field>
          <Field label="Support email" hint="Used in account and security emails.">
            <input type="email" value={form.support_email} onChange={(event) => setForm({ ...form, support_email: event.target.value })} />
          </Field>
        </div>

        <div className="settings-grid">
          <Field label="Maximum upload size (MB)" hint="Between 1 and 100 MB.">
            <input type="number" min="1" max="100" value={form.max_upload_mb} onChange={(event) => setForm({ ...form, max_upload_mb: event.target.value })} />
          </Field>
          <Field label="Mail delivery">
            <input value={mail?.mode === 'smtp' ? 'SMTP configured' : mail?.mode === 'development' ? 'Development (outbox only)' : 'Disabled'} readOnly />
          </Field>
        </div>

        <div className="settings-actions">
          <Button type="submit" icon={Save} loading={saving}>Save settings</Button>
          <Button type="button" variant="ghost" icon={RefreshCw} onClick={load} disabled={saving}>Reload</Button>
        </div>
      </form>

      {settings ? (
        <section className="admin-card">
          <header className="admin-card-head"><h2>Effective configuration</h2></header>
          <dl className="admin-facts">
            <div><dt>Registration</dt><dd>{settings.registration_open ? 'Open' : 'Closed'}</dd></div>
            <div><dt>Email verification</dt><dd>{settings.require_email_verification ? 'Required' : 'Optional'}</dd></div>
            <div><dt>Directory</dt><dd>{settings.public_directory ? 'Public' : 'Hidden'}</dd></div>
            <div><dt>Maintenance</dt><dd>{settings.maintenance_mode ? 'Active' : 'Off'}</dd></div>
            <div><dt>Upload limit</dt><dd>{settings.max_upload_mb} MB</dd></div>
            <div><dt>Support email</dt><dd>{settings.support_email}</dd></div>
          </dl>
        </section>
      ) : null}
    </div>
  );
}

function AuditTab({ toast }) {
  const [logs, setLogs] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (action.trim()) params.set('action', action.trim());
      const data = await endpoints.adminAudit(`?${params}`);
      setLogs(data.logs || []);
      setPagination(data.pagination);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [action, page]);

  useEffect(() => {
    const timer = setTimeout(load, action ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, action]);

  return (
    <div className="admin-stack">
      <div className="admin-filters">
        <div className="search-box">
          <Search size={18} />
          <input
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setPage(1);
            }}
            placeholder="Filter by action, e.g. user.suspend"
            aria-label="Filter audit log"
          />
          {loading ? <InlineSpinner size={16} /> : null}
        </div>
        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={load} loading={loading}>
          Refresh
        </Button>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {loading && logs.length === 0 ? (
        <div className="page-loading">
          <Spinner size={20} /> Loading audit log…
        </div>
      ) : logs.length === 0 ? (
        <EmptyState icon={ScrollText} title="No audit entries" description="Administrative actions will be recorded here." compact />
      ) : (
        <div className="admin-audit-list">
          {logs.map((entry) => (
            <article className="admin-audit-row" key={entry.id}>
              <span className="admin-audit-icon">
                <ScrollText size={15} />
              </span>
              <div className="admin-audit-copy">
                <strong>{entry.action}</strong>
                <span>
                  {entry.admin?.displayName || entry.admin?.username || 'system'}
                  {entry.targetType ? ` · ${entry.targetType}` : ''}
                  {entry.targetId ? ` ${entry.targetId.slice(0, 8)}…` : ''}
                </span>
                {entry.metadata && Object.keys(entry.metadata).length ? (
                  <em>{truncate(JSON.stringify(entry.metadata), 160)}</em>
                ) : null}
              </div>
              <div className="admin-audit-meta">
                <span>{timeAgo(entry.createdAt)}</span>
                {entry.ip ? <em>{entry.ip}</em> : null}
              </div>
            </article>
          ))}
        </div>
      )}

      {pagination && pagination.total > pagination.limit ? (
        <div className="admin-pagination">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Previous
          </Button>
          <span>
            Page {pagination.page} · {pagination.total} entries
          </span>
          <Button variant="secondary" size="sm" disabled={!pagination.hasMore} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SystemTab({ toast }) {
  const [health, setHealth] = useState(null);
  const [storage, setStorage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionBusy, setActionBusy] = useState('');
  const [lastAction, setLastAction] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [healthData, storageData] = await Promise.all([endpoints.adminSystem(), endpoints.adminStorage()]);
      setHealth(healthData);
      setStorage(storageData);
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function runAction(type) {
    setActionBusy(type);
    try {
      const result = type === 'flush' ? await endpoints.adminFlushCache() : await endpoints.adminCleanup();
      setLastAction({ type, result });
      toast.success(type === 'flush' ? `Cleared ${result.removed ?? 0} rate-limit keys` : 'Cleanup complete');
      setConfirm(null);
      await load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setActionBusy('');
    }
  }

  const checks = health?.checks;
  const nodes = useMemo(() => {
    if (!checks) return [];
    return [
      {
        key: 'database',
        label: 'PostgreSQL',
        ok: checks.database?.ok,
        detail: checks.database?.ok ? `${checks.database.latencyMs} ms` : checks.database?.error || 'Unavailable',
        icon: Database
      },
      {
        key: 'redis',
        label: 'Redis',
        ok: checks.redis?.ok,
        detail: checks.redis?.ok ? `${checks.redis.latencyMs ?? '—'} ms` : 'Unavailable',
        icon: Activity
      },
      {
        key: 'storage',
        label: 'Media storage',
        ok: checks.storage?.ok,
        detail: checks.storage?.ok
          ? `${fileSize(checks.storage.freeBytes)} free of ${fileSize(checks.storage.totalBytes)}`
          : 'Unavailable',
        icon: HardDrive
      }
    ];
  }, [checks]);

  if (loading && !health) {
    return (
      <div className="page-loading">
        <Spinner size={22} /> Checking system health…
      </div>
    );
  }

  if (error && !health) return <Alert tone="error">{error}</Alert>;

  const runtime = health?.runtime;
  const configInfo = health?.config;

  return (
    <div className="admin-stack">
      <div className="admin-toolbar">
        <Badge tone={health?.status === 'ok' ? 'success' : 'warning'}>
          {health?.status === 'ok' ? 'All systems healthy' : 'Degraded'}
        </Badge>
        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={load} loading={loading}>
          Re-check
        </Button>
      </div>

      <section className="admin-card">
        <header className="admin-card-head">
          <h2>Developer actions</h2>
          <span className="admin-muted">Restricted to administrators. Every run is audited.</span>
        </header>
        <div className="admin-action-grid">
          <Button variant="secondary" size="sm" icon={RefreshCw} loading={actionBusy === 'flush'} onClick={() => setConfirm({ type: 'flush', title: 'Flush cached rate limits?', description: 'This clears Redis rate-limit buckets and reloads runtime settings. It does not delete user data.', label: 'Flush cache', tone: 'primary' })}>
            Flush rate-limit cache
          </Button>
          <Button variant="secondary" size="sm" icon={Trash2} loading={actionBusy === 'cleanup'} onClick={() => setConfirm({ type: 'cleanup', title: 'Run data cleanup?', description: 'Expires old sessions and removes stale reset tokens, verification codes, old notifications, and old mail bodies.', label: 'Run cleanup', tone: 'primary' })}>
            Run data cleanup
          </Button>
        </div>
        {lastAction ? (
          <p className="admin-muted">
            Last run: {lastAction.type === 'flush' ? 'cache flush' : 'cleanup'} ·{' '}
            {Object.entries(lastAction.result || {})
              .filter(([key]) => key !== 'ok' && key !== 'message')
              .map(([key, value]) => `${key}: ${value}`)
              .join(' · ')}
          </p>
        ) : null}
      </section>

      <div className="health-grid">
        {nodes.map((node) => {
          const Icon = node.icon;
          return (
            <article className={`health-card ${node.ok ? 'is-ok' : 'is-bad'}`} key={node.key}>
              <span className="health-icon">
                <Icon size={19} />
              </span>
              <div>
                <strong>{node.label}</strong>
                <span>{node.detail}</span>
              </div>
              <span className="health-dot" aria-label={node.ok ? 'Healthy' : 'Unhealthy'}>
                {node.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              </span>
            </article>
          );
        })}
      </div>

      <div className="admin-columns">
        <section className="admin-card">
          <header className="admin-card-head">
            <h2>Runtime</h2>
          </header>
          <dl className="admin-facts">
            <div>
              <dt>Version</dt>
              <dd>{runtime?.version || '—'}</dd>
            </div>
            <div>
              <dt>Environment</dt>
              <dd>{runtime?.env || '—'}</dd>
            </div>
            <div>
              <dt>Node</dt>
              <dd>{runtime?.node || '—'}</dd>
            </div>
            <div>
              <dt>Uptime</dt>
              <dd>{formatUptime(runtime?.uptimeSeconds)}</dd>
            </div>
            <div>
              <dt>Online users</dt>
              <dd>{runtime?.onlineUsers ?? 0}</dd>
            </div>
            <div>
              <dt>Database</dt>
              <dd>{health?.database?.name || '—'}</dd>
            </div>
          </dl>
        </section>

        <section className="admin-card">
          <header className="admin-card-head">
            <h2>Configuration</h2>
          </header>
          <dl className="admin-facts">
            <div>
              <dt>Port</dt>
              <dd>{configInfo?.port ?? '—'}</dd>
            </div>
            <div>
              <dt>Public URL</dt>
              <dd>{configInfo?.publicUrl || '—'}</dd>
            </div>
            <div>
              <dt>Registration</dt>
              <dd>{health?.settings?.registration_open ?? configInfo?.registrationOpen ? 'Open' : 'Closed'}</dd>
            </div>
            <div>
              <dt>Max upload</dt>
              <dd>{configInfo?.maxUploadMb ? `${configInfo.maxUploadMb} MB` : '—'}</dd>
            </div>
            <div>
              <dt>SMTP</dt>
              <dd>{configInfo?.smtpConfigured ? 'Configured' : 'Not configured'}</dd>
            </div>
            <div>
              <dt>Web push</dt>
              <dd>{configInfo?.pushConfigured ? 'Configured' : 'Not configured'}</dd>
            </div>
            <div>
              <dt>TURN</dt>
              <dd>{configInfo?.turnConfigured ? 'Configured' : 'STUN only'}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="admin-card">
        <header className="admin-card-head">
          <h2>Storage by user</h2>
          <span className="admin-muted">
            {storage?.total ? `${fileSize(storage.total.bytes)} across ${storage.total.count} files` : 'No media yet'}
          </span>
        </header>
        {storage?.users?.length ? (
          <div className="admin-mini-list">
            {storage.users.map((person) => (
              <div className="admin-mini-row" key={person.id}>
                <Avatar name={person.displayName || person.username} size={32} />
                <span>
                  <strong>{person.displayName || person.username}</strong>
                  <em>
                    @{person.username} · {person.files} file{person.files === 1 ? '' : 's'}
                  </em>
                </span>
                <Badge tone="neutral">{fileSize(person.bytes)}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="admin-muted">No user has uploaded media yet.</p>
        )}
      </section>

      <section className="admin-card">
        <header className="admin-card-head">
          <h2>Applied migrations</h2>
        </header>
        {health?.migrations?.length ? (
          <div className="migration-list">
            {health.migrations.map((migration) => (
              <div className="migration-row" key={migration.name}>
                <CheckCircle2 size={14} />
                <strong>{migration.name}</strong>
                <span>{fullDate(migration.applied_at)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="admin-muted">No migration metadata available.</p>
        )}
      </section>

      {health?.status !== 'ok' ? (
        <Alert tone="warning" title="Degraded service">
          One or more dependencies are unhealthy. Check the service logs and systemd status.
        </Alert>
      ) : null}

      <ConfirmDialog
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => runAction(confirm.type)}
        loading={Boolean(actionBusy)}
        tone={confirm?.tone || 'primary'}
        title={confirm?.title}
        description={confirm?.description}
        confirmLabel={confirm?.label}
      />
    </div>
  );
}
