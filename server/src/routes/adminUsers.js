import { Router } from 'express';
import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import { one, query, withTransaction } from '../db.js';
import { asyncHandler, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { uuid, validate } from '../lib/validate.js';
import {
  csrfProtection,
  requireAuth,
  requireCapability,
  requireStaff,
  revokeAllSessions
} from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { config } from '../config.js';
import { disconnectSessions, emitToUser } from '../realtime.js';
import { storageUsage } from '../lib/storage.js';
import { hashPassword, randomToken, sha256 } from '../lib/tokens.js';
import { enqueueMail } from '../lib/mail.js';
import { getSettings } from '../lib/settings.js';
import {
  ROLE_LABELS,
  ROLES,
  canAssignRole,
  canManageRole,
  hasCapability,
  roleRank
} from '../lib/permissions.js';

export const adminUsersRouter = Router();

adminUsersRouter.use(requireAuth, requireStaff, csrfProtection);

async function loadTarget(id) {
  const row = await one(
    `SELECT u.id, u.username, u.email, u.role, u.status, u.phone, u.phone_verified_at,
            u.email_verified_at, u.created_at, u.last_active_at, u.last_login_at,
            p.display_name, p.avatar_file_id
       FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id
      WHERE u.id=$1`,
    [id]
  );
  if (!row) throw notFound('User not found', 'USER_NOT_FOUND');
  return row;
}

function assertCanAct(actor, target, { allowEqual = false } = {}) {
  if (actor.id === target.id) throw badRequest('Use your own account settings for that action', 'SELF_ACTION');
  if (!canManageRole(actor.role, target.role, { allowEqual }) && actor.role !== 'admin') {
    throw forbidden('You cannot manage an account at this level', 'ROLE_TOO_HIGH');
  }
}

async function activeAdminCount() {
  const row = await one("SELECT count(*)::int AS n FROM users WHERE role='admin' AND status='active'");
  return row.n;
}

adminUsersRouter.get(
  '/',
  requireCapability('users.view'),
  validate(
    z.object({
      q: z.string().trim().max(100).optional(),
      status: z.enum(['active', 'suspended', 'deleted']).optional(),
      role: z.enum(['user', 'staff', 'manager', 'admin']).optional(),
      verified: z.enum(['yes', 'no']).optional(),
      page: z.coerce.number().int().min(1).max(10000).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25)
    }),
    'query'
  ),
  asyncHandler(async (req, res) => {
    const { q, status, role, verified, page, limit } = req.validatedQuery;
    const params = [];
    const where = [];
    if (q) {
      params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
      where.push(
        `(u.username::text ILIKE $${params.length} OR u.email::text ILIKE $${params.length} OR p.display_name ILIKE $${params.length} OR u.phone ILIKE $${params.length})`
      );
    }
    if (status) {
      params.push(status);
      where.push(`u.status=$${params.length}`);
    }
    if (role) {
      params.push(role);
      where.push(`u.role=$${params.length}`);
    }
    if (verified === 'yes') where.push('u.email_verified_at IS NOT NULL');
    if (verified === 'no') where.push('u.email_verified_at IS NULL');
    params.push(limit, (page - 1) * limit);
    const rows = await query(
      `SELECT u.id, u.username, u.email, u.role, u.status, u.phone, u.phone_verified_at,
              u.email_verified_at, u.created_at, u.last_active_at, u.last_login_at,
              p.display_name, p.avatar_file_id,
              (SELECT COALESCE(SUM(size_bytes),0)::bigint FROM files WHERE owner_id=u.id) AS storage_bytes,
              (SELECT count(*)::int FROM reports r WHERE r.reported_id=u.id AND r.status IN ('open','reviewing')) AS open_reports,
              (SELECT count(*)::int FROM sessions s WHERE s.user_id=u.id AND s.revoked_at IS NULL AND s.expires_at > now()) AS active_sessions,
              count(*) OVER() AS total
         FROM users u
         LEFT JOIN user_profiles p ON p.user_id=u.id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY
          CASE u.role WHEN 'admin' THEN 0 WHEN 'manager' THEN 1 WHEN 'staff' THEN 2 ELSE 3 END,
          u.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const total = rows.rows[0]?.total ?? 0;
    res.json({
      users: rows.rows.map((u) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        emailVerified: Boolean(u.email_verified_at),
        role: u.role,
        roleLabel: ROLE_LABELS[u.role] || u.role,
        status: u.status,
        phone: u.phone,
        phoneVerified: Boolean(u.phone_verified_at),
        displayName: u.display_name,
        avatarUrl: u.avatar_file_id ? `/api/files/${u.avatar_file_id}` : null,
        storageBytes: u.storage_bytes,
        openReports: u.open_reports,
        activeSessions: u.active_sessions,
        createdAt: u.created_at,
        lastActiveAt: u.last_active_at,
        lastLoginAt: u.last_login_at
      })),
      pagination: {
        page,
        limit,
        total,
        hasMore: page * limit < total
      }
    });
  })
);

adminUsersRouter.get(
  '/:id',
  requireCapability('users.view'),
  validate(z.object({ id: uuid }), 'params'),
  asyncHandler(async (req, res) => {
    const user = await loadTarget(req.params.id);
    const counts = await one(
      `SELECT
         (SELECT count(*)::int FROM messages WHERE sender_id=$1 AND deleted_at IS NULL) AS messages,
         (SELECT count(*)::int FROM friendships WHERE user_a=$1 OR user_b=$1) AS friends,
         (SELECT count(*)::int FROM conversations c JOIN conversation_members cm ON cm.conversation_id=c.id
           WHERE cm.user_id=$1 AND cm.left_at IS NULL) AS conversations,
         (SELECT count(*)::int FROM reports WHERE reported_id=$1 AND status IN ('open','reviewing')) AS open_reports,
         (SELECT count(*)::int FROM sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at > now()) AS active_sessions,
         (SELECT count(*)::int FROM files WHERE owner_id=$1) AS files,
         (SELECT COALESCE(SUM(size_bytes),0)::bigint FROM files WHERE owner_id=$1) AS storage_bytes`,
      [user.id]
    );
    const sessions = await query(
      `SELECT id, ip, user_agent, created_at, last_seen_at, expires_at
         FROM sessions WHERE user_id=$1 AND revoked_at IS NULL AND expires_at > now()
        ORDER BY last_seen_at DESC LIMIT 25`,
      [user.id]
    );
    const reports = await query(
      `SELECT r.id, r.reason, r.status, r.created_at
         FROM reports r WHERE r.reported_id=$1
        ORDER BY r.created_at DESC LIMIT 10`,
      [user.id]
    );
    let mail = [];
    if (hasCapability(req.auth.user.role, 'mail.view')) {
      const rows = await query(
        `SELECT id, template, subject, status, last_error, created_at, sent_at
           FROM mail_outbox WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10`,
        [user.id]
      );
      mail = rows.rows;
    }
    res.json({
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        emailVerified: Boolean(user.email_verified_at),
        role: user.role,
        roleLabel: ROLE_LABELS[user.role] || user.role,
        status: user.status,
        phone: user.phone,
        phoneVerified: Boolean(user.phone_verified_at),
        displayName: user.display_name,
        avatarUrl: user.avatar_file_id ? `/api/files/${user.avatar_file_id}` : null,
        createdAt: user.created_at,
        lastActiveAt: user.last_active_at,
        lastLoginAt: user.last_login_at
      },
      counts,
      sessions: sessions.rows.map((s) => ({
        id: s.id,
        ip: s.ip,
        userAgent: s.user_agent,
        createdAt: s.created_at,
        lastSeenAt: s.last_seen_at,
        expiresAt: s.expires_at
      })),
      reports: reports.rows,
      mail,
      manageable:
        req.auth.user.role === 'admin' ||
        canManageRole(req.auth.user.role, user.role) ||
        user.id === req.auth.user.id
    });
  })
);

adminUsersRouter.patch(
  '/:id',
  requireCapability('users.moderate'),
  validate(z.object({ id: uuid }), 'params'),
  validate(
    z
      .object({
        status: z.enum(['active', 'suspended']).optional(),
        role: z.enum(ROLES).optional(),
        displayName: z.string().trim().min(1).max(60).optional(),
        verifyEmail: z.boolean().optional(),
        clearPhone: z.boolean().optional(),
        unlock: z.boolean().optional()
      })
      .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to update')
  ),
  asyncHandler(async (req, res) => {
    const actor = req.auth.user;
    const target = await loadTarget(req.params.id);
    const body = req.body;

    if (body.role !== undefined) {
      if (actor.role !== 'admin') {
        throw forbidden('Only administrators can change roles', 'ADMIN_REQUIRED');
      }
      if (!canAssignRole(actor.role, body.role)) throw badRequest('Unknown role', 'INVALID_ROLE');
      if (target.id === actor.id) throw badRequest('You cannot change your own role', 'SELF_ACTION');
      if (target.role === 'admin' && body.role !== 'admin' && (await activeAdminCount()) <= 1) {
        throw conflict('At least one active administrator must remain', 'LAST_ADMIN');
      }
    }
    if (body.status !== undefined) {
      assertCanAct(actor, target, { allowEqual: actor.role === 'admin' });
      if (target.id === actor.id) throw badRequest('You cannot change your own status', 'SELF_ACTION');
      if (target.role === 'admin' && body.status === 'suspended' && (await activeAdminCount()) <= 1) {
        throw conflict('At least one active administrator must remain', 'LAST_ADMIN');
      }
    }
    if (body.displayName !== undefined || body.verifyEmail !== undefined || body.clearPhone !== undefined) {
      assertCanAct(actor, target, { allowEqual: actor.role === 'admin' });
    }
    if (body.unlock !== undefined) {
      assertCanAct(actor, target, { allowEqual: actor.role === 'admin' });
    }

    const settings = await getSettings();
    const changes = {};

    await withTransaction(async (client) => {
      if (body.status !== undefined && body.status !== target.status) {
        await client.query('UPDATE users SET status=$2 WHERE id=$1', [target.id, body.status]);
        changes.status = body.status;
      }
      if (body.role !== undefined && body.role !== target.role) {
        await client.query('UPDATE users SET role=$2 WHERE id=$1', [target.id, body.role]);
        changes.role = body.role;
      }
      if (body.displayName !== undefined) {
        await client.query('UPDATE user_profiles SET display_name=$2 WHERE user_id=$1', [
          target.id,
          body.displayName
        ]);
        changes.displayName = body.displayName;
      }
      if (body.verifyEmail) {
        await client.query('UPDATE users SET email_verified_at=now() WHERE id=$1', [target.id]);
        changes.emailVerified = true;
      }
      if (body.clearPhone) {
        await client.query('UPDATE users SET phone=NULL, phone_verified_at=NULL WHERE id=$1', [target.id]);
        changes.phoneCleared = true;
      }
      if (body.unlock) {
        await client.query(
          'UPDATE users SET failed_login_attempts=0, locked_until=NULL WHERE id=$1',
          [target.id]
        );
        changes.unlocked = true;
      }
    });

    if (body.status === 'suspended' && target.status !== 'suspended') {
      await revokeAllSessions(target.id);
      await disconnectSessions(target.id).catch(() => {});
      await enqueueMail({
        to: target.email,
        userId: target.id,
        template: 'accountStatus',
        data: {
          username: target.display_name || target.username,
          status: 'suspended',
          reason: null,
          supportEmail: settings.support_email
        },
        meta: { kind: 'account' }
      }).catch(() => {});
    }
    if (body.status === 'active' && target.status === 'suspended') {
      await enqueueMail({
        to: target.email,
        userId: target.id,
        template: 'accountStatus',
        data: {
          username: target.display_name || target.username,
          status: 'active',
          reason: null,
          supportEmail: settings.support_email
        },
        meta: { kind: 'account' }
      }).catch(() => {});
    }
    if (changes.role) {
      await enqueueMail({
        to: target.email,
        userId: target.id,
        template: 'roleChanged',
        data: {
          username: target.display_name || target.username,
          role: changes.role,
          roleLabel: ROLE_LABELS[changes.role]
        },
        meta: { kind: 'account' }
      }).catch(() => {});
      emitToUser(target.id, 'account:role', { role: changes.role, capabilities: hasCapability(changes.role, 'console.access') });
    }

    await audit(actor.id, 'user.update', {
      targetType: 'user',
      targetId: target.id,
      metadata: { username: target.username, changes },
      ip: req.ip
    });

    res.json({ ok: true, changes, message: 'Account updated' });
  })
);

adminUsersRouter.post(
  '/:id/force-logout',
  requireCapability('users.moderate'),
  validate(z.object({ id: uuid }), 'params'),
  asyncHandler(async (req, res) => {
    const actor = req.auth.user;
    const target = await loadTarget(req.params.id);
    if (target.id === actor.id) throw badRequest('Use the normal sign-out flow for your own account');
    assertCanAct(actor, target, { allowEqual: actor.role === 'admin' });
    const revoked = await revokeAllSessions(target.id);
    await disconnectSessions(target.id).catch(() => {});
    await audit(actor.id, 'user.force_logout', {
      targetType: 'user',
      targetId: target.id,
      metadata: { username: target.username, sessions: revoked },
      ip: req.ip
    });
    res.json({ ok: true, revoked });
  })
);

adminUsersRouter.post(
  '/:id/reset-password',
  requireCapability('users.moderate'),
  validate(z.object({ id: uuid }), 'params'),
  asyncHandler(async (req, res) => {
    const actor = req.auth.user;
    const target = await loadTarget(req.params.id);
    assertCanAct(actor, target, { allowEqual: actor.role === 'admin' });
    if (target.status !== 'active') throw badRequest('Restore the account before sending a reset link');

    const token = randomToken(32);
    await query('UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL', [target.id]);
    await query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, requested_ip, expires_at)
       VALUES ($1,$2,$3,now() + interval '30 minutes')`,
      [target.id, sha256(token), req.ip ?? null]
    );
    const resetUrl = `${config.publicUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await enqueueMail({
      to: target.email,
      userId: target.id,
      template: 'passwordReset',
      data: { username: target.display_name || target.username, resetUrl },
      meta: { kind: 'security', initiatedBy: 'admin' }
    });
    await audit(actor.id, 'user.password_reset', {
      targetType: 'user',
      targetId: target.id,
      metadata: { username: target.username },
      ip: req.ip
    });
    res.json({ ok: true, message: 'Reset link queued' });
  })
);

adminUsersRouter.delete(
  '/:id',
  requireCapability('users.delete'),
  validate(z.object({ id: uuid }), 'params'),
  asyncHandler(async (req, res) => {
    const actor = req.auth.user;
    const target = await loadTarget(req.params.id);
    if (target.id === actor.id) throw forbidden('You cannot delete your own account here', 'SELF_DELETE');
    if (roleRank(target.role) >= roleRank(actor.role)) {
      throw forbidden('You cannot delete an account at this level', 'ROLE_TOO_HIGH');
    }
    if (target.role === 'admin' && (await activeAdminCount()) <= 1) {
      throw conflict('At least one active administrator must remain', 'LAST_ADMIN');
    }

    const replacementHash = await hashPassword(randomToken(32));
    const files = await withTransaction(async (client) => {
      const deletedFiles = await client.query('SELECT id, storage_key FROM files WHERE owner_id=$1', [target.id]);
      await client.query('DELETE FROM files WHERE owner_id=$1', [target.id]);
      await client.query('DELETE FROM friendships WHERE user_a=$1 OR user_b=$1', [target.id]);
      await client.query(
        `UPDATE friend_requests SET status='cancelled', responded_at=now()
          WHERE status='pending' AND (requester_id=$1 OR addressee_id=$1)`,
        [target.id]
      );
      await client.query('DELETE FROM blocks WHERE blocker_id=$1 OR blocked_id=$1', [target.id]);
      await client.query(
        'UPDATE conversation_members SET left_at=now() WHERE user_id=$1 AND left_at IS NULL',
        [target.id]
      );
      await client.query('DELETE FROM push_subscriptions WHERE user_id=$1', [target.id]);
      await client.query('DELETE FROM notifications WHERE user_id=$1', [target.id]);
      await client.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [target.id]);
      await client.query(
        `UPDATE users SET username=$2, email=$3, password_hash=$4, status='deleted', role='user',
                phone=NULL, phone_verified_at=NULL, failed_login_attempts=0, locked_until=NULL,
                password_changed_at=now()
          WHERE id=$1`,
        [target.id, `deleted_${target.id.slice(0, 12)}`, `deleted-${target.id}@deleted.invalid`, replacementHash]
      );
      await client.query(
        `UPDATE user_profiles SET display_name='Deleted user', bio='', avatar_file_id=NULL,
                visibility='private', discoverable=false, push_enabled=false
          WHERE user_id=$1`,
        [target.id]
      );
      return deletedFiles.rows;
    });

    for (const file of files) {
      await fs.unlink(path.join(config.storageDir, 'files', file.storage_key)).catch(() => {});
    }
    await disconnectSessions(target.id).catch(() => {});
    await audit(actor.id, 'user.delete', {
      targetType: 'user',
      targetId: target.id,
      metadata: { username: target.username, files: files.length },
      ip: req.ip
    });
    res.json({ ok: true, message: 'Account deleted and personal data removed' });
  })
);

adminUsersRouter.get(
  '/:id/storage',
  requireCapability('users.view'),
  validate(z.object({ id: uuid }), 'params'),
  asyncHandler(async (req, res) => {
    const user = await loadTarget(req.params.id);
    const usage = await storageUsage(user.id);
    res.json({
      user: { id: user.id, username: user.username },
      bytes: usage.bytes,
      count: usage.count
    });
  })
);
