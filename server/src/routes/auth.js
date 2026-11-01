import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { one, query, withTransaction } from '../db.js';
import { asyncHandler, badRequest, conflict, forbidden, notFound, unauthorized } from '../lib/errors.js';
import {
  emailSchema,
  passwordIssues,
  passwordSchema,
  trimmed,
  usernameSchema,
  validate
} from '../lib/validate.js';
import { hashPassword, randomToken, sha256, verifyDummyPassword, verifyPassword } from '../lib/tokens.js';
import {
  clearSessionCookies,
  createSession,
  csrfProtection,
  requireAuth,
  revokeAllSessions,
  revokeOtherSessions,
  revokeSession
} from '../middleware/auth.js';
import { loginLimiter, rateLimit, registerLimiter } from '../middleware/rateLimit.js';
import { enqueueMail } from '../lib/mail.js';
import { disconnectSessions } from '../realtime.js';
import { loadMe } from '../lib/me.js';
import { getSettings } from '../lib/settings.js';

export const authRouter = Router();

authRouter.post(
  '/register',
  registerLimiter,
  validate(
    z.object({
      email: emailSchema,
      username: usernameSchema,
      password: passwordSchema,
      displayName: trimmed(60)
    })
  ),
  asyncHandler(async (req, res) => {
    const settings = await getSettings();
    if (!settings.registration_open) {
      throw forbidden('Registration is currently closed', 'REGISTRATION_CLOSED');
    }
    const { email, username, password, displayName } = req.body;
    const issues = passwordIssues(password, { username, email });
    if (issues.length) throw badRequest(issues[0], 'WEAK_PASSWORD', { password: issues[0] });

    const passwordHash = await hashPassword(password);
    let userId;
    try {
      userId = await withTransaction(async (client) => {
        const inserted = await client.query(
          `INSERT INTO users (username, email, password_hash) VALUES ($1,$2,$3) RETURNING id`,
          [username, email, passwordHash]
        );
        const id = inserted.rows[0].id;
        await client.query(
          `INSERT INTO user_profiles (user_id, display_name) VALUES ($1,$2)`,
          [id, displayName || username]
        );
        return id;
      });
    } catch (err) {
      if (err.code === '23505') {
        throw conflict('That username or email is already in use', 'ACCOUNT_EXISTS');
      }
      throw err;
    }

    // Welcome mail always links to email verification; a separate reminder is
    // only needed when the deployment requires a confirmed address.
    const verifyToken = randomToken(32);
    await query(
      `UPDATE email_verification_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL`,
      [userId]
    );
    await query(
      `INSERT INTO email_verification_tokens (user_id, token_hash, email, expires_at)
       VALUES ($1,$2,$3, now() + interval '24 hours')`,
      [userId, sha256(verifyToken), email]
    );
    const verifyUrl = `${config.publicUrl}/verify-email?token=${encodeURIComponent(verifyToken)}`;

    await enqueueMail({
      to: email,
      userId,
      template: 'welcome',
      data: {
        username,
        displayName: displayName || username,
        verifyUrl,
        supportEmail: settings.support_email
      },
      meta: { kind: 'account' }
    }).catch(() => {});

    if (settings.require_email_verification) {
      return res.status(202).json({
        verificationRequired: true,
        email,
        message: 'Check your inbox to confirm your email address before signing in.'
      });
    }

    const { csrfToken } = await createSession(userId, req, res);
    req.auth = { user: { id: userId, role: 'user' }, csrfToken };
    const me = await loadMe(userId, csrfToken);
    res.status(201).json(me);
  })
);

