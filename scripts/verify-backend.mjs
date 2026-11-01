#!/usr/bin/env node
/**
 * End-to-end verification against a running MinChat API.
 *
 *   node scripts/verify-backend.mjs [baseUrl]
 *
 * Requires .env with DATABASE_URL and the demo accounts (alice/bob) plus the
 * administrator credentials. Prints PASS/FAIL per check and exits non-zero on
 * failure. Safe to re-run: it cleans up the records it creates.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envText = fs.readFileSync(path.join(root, '.env'), 'utf8');
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
}

const BASE = process.argv[2] || `http://127.0.0.1:${process.env.PORT || 5050}`;
const ADMIN = { identifier: process.env.ADMIN_USERNAME || 'johirxofficial', password: process.env.ADMIN_PASSWORD };
const ALICE = { identifier: 'alice', password: 'correct horse battery' };
const BOB = { identifier: 'bob', password: 'correct horse battery' };

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

let failures = 0;
const results = [];
function check(name, condition, detail = '') {
  const pass = Boolean(condition);
  if (!pass) failures += 1;
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  return pass;
}

class Session {
  constructor(label) {
    this.label = label;
    this.jar = new Map();
  }
  cookies() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  absorb(res) {
    for (const cookie of res.headers.getSetCookie?.() ?? []) {
      const [pair] = cookie.split(';');
      const i = pair.indexOf('=');
      if (i > 0) this.jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
  }
  async req(method, endpoint, body, { csrf = true } = {}) {
    const headers = { origin: BASE, cookie: this.cookies() };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (csrf && this.jar.has('minchat_csrf')) headers['x-csrf-token'] = this.jar.get('minchat_csrf');
    const res = await fetch(BASE + endpoint, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    this.absorb(res);
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data };
  }
  async login(creds) {
    return this.req('POST', '/api/auth/login', creds, { csrf: false });
  }
}

async function latestMail(to) {
  const rows = await db.query(
    `SELECT id, template, text_body, status FROM mail_outbox WHERE to_email=$1 ORDER BY created_at DESC LIMIT 1`,
    [to]
  );
  return rows.rows[0] ?? null;
}

const admin = new Session('admin');
const alice = new Session('alice');
const bob = new Session('bob');

// ---------------------------------------------------------------------------
// Authentication and roles
// ---------------------------------------------------------------------------
const adminLogin = await admin.login(ADMIN);
check('admin can sign in', adminLogin.status === 200, `status ${adminLogin.status}`);
check(
  'admin receives every capability',
  adminLogin.data?.user?.capabilities?.includes('developer.access') &&
    adminLogin.data.user.capabilities.includes('users.delete')
);

const aliceLogin = await alice.login(ALICE);
check('alice can sign in', aliceLogin.status === 200, `status ${aliceLogin.status}`);
check('member has no console capabilities', Array.isArray(aliceLogin.data?.user?.capabilities) && aliceLogin.data.user.capabilities.length === 0);

const bobLogin = await bob.login(BOB);
check('bob can sign in', bobLogin.status === 200, `status ${bobLogin.status}`);

const bobId = bobLogin.data?.user?.id;
const aliceId = aliceLogin.data?.user?.id;
check('accounts resolved', Boolean(bobId && aliceId));

// ---------------------------------------------------------------------------
// Notices: create → publish → member sees → dismiss → archive
// ---------------------------------------------------------------------------
const marker = `verify-${Date.now()}`;
const created = await admin.req('POST', '/api/admin/notices', {
  title: `Scheduled maintenance ${marker}`,
  body: 'We are testing the announcement banner. Nothing will break.',
  level: 'info',
  audience: 'everyone',
  status: 'draft',
  pinned: true,
  dismissible: true
});
const noticeId = created.data?.notice?.id;
check('admin can create a draft notice', created.status === 201 && Boolean(noticeId), `status ${created.status}`);

const published = await admin.req('POST', `/api/admin/notices/${noticeId}/publish`, { sendEmail: false });
check('admin can publish a notice', published.status === 200 && published.data?.notice?.status === 'published');

const memberNotices = await alice.req('GET', '/api/notices');
const visible = memberNotices.data?.notices?.find((n) => n.id === noticeId);
check('member sees the published notice above chats', Boolean(visible), `count ${memberNotices.data?.notices?.length}`);

const dismissed = await alice.req('POST', `/api/notices/${noticeId}/dismiss`);
check('member can dismiss the notice', dismissed.status === 200 && dismissed.data?.dismissed === true);

const afterDismiss = await alice.req('GET', '/api/notices');
check(
  'dismissed notice no longer appears',
  !afterDismiss.data?.notices?.some((n) => n.id === noticeId)
);

// Non-dismissible notice stays visible even after other dismissals.
const permanent = await admin.req('POST', '/api/admin/notices', {
  title: `Permanent banner ${marker}`,
  body: 'This announcement cannot be dismissed.',
  level: 'warning',
  audience: 'everyone',
  status: 'published',
  pinned: false,
  dismissible: false
});
const permanentId = permanent.data?.notice?.id;
const withPermanent = await alice.req('GET', '/api/notices');
check(
  'non-dismissible notice stays visible',
  withPermanent.data?.notices?.some((n) => n.id === permanentId)
);

const archived = await admin.req('POST', `/api/admin/notices/${noticeId}/archive`);
check('admin can archive a notice', archived.status === 200 && archived.data?.notice?.status === 'archived');
await admin.req('DELETE', `/api/admin/notices/${permanentId}`);

// ---------------------------------------------------------------------------
// Role management and hierarchy enforcement
// ---------------------------------------------------------------------------
const promote = await admin.req('PATCH', `/api/admin/users/${bobId}`, { role: 'staff' });
check('admin can promote a member to staff', promote.status === 200 && promote.data?.changes?.role === 'staff');

const bobStaff = await bob.req('GET', '/api/auth/me');
check(
  'promoted member gains console capabilities',
  bobStaff.data?.user?.capabilities?.includes('console.access') &&
    bobStaff.data.user.capabilities.includes('reports.review')
);

const staffStats = await bob.req('GET', '/api/admin/stats');
check('staff can read the console overview', staffStats.status === 200);

const staffSuspend = await bob.req('PATCH', `/api/admin/users/${aliceId}`, { status: 'suspended' });
check('staff cannot suspend accounts', staffSuspend.status === 403, `status ${staffSuspend.status}`);

const staffSettings = await bob.req('GET', '/api/admin/settings');
check('staff cannot read runtime settings', staffSettings.status === 403, `status ${staffSettings.status}`);

const restoreRole = await admin.req('PATCH', `/api/admin/users/${bobId}`, { role: 'user' });
check('admin can restore the member role', restoreRole.status === 200 && restoreRole.data?.changes?.role === 'user');

// ---------------------------------------------------------------------------
// Suspension, session revocation, restoration
// ---------------------------------------------------------------------------
const suspend = await admin.req('PATCH', `/api/admin/users/${bobId}`, { status: 'suspended' });
check('admin can suspend an account', suspend.status === 200 && suspend.data?.changes?.status === 'suspended');

const bobRevoked = await bob.req('GET', '/api/auth/me');
check('suspension revokes active sessions', bobRevoked.status === 401, `status ${bobRevoked.status}`);

const bobBlockedLogin = await bob.login(BOB);
check('suspended account cannot sign in', bobBlockedLogin.status === 403, `status ${bobBlockedLogin.status}`);

const restore = await admin.req('PATCH', `/api/admin/users/${bobId}`, { status: 'active' });
check('admin can restore an account', restore.status === 200 && restore.data?.changes?.status === 'active');

const bobAgain = await bob.login(BOB);
check('restored account can sign in', bobAgain.status === 200);

const suspendMail = await latestMail('bob@example.com');
check('suspension sends an account email', Boolean(suspendMail), suspendMail?.template);

// ---------------------------------------------------------------------------
// Phone number: add → code from outbox → verify → remove
// ---------------------------------------------------------------------------
const phone = `+88017${String(Date.now()).slice(-8)}`;
const phoneRequest = await alice.req('PATCH', '/api/users/me/phone', { phone });
check('member can request phone verification', phoneRequest.status === 202, `status ${phoneRequest.status}`);

const phoneMail = await latestMail('alice@example.com');
const code = phoneMail?.text_body?.match(/\b([0-9]{6})\b/)?.[1];
check('verification email is queued with a code', Boolean(code), phoneMail?.template);

const wrongCode = await alice.req('POST', '/api/users/me/phone/verify', { code: '000000' });
check('incorrect phone code is rejected', wrongCode.status === 400, `status ${wrongCode.status}`);

const phoneVerify = await alice.req('POST', '/api/users/me/phone/verify', { code });
check('correct phone code links the number', phoneVerify.status === 200 && phoneVerify.data?.me?.user?.phone === phone);

const meWithPhone = await alice.req('GET', '/api/auth/me');
check('phone is exposed on the member profile', meWithPhone.data?.user?.phone === phone && Boolean(meWithPhone.data.user.phoneVerifiedAt));

const removePhone = await alice.req('DELETE', '/api/users/me/phone', { password: ALICE.password });
check('member can remove the phone number', removePhone.status === 200 && removePhone.data?.me?.user?.phone === null);

// ---------------------------------------------------------------------------
// Password reset through the mail queue
// ---------------------------------------------------------------------------
const forgot = await alice.req('POST', '/api/auth/password/forgot', { email: 'alice@example.com' }, { csrf: false });
check('password reset request is accepted', forgot.status === 200);

const resetMail = await latestMail('alice@example.com');
const resetToken = resetMail?.text_body?.match(/token=([A-Za-z0-9_-]+)/)?.[1];
check('reset email contains a token', Boolean(resetToken), resetMail?.template);

const tempPassword = 'Temporary!Passw0rd-2026';
if (resetToken) {
  const reset = await alice.req(
    'POST',
    '/api/auth/password/reset',
    { token: resetToken, password: tempPassword },
    { csrf: false }
  );
  check('password can be reset with the emailed token', reset.status === 200, `status ${reset.status}`);

  const oldLogin = await new Session('alice-old').login(ALICE);
  check('old password stops working', oldLogin.status === 401, `status ${oldLogin.status}`);

  const tempLogin = await new Session('alice-temp').login({ identifier: 'alice', password: tempPassword });
  check('new password works', tempLogin.status === 200, `status ${tempLogin.status}`);

  // Restore the fixture password for later runs.
  const restoreForgot = await new Session('alice-restore').req(
    'POST',
    '/api/auth/password/forgot',
    { email: 'alice@example.com' },
    { csrf: false }
  );
  if (restoreForgot.status === 200) {
    const restoreMail = await latestMail('alice@example.com');
    const token2 = restoreMail?.text_body?.match(/token=([A-Za-z0-9_-]+)/)?.[1];
    if (token2) {
      const back = await new Session('alice-back').req(
        'POST',
        '/api/auth/password/reset',
        { token: token2, password: ALICE.password },
        { csrf: false }
      );
      check('fixture password restored', back.status === 200);
    }
  }
}

// ---------------------------------------------------------------------------
// Registration switch and maintenance mode
// ---------------------------------------------------------------------------
const closeRegistration = await admin.req('PATCH', '/api/admin/settings', { registration_open: false });
check('admin can close registration', closeRegistration.status === 200);

const blockedRegister = await new Session('new').req(
  'POST',
  '/api/auth/register',
  {
    username: `nobody_${Date.now().toString().slice(-6)}`,
    email: `nobody_${Date.now()}@example.com`,
    password: 'Another!StrongPassw0rd',
    displayName: 'Nobody'
  },
  { csrf: false }
);
check('closed registration rejects new accounts', blockedRegister.status === 403, `status ${blockedRegister.status}`);

await admin.req('PATCH', '/api/admin/settings', { registration_open: true });

const maintenanceOn = await admin.req('PATCH', '/api/admin/settings', { maintenance_mode: true });
check('admin can enable maintenance mode', maintenanceOn.status === 200);

const memberDuringMaintenance = await alice.req('GET', '/api/conversations');
check('members are paused during maintenance', memberDuringMaintenance.status === 503, `status ${memberDuringMaintenance.status}`);

const adminDuringMaintenance = await admin.req('GET', '/api/admin/stats');
check('staff console stays reachable during maintenance', adminDuringMaintenance.status === 200);

const healthDuring = await fetch(`${BASE}/api/health`).then((r) => r.json());
check('health endpoint reports maintenance state', healthDuring.maintenance?.active === true);

await admin.req('PATCH', '/api/admin/settings', { maintenance_mode: false });

// ---------------------------------------------------------------------------
// Developer tooling
// ---------------------------------------------------------------------------
const flush = await admin.req('POST', '/api/admin/system/cache/flush');
check('developer can flush rate-limit cache', flush.status === 200);

const cleanup = await admin.req('POST', '/api/admin/system/cleanup');
check('developer can run data cleanup', cleanup.status === 200 && typeof cleanup.data?.expiredSessions === 'number');

const mailList = await admin.req('GET', '/api/admin/mail?status=all&limit=5');
check('mail console lists outbox messages', mailList.status === 200 && Array.isArray(mailList.data?.mail), `total ${mailList.data?.total}`);

const auditSettings = await admin.req('GET', '/api/admin/audit-logs?action=settings.update&limit=10');
const auditNotices = await admin.req('GET', '/api/admin/audit-logs?action=notice.publish&limit=10');
const seenActions = [
  ...(auditSettings.data?.logs ?? []).map((l) => l.action),
  ...(auditNotices.data?.logs ?? []).map((l) => l.action)
];
check(
  'audit log records administrative actions',
  seenActions.includes('settings.update') && seenActions.includes('notice.publish'),
  `actions ${[...new Set(seenActions)].join(', ')}`
);

// ---------------------------------------------------------------------------
// Cleanup fixture rows
// ---------------------------------------------------------------------------
await db.query("DELETE FROM notices WHERE title LIKE $1", [`%${marker}%`]);
await db.query('DELETE FROM mail_outbox WHERE to_email=$1 AND template=$2', ['alice@example.com', 'phoneCode']);
await db.query("DELETE FROM admin_audit_logs WHERE created_at > now() - interval '15 minutes' AND action IN ('system.cache_flush','settings.update')");

await db.end();

console.log(`\n${results.length - failures}/${results.length} checks passed.`);
process.exit(failures ? 1 : 0);