authRouter.post(
  '/login',
  loginLimiter,
  validate(
    z.object({
      identifier: z.string().trim().min(1).max(254),
      password: z.string().min(1).max(200)
    })
  ),
  asyncHandler(async (req, res) => {
    const { identifier, password } = req.body;
    const normalized = identifier.trim();
    const isEmail = normalized.includes('@');
    const isPhone = /^\+[0-9][0-9\s().-]{6,}$/.test(normalized);
    const phone = isPhone ? normalized.replace(/[\s().-]/g, '') : null;
    const user = await one(
      `SELECT u.*, p.display_name FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id
        WHERE ${isEmail ? 'u.email=$1' : isPhone ? 'u.phone=$1' : 'u.username=$1'}`,
      [isEmail ? normalized.toLowerCase() : isPhone ? phone : normalized.toLowerCase()]
    );

    if (!user) {
      await verifyDummyPassword(password);
      throw unauthorized('Incorrect username or password', 'INVALID_CREDENTIALS');
    }
    if (user.status === 'suspended') {
      throw forbidden('This account is suspended. Contact the administrator.', 'ACCOUNT_SUSPENDED');
    }
    if (user.status !== 'active') {
      throw unauthorized('Incorrect username or password', 'INVALID_CREDENTIALS');
    }
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
      throw Object.assign(
        new Error('Too many failed attempts. This account is temporarily locked.'),
        { status: 429, code: 'ACCOUNT_LOCKED' }
      );
    }

    const ok = await verifyPassword(user.password_hash, password);
    if (!ok) {
      const attempts = user.failed_login_attempts + 1;
      const lock = attempts >= 5;
      await query(
        `UPDATE users SET failed_login_attempts=$2, locked_until=$3 WHERE id=$1`,
        [user.id, lock ? 0 : attempts, lock ? new Date(Date.now() + 15 * 60_000) : user.locked_until]
      );
      if (lock) {
        throw Object.assign(
          new Error('Too many failed attempts. This account is locked for 15 minutes.'),
          { status: 429, code: 'ACCOUNT_LOCKED' }
        );
      }
      throw unauthorized('Incorrect username or password', 'INVALID_CREDENTIALS');
    }

    const settings = await getSettings();
    if (
      settings.require_email_verification &&
      !user.email_verified_at &&
      user.role === 'user'
    ) {
      throw forbidden(
        'Confirm your email address before signing in. Check your inbox for the verification link.',
        'EMAIL_NOT_VERIFIED'
      );
    }

    const previousIp = user.last_login_ip ? String(user.last_login_ip) : null;
    const currentIp = req.ip ?? null;
    const currentAgent = String(req.headers['user-agent'] || '').slice(0, 300);

    await query(
      `UPDATE users SET failed_login_attempts=0, locked_until=NULL, last_active_at=now(),
              last_login_at=now(), last_login_ip=$2
        WHERE id=$1`,
      [user.id, currentIp]
    );

    // Alert the owner when a sign-in comes from a new address. Fire and forget:
    // mail must never slow down or break authentication.
    if (previousIp && currentIp && previousIp !== currentIp) {
      enqueueMail({
        to: user.email,
        userId: user.id,
        template: 'loginAlert',
        data: {
          username: user.display_name || user.username,
          at: new Date().toUTCString(),
          ip: currentIp,
          device: currentAgent
        },
        meta: { kind: 'security' }
      }).catch(() => {});
    }

    const { csrfToken } = await createSession(user.id, req, res);
    req.auth = { user: { id: user.id, role: user.role }, csrfToken };
    const me = await loadMe(user.id, csrfToken);
    res.json(me);
  })
);

authRouter.post(
  '/logout',
  requireAuth,
  csrfProtection,
  asyncHandler(async (req, res) => {
    await revokeSession(req.auth.sessionId, req.auth.user.id);
    clearSessionCookies(res);
    res.json({ ok: true });
  })
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await loadMe(req.auth.user.id, req.auth.csrfToken));
  })
);

authRouter.post(
  '/email/verify',
  rateLimit({ name: 'email-verify', windowMs: 60 * 60_000, max: 20, message: 'Too many attempts.' }),
  validate(z.object({ token: z.string().min(20).max(200) })),
  asyncHandler(async (req, res) => {
    const row = await one(
      `SELECT evt.*, u.email AS current_email FROM email_verification_tokens evt
         JOIN users u ON u.id=evt.user_id
        WHERE evt.token_hash=$1 AND evt.used_at IS NULL AND evt.expires_at > now()
          AND u.status='active'`,
      [sha256(req.body.token)]
    );
    if (!row) throw badRequest('This verification link is invalid or has expired', 'INVALID_VERIFY_TOKEN');
    if (String(row.email).toLowerCase() !== String(row.current_email).toLowerCase()) {
      throw badRequest('This link was issued for a different email address', 'EMAIL_CHANGED');
    }
    await withTransaction(async (client) => {
      await client.query('UPDATE email_verification_tokens SET used_at=now() WHERE id=$1', [row.id]);
      await client.query(
        'UPDATE users SET email_verified_at=now() WHERE id=$1 AND email_verified_at IS NULL',
        [row.user_id]
      );
    });
    res.json({ ok: true, message: 'Email confirmed. Thank you.' });
  })
);

authRouter.post(
  '/email/resend',
  requireAuth,
  csrfProtection,
  rateLimit({ name: 'email-resend', windowMs: 60 * 60_000, max: 5, message: 'Too many verification emails requested.' }),
  asyncHandler(async (req, res) => {
    const user = await one(
      `SELECT u.id, u.email, u.username, u.email_verified_at, p.display_name
         FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id
        WHERE u.id=$1 AND u.status='active'`,
      [req.auth.user.id]
    );
    if (!user) throw unauthorized();
    if (user.email_verified_at) return res.json({ ok: true, alreadyVerified: true });

    const token = randomToken(32);
    await query(
      'UPDATE email_verification_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL',
      [user.id]
    );
    await query(
      `INSERT INTO email_verification_tokens (user_id, token_hash, email, expires_at)
       VALUES ($1,$2,$3, now() + interval '24 hours')`,
      [user.id, sha256(token), user.email]
    );
    const settings = await getSettings();
    await enqueueMail({
      to: user.email,
      userId: user.id,
      template: 'verifyEmail',
      data: {
        username: user.display_name || user.username,
        verifyUrl: `${config.publicUrl}/verify-email?token=${encodeURIComponent(token)}`
      },
      meta: { kind: 'account' }
    });
    res.json({ ok: true, message: 'Verification email sent.' });
  })
);

authRouter.post(
  '/email/resend-link',
  rateLimit({ name: 'email-resend-public', windowMs: 60 * 60_000, max: 5, message: 'Too many verification emails requested.' }),
  validate(z.object({ email: emailSchema })),
  asyncHandler(async (req, res) => {
    const user = await one(
      `SELECT u.id, u.email, u.username, u.email_verified_at, u.status, p.display_name
         FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id
        WHERE u.email=$1`,
      [req.body.email]
    );
    if (user && user.status === 'active' && !user.email_verified_at) {
      const token = randomToken(32);
      await query(
        'UPDATE email_verification_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL',
        [user.id]
      );
      await query(
        `INSERT INTO email_verification_tokens (user_id, token_hash, email, expires_at)
         VALUES ($1,$2,$3, now() + interval '24 hours')`,
        [user.id, sha256(token), user.email]
      );
      await enqueueMail({
        to: user.email,
        userId: user.id,
        template: 'verifyEmail',
        data: {
          username: user.display_name || user.username,
          verifyUrl: `${config.publicUrl}/verify-email?token=${encodeURIComponent(token)}`
        },
        meta: { kind: 'account' }
      }).catch(() => {});
    }
    // Always the same response so this endpoint cannot enumerate accounts.
    res.json({ ok: true, message: 'If that address needs confirmation, a new link is on its way.' });
  })
);

authRouter.post(
  '/password/forgot',
  rateLimit({ name: 'forgot-password', windowMs: 60 * 60_000, max: 10, message: 'Too many reset requests.' }),
  validate(z.object({ email: emailSchema })),
  asyncHandler(async (req, res) => {
    const user = await one(
      `SELECT u.id, u.username, u.email FROM users u WHERE u.email=$1 AND u.status='active'`,
      [req.body.email]
    );
    // Always return the same response to avoid account enumeration.
    if (user) {
      const token = randomToken(32);
      await query('UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL', [user.id]);
      await query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, requested_ip, expires_at)
         VALUES ($1,$2,$3,now() + interval '30 minutes')`,
        [user.id, sha256(token), req.ip ?? null]
      );
      const resetUrl = `${config.publicUrl}/reset-password?token=${encodeURIComponent(token)}`;
      await enqueueMail({
        to: user.email,
        userId: user.id,
        template: 'passwordReset',
        data: { username: user.username, resetUrl },
        meta: { kind: 'security' }
      }).catch(() => {});
    }
    res.json({ ok: true, message: 'If that email is registered, a reset link has been sent.' });
  })
);

authRouter.post(
  '/password/reset',
  rateLimit({ name: 'reset-password', windowMs: 60 * 60_000, max: 20, message: 'Too many reset attempts.' }),
  validate(z.object({ token: z.string().min(20).max(200), password: passwordSchema })),
  asyncHandler(async (req, res) => {
    const tokenHash = sha256(req.body.token);
    const row = await one(
      `SELECT prt.*, u.username, u.email FROM password_reset_tokens prt
         JOIN users u ON u.id=prt.user_id
        WHERE prt.token_hash=$1 AND prt.used_at IS NULL AND prt.expires_at > now() AND u.status='active'`,
      [tokenHash]
    );
    if (!row) throw badRequest('This reset link is invalid or has expired', 'INVALID_RESET_TOKEN');
    const issues = passwordIssues(req.body.password, { username: row.username, email: row.email });
    if (issues.length) throw badRequest(issues[0], 'WEAK_PASSWORD', { password: issues[0] });
    const hash = await hashPassword(req.body.password);
    await withTransaction(async (client) => {
      await client.query(
        'UPDATE users SET password_hash=$2, password_changed_at=now(), failed_login_attempts=0, locked_until=NULL WHERE id=$1',
        [row.user_id, hash]
      );
      await client.query('UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL', [row.user_id]);
      await client.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [row.user_id]);
    });
    await disconnectSessions(row.user_id).catch(() => {});
    enqueueMail({
      to: row.email,
      userId: row.user_id,
      template: 'passwordChanged',
      data: {
        username: row.username,
        at: new Date().toUTCString(),
        ip: req.ip ?? null
      },
      meta: { kind: 'security' }
    }).catch(() => {});
    res.json({ ok: true, message: 'Password updated. You can sign in now.' });
  })
);

authRouter.post(
  '/password/change',
  requireAuth,
  csrfProtection,
  rateLimit({ name: 'change-password', windowMs: 60 * 60_000, max: 10 }),
  validate(z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema })),
  asyncHandler(async (req, res) => {
    const user = await one('SELECT id, username, email, password_hash FROM users WHERE id=$1', [req.auth.user.id]);
    if (!user) throw unauthorized();
    if (!(await verifyPassword(user.password_hash, req.body.currentPassword))) {
      throw badRequest('Your current password is incorrect', 'INVALID_PASSWORD');
    }
    const issues = passwordIssues(req.body.newPassword, { username: user.username, email: user.email });
    if (issues.length) throw badRequest(issues[0], 'WEAK_PASSWORD', { password: issues[0] });
    const hash = await hashPassword(req.body.newPassword);
    await query(
      'UPDATE users SET password_hash=$2, password_changed_at=now() WHERE id=$1',
      [user.id, hash]
    );
    const revoked = await revokeOtherSessions(user.id, req.auth.sessionId);
    await disconnectSessions(user.id, { keepSessionId: req.auth.sessionId }).catch(() => {});
    enqueueMail({
      to: user.email,
      userId: user.id,
      template: 'passwordChanged',
      data: {
        username: user.username,
        at: new Date().toUTCString(),
        ip: req.ip ?? null
      },
      meta: { kind: 'security' }
    }).catch(() => {});
    res.json({ ok: true, revokedSessions: revoked });
  })
);

authRouter.delete(
  '/account',
  requireAuth,
  csrfProtection,
  validate(z.object({ password: z.string().min(1).max(200), confirmation: z.literal('DELETE') })),
  asyncHandler(async (req, res) => {
    const user = await one('SELECT * FROM users WHERE id=$1 AND status=$2', [req.auth.user.id, 'active']);
    if (!user) throw unauthorized();
    if (user.role === 'admin') {
      throw forbidden('Administrator accounts cannot be self-deleted. Ask another administrator to demote or remove the account.', 'ADMIN_DELETE_FORBIDDEN');
    }
    if (!(await verifyPassword(user.password_hash, req.body.password))) {
      throw badRequest('Your password is incorrect', 'INVALID_PASSWORD');
    }
    const replacementHash = await hashPassword(randomToken(32));
    const files = await withTransaction(async (client) => {
      const deletedFiles = await client.query(
        'SELECT id, storage_key FROM files WHERE owner_id=$1',
        [user.id]
      );
      await client.query('DELETE FROM files WHERE owner_id=$1', [user.id]);
      await client.query('DELETE FROM friendships WHERE user_a=$1 OR user_b=$1', [user.id]);
      await client.query(
        `UPDATE friend_requests SET status='cancelled', responded_at=now()
          WHERE status='pending' AND (requester_id=$1 OR addressee_id=$1)`,
        [user.id]
      );
      await client.query('DELETE FROM blocks WHERE blocker_id=$1 OR blocked_id=$1', [user.id]);
      await client.query(
        `UPDATE conversation_members SET left_at=now()
          WHERE user_id=$1 AND left_at IS NULL`,
        [user.id]
      );
      await client.query('DELETE FROM push_subscriptions WHERE user_id=$1', [user.id]);
      await client.query('DELETE FROM notifications WHERE user_id=$1', [user.id]);
      await client.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [user.id]);
      await client.query(
        `UPDATE users SET username=$2, email=$3, password_hash=$4, status='deleted', role='user',
                failed_login_attempts=0, locked_until=NULL, password_changed_at=now()
          WHERE id=$1`,
        [user.id, `deleted_${user.id.slice(0, 12)}`, `deleted-${user.id}@deleted.invalid`, replacementHash]
      );
      await client.query(
        `UPDATE user_profiles SET display_name='Deleted user', bio='', avatar_file_id=NULL,
                visibility='private', discoverable=false, push_enabled=false
          WHERE user_id=$1`,
        [user.id]
      );
      return deletedFiles.rows;
    });
    const fsp = await import('node:fs/promises');
    const path = await import('node:path');
    for (const f of files) {
      await fsp.unlink(path.join(config.storageDir, 'files', f.storage_key)).catch(() => {});
    }
    await disconnectSessions(user.id).catch(() => {});
    clearSessionCookies(res);
    res.json({ ok: true, message: 'Your account has been deleted.' });
  })
);

authRouter.get(
  '/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT id, ip, user_agent, created_at, last_seen_at, expires_at
         FROM sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at > now()
        ORDER BY last_seen_at DESC`,
      [req.auth.user.id]
    );
    res.json({
      sessions: rows.rows.map((s) => ({
        id: s.id,
        ip: s.ip,
        userAgent: s.user_agent,
        createdAt: s.created_at,
        lastSeenAt: s.last_seen_at,
        expiresAt: s.expires_at,
        current: s.id === req.auth.sessionId
      }))
    });
  })
);

authRouter.delete(
  '/sessions/:id',
  requireAuth,
  csrfProtection,
  asyncHandler(async (req, res) => {
    const session = await one('SELECT id FROM sessions WHERE id=$1 AND user_id=$2', [
      req.params.id,
      req.auth.user.id
    ]);
    if (!session) throw notFound('Session not found');
    await revokeSession(session.id, req.auth.user.id);
    await disconnectSessions(req.auth.user.id, { sessionId: session.id }).catch(() => {});
    if (session.id === req.auth.sessionId) clearSessionCookies(res);
    res.json({ ok: true, current: session.id === req.auth.sessionId });
  })
);

authRouter.delete(
  '/sessions',
  requireAuth,
  csrfProtection,
  asyncHandler(async (req, res) => {
    const revoked = await revokeOtherSessions(req.auth.user.id, req.auth.sessionId);
    await disconnectSessions(req.auth.user.id, { keepSessionId: req.auth.sessionId }).catch(() => {});
    res.json({ ok: true, revoked });
  })
);
