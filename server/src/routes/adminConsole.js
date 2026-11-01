import { Router } from 'express';
import { z } from 'zod';
import os from 'node:os';
import { statfs } from 'node:fs/promises';
import { one, query } from '../db.js';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { uuid, validate } from '../lib/validate.js';
import { requireAuth, requireCapability, requireStaff, csrfProtection } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { config } from '../config.js';
import { redis, checkRedis } from '../redis.js';
import { storageUsage } from '../lib/storage.js';
import { onlineCount } from '../lib/presence.js';
import {
  cancelMail,
  listMail,
  mailConfigured,
  mailMode,
  mailStats,
  processMailQueue,
  retryMail,
  sendTestMail,
  mailStatus
} from '../lib/mail.js';
import {
  adminListNotices,
  notifyNoticeRemoval,
  notifyNoticeUpdate,
  noticesForAdminCounts,
  publishNotice
} from '../lib/notices.js';
import { getSettings, invalidateSettings, setSetting, settingRows } from '../lib/settings.js';

export const adminConsoleRouter = Router();

adminConsoleRouter.use(requireAuth, requireStaff, csrfProtection);

/* --------------------------------------------------------------------------
 * Notices
 * ------------------------------------------------------------------------ */

const noticeInput = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(2000),
  level: z.enum(['info', 'success', 'warning', 'critical']).default('info'),
  audience: z.enum(['everyone', 'staff', 'admins']).default('everyone'),
  status: z.enum(['draft', 'published', 'archived']).default('draft'),
  pinned: z.boolean().default(false),
  dismissible: z.boolean().default(true),
  startsAt: z.string().datetime({ offset: true }).nullish(),
  endsAt: z.string().datetime({ offset: true }).nullish()
});

adminConsoleRouter.get(
  '/notices',
  requireCapability('notices.view'),
  validate(
    z.object({
      status: z.enum(['draft', 'published', 'archived', 'all']).default('all'),
      page: z.coerce.number().int().min(1).max(1000).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25)
    }),
    'query'
  ),
  asyncHandler(async (req, res) => {
    const { status, page, limit } = req.validatedQuery;
    const data = await adminListNotices({ status, page, limit });
    res.json({
      notices: data.notices,
      counts: await noticesForAdminCounts(),
      pagination: { page, limit, total: data.total, hasMore: page * limit < data.total }
    });
  })
);

adminConsoleRouter.post(
  '/notices',
  requireCapability('notices.manage'),
  validate(noticeInput),
  asyncHandler(async (req, res) => {
    const n = req.body;
    const row = await one(
      `INSERT INTO notices (title, body, level, audience, status, pinned, dismissible, starts_at, ends_at, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
       RETURNING *`,
      [n.title, n.body, n.level, n.audience, n.status, n.pinned, n.dismissible, n.startsAt, n.endsAt, req.auth.user.id]
    );
    await audit(req.auth.user.id, 'notice.create', {
      targetType: 'notice',
      targetId: row.id,
      metadata: { title: row.title, status: row.status, audience: row.audience },
      ip: req.ip
    });
    if (row.status === 'published') await notifyNoticeUpdate(row.id);
    res.status(201).json({ notice: row });
  })
);

adminConsoleRouter.patch(
  '/notices/:id',
  requireCapability('notices.manage'),
  validate(z.object({ id: uuid }), 'params'),
  validate(noticeInput.partial()),
  asyncHandler(async (req, res) => {
    const existing = await one('SELECT * FROM notices WHERE id=$1', [req.params.id]);
    if (!existing) throw notFound('Notice not found', 'NOTICE_NOT_FOUND');
    const n = req.body;
    const fields = [];
    const values = [];
    const map = {
      title: 'title',
      body: 'body',
      level: 'level',
      audience: 'audience',
      status: 'status',
      pinned: 'pinned',
      dismissible: 'dismissible',
      startsAt: 'starts_at',
      endsAt: 'ends_at'
    };
    for (const [key, column] of Object.entries(map)) {
      if (n[key] === undefined) continue;
      fields.push(`${column}=$${values.length + 1}`);
      values.push(n[key]);
    }
    fields.push(`updated_by=$${values.length + 1}`);
    values.push(req.auth.user.id);
    values.push(existing.id);
    const row = await one(
      `UPDATE notices SET ${fields.join(', ')} WHERE id=$${values.length} RETURNING *`,
      values
    );
    await audit(req.auth.user.id, 'notice.update', {
      targetType: 'notice',
      targetId: row.id,
      metadata: { title: row.title, status: row.status },
      ip: req.ip
    });
    if (row.status === 'published') await notifyNoticeUpdate(row.id);
    else if (existing.status === 'published') await notifyNoticeRemoval(row.id);
    res.json({ notice: row });
  })
);

adminConsoleRouter.post(
  '/notices/:id/publish',
  requireCapability('notices.manage'),
  validate(z.object({ id: uuid }), 'params'),
  validate(z.object({ sendEmail: z.boolean().default(false) }).default({})),
  asyncHandler(async (req, res) => {
    if (req.body.sendEmail && req.auth.user.role !== 'admin') {
      throw badRequest('Only administrators can email an announcement to everyone');
    }
    const notice = await publishNotice(req.params.id, req.auth.user.id, {
      sendEmail: req.body.sendEmail
    });
    await audit(req.auth.user.id, 'notice.publish', {
      targetType: 'notice',
      targetId: req.params.id,
      metadata: { title: notice.title, sendEmail: req.body.sendEmail },
      ip: req.ip
    });
    res.json({
      ok: true,
      notice,
      emailQueued: req.body.sendEmail,
      mailConfigured: mailConfigured()
    });
  })
);

adminConsoleRouter.post(
  '/notices/:id/archive',
  requireCapability('notices.manage'),
  validate(z.object({ id: uuid }), 'params'),
  asyncHandler(async (req, res) => {
    const row = await one(
      `UPDATE notices SET status='archived', updated_by=$2 WHERE id=$1 RETURNING *`,
      [req.params.id, req.auth.user.id]
    );
    if (!row) throw notFound('Notice not found', 'NOTICE_NOT_FOUND');
    await notifyNoticeRemoval(row.id);
    await audit(req.auth.user.id, 'notice.archive', {
      targetType: 'notice',
      targetId: row.id,
      metadata: { title: row.title },
      ip: req.ip
    });
    res.json({ ok: true, notice: row });
  })
);

adminConsoleRouter.delete(
  '/notices/:id',
  requireCapability('notices.manage'),
  validate(z.object({ id: uuid }), 'params'),
  asyncHandler(async (req, res) => {
    const row = await one('DELETE FROM notices WHERE id=$1 RETURNING id, title', [req.params.id]);
    if (!row) throw notFound('Notice not found', 'NOTICE_NOT_FOUND');
    await notifyNoticeRemoval(row.id);
    await audit(req.auth.user.id, 'notice.delete', {
      targetType: 'notice',
      targetId: row.id,
      metadata: { title: row.title },
      ip: req.ip
    });
    res.json({ ok: true });
  })
);

/* --------------------------------------------------------------------------
 * Mail console
 * ------------------------------------------------------------------------ */

adminConsoleRouter.get(
  '/mail',
  requireCapability('mail.view'),
  validate(
    z.object({
      status: z.enum(['queued', 'sent', 'failed', 'cancelled', 'all']).default('all'),
      q: z.string().trim().max(100).optional(),
      page: z.coerce.number().int().min(1).max(1000).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25)
    }),
    'query'
  ),
  asyncHandler(async (req, res) => {
    const { status, q, page, limit } = req.validatedQuery;
    const data = await listMail({ status, q, page, limit });
    res.json({
      ...data,
      status: mailStatus(),
      stats: await mailStats(),
      pagination: { page, limit, total: data.total, hasMore: page * limit < data.total }
    });
  })
);

adminConsoleRouter.post(
  '/mail/test',
  requireCapability('mail.manage'),
  validate(z.object({ to: z.string().trim().email().max(254) })),
  asyncHandler(async (req, res) => {
    const row = await sendTestMail({ to: req.body.to, username: req.auth.user.username });
    await audit(req.auth.user.id, 'mail.test', {
      targetType: 'mail',
      targetId: row.id,
      metadata: { to: req.body.to },
      ip: req.ip
    });
    res.status(202).json({
      ok: true,
      queued: row.id,
      mailConfigured: mailConfigured(),
      mode: mailMode(),
      message: mailConfigured()
        ? 'Test message queued for delivery.'
        : 'Queued, but SMTP is not configured so delivery will fail until it is.'
    });
  })
);

adminConsoleRouter.post(
  '/mail/process',
  requireCapability('mail.manage'),
  asyncHandler(async (_req, res) => {
    const result = await processMailQueue(25);
    res.json({ ok: true, ...result });
  })
);

adminConsoleRouter.post(
  '/mail/:id/retry',
  requireCapability('mail.manage'),
  validate(z.object({ id: uuid }), 'params'),
  asyncHandler(async (req, res) => {
    const ok = await retryMail(req.params.id);
    if (!ok) throw badRequest('Only failed or cancelled messages can be retried', 'MAIL_NOT_RETRYABLE');
    await audit(req.auth.user.id, 'mail.retry', { targetType: 'mail', targetId: req.params.id, ip: req.ip });
    res.json({ ok: true });
  })
);

adminConsoleRouter.delete(
  '/mail/:id',
  requireCapability('mail.manage'),
  validate(z.object({ id: uuid }), 'params'),
  asyncHandler(async (req, res) => {
    const ok = await cancelMail(req.params.id);
    if (!ok) throw badRequest('Only queued or failed messages can be cancelled', 'MAIL_NOT_CANCELLABLE');
    await audit(req.auth.user.id, 'mail.cancel', { targetType: 'mail', targetId: req.params.id, ip: req.ip });
    res.json({ ok: true });
  })
);

/* --------------------------------------------------------------------------
 * Runtime settings (administrators only)
 * ------------------------------------------------------------------------ */

adminConsoleRouter.get(
  '/settings',
  requireCapability('settings.manage'),
  asyncHandler(async (_req, res) => {
    res.json({
      settings: await getSettings({ fresh: true }),
      rows: await settingRows(),
      mail: mailStatus()
    });
  })
);

adminConsoleRouter.patch(
  '/settings',
  requireCapability('settings.manage'),
  validate(
    z
      .object({
        registration_open: z.boolean().optional(),
        maintenance_mode: z.boolean().optional(),
        maintenance_message: z.string().trim().min(3).max(300).optional(),
        require_email_verification: z.boolean().optional(),
        public_directory: z.boolean().optional(),
        max_upload_mb: z.coerce.number().int().min(1).max(100).optional(),
        support_email: z.string().trim().email().max(254).optional()
      })
      .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to update')
  ),
  asyncHandler(async (req, res) => {
    const changed = {};
    for (const [key, value] of Object.entries(req.body)) {
      if (value === undefined) continue;
      await setSetting(key, value, req.auth.user.id);
      changed[key] = value;
    }
    await audit(req.auth.user.id, 'settings.update', {
      targetType: 'settings',
      metadata: changed,
      ip: req.ip
    });
    res.json({ ok: true, settings: await getSettings({ fresh: true }), changed });
  })
);

/* --------------------------------------------------------------------------
 * Developer console
 * ------------------------------------------------------------------------ */

async function diskInfo() {
  try {
    const stat = await statfs(config.storageDir);
    return { freeBytes: stat.bavail * stat.bsize, totalBytes: stat.blocks * stat.bsize };
  } catch {
    return null;
  }
}

adminConsoleRouter.get(
  '/system',
  requireCapability('developer.access'),
  asyncHandler(async (_req, res) => {
    const started = Date.now();
    let dbOk = true;
    let dbError = null;
    try {
      await query('SELECT 1');
    } catch (err) {
      dbOk = false;
      dbError = err.message;
    }
    const dbLatency = Date.now() - started;
    const redisCheck = await checkRedis();
    const disk = await diskInfo();
    const storage = await storageUsage().catch(() => ({ bytes: 0, count: 0 }));
    const db = await one('SELECT version() AS version, current_database() AS db, pg_size_pretty(pg_database_size(current_database())) AS size').catch(() => null);
    const migrations = await query('SELECT name, applied_at FROM schema_migrations ORDER BY name').catch(() => ({ rows: [] }));
    const tables = await query(
      `SELECT relname AS table, n_live_tup::bigint AS rows,
              pg_size_pretty(pg_total_relation_size(relid)) AS size
         FROM pg_stat_user_tables
        ORDER BY pg_total_relation_size(relid) DESC
        LIMIT 12`
    ).catch(() => ({ rows: [] }));
    const roles = await query(
      `SELECT role, count(*)::int AS n FROM users WHERE status='active' GROUP BY role ORDER BY role`
    ).catch(() => ({ rows: [] }));
    const counts = await one(
      `SELECT
         (SELECT count(*)::int FROM users WHERE created_at > now() - interval '24 hours') AS signups_24h,
         (SELECT count(*)::int FROM messages WHERE created_at > now() - interval '24 hours') AS messages_24h,
         (SELECT count(*)::int FROM calls WHERE started_at > now() - interval '24 hours') AS calls_24h,
         (SELECT count(*)::int FROM notices WHERE status='published') AS notices_live,
         (SELECT count(*)::int FROM mail_outbox WHERE status='queued') AS mail_queued,
         (SELECT count(*)::int FROM mail_outbox WHERE status='failed') AS mail_failed,
         (SELECT count(*)::int FROM sessions WHERE revoked_at IS NULL AND expires_at > now()) AS sessions`
    ).catch(() => ({}));
    const mem = { total: os.totalmem(), free: os.freemem(), load: os.loadavg() };

    res.json({
      status: dbOk && redisCheck.ok ? 'ok' : 'degraded',
      checks: {
        database: { ok: dbOk, latencyMs: dbLatency, error: dbError },
        redis: { ok: redisCheck.ok, latencyMs: redisCheck.latencyMs },
        storage: { ok: Boolean(disk), ...(disk ?? {}), files: storage.count, bytes: storage.bytes }
      },
      runtime: {
        version: config.version,
        env: config.env,
        node: process.version,
        uptimeSeconds: Math.round(process.uptime()),
        memory: mem,
        onlineUsers: await onlineCount().catch(() => 0),
        pid: process.pid
      },
      config: {
        port: config.port,
        publicUrl: config.publicUrl,
        storageDir: config.storageDir,
        maxUploadMb: config.maxUploadMb,
        cookieSecure: config.cookieSecure,
        turnConfigured: config.turnConfigured,
        pushConfigured: Boolean(config.vapid.configured),
        smtpConfigured: mailConfigured(),
        mailMode: mailMode(),
        allowDevEmail: config.allowDevEmail
      },
      mail: { ...mailStatus(), stats: await mailStats() },
      settings: await getSettings({ fresh: true }),
      settingsRows: await settingRows(),
      database: db
        ? {
            version: db.version.split(' ').slice(0, 2).join(' '),
            name: db.db,
            size: db.size
          }
        : null,
      tables: tables.rows,
      roles: roles.rows,
      counts,
      migrations: migrations.rows
    });
  })
);

adminConsoleRouter.post(
  '/system/cache/flush',
  requireCapability('developer.access'),
  asyncHandler(async (req, res) => {
    const keys = await redis.keys('minchat:rl:*');
    let removed = 0;
    if (keys.length) removed = await redis.del(...keys);
    invalidateSettings();
    await audit(req.auth.user.id, 'system.cache_flush', {
      metadata: { rateLimitKeysRemoved: removed },
      ip: req.ip
    });
    res.json({ ok: true, removed, message: 'Rate-limit buckets cleared and settings cache reloaded.' });
  })
);

adminConsoleRouter.post(
  '/system/cleanup',
  requireCapability('developer.access'),
  asyncHandler(async (req, res) => {
    const sessions = await query(
      "UPDATE sessions SET revoked_at=now() WHERE revoked_at IS NULL AND expires_at < now() RETURNING id"
    );
    const resets = await query(
      "DELETE FROM password_reset_tokens WHERE expires_at < now() - interval '7 days' OR used_at < now() - interval '7 days' RETURNING id"
    );
    const verifications = await query(
      "DELETE FROM email_verification_tokens WHERE expires_at < now() - interval '7 days' RETURNING id"
    );
    const phones = await query(
      "DELETE FROM phone_verifications WHERE expires_at < now() - interval '1 day' RETURNING id"
    );
    const oldMail = await query(
      `UPDATE mail_outbox
          SET text_body=NULL, html_body=NULL
        WHERE created_at < now() - interval '30 days'
          AND status IN ('sent','cancelled')
          AND (text_body IS NOT NULL OR html_body IS NOT NULL)
        RETURNING id`
    );
    const notifications = await query(
      "DELETE FROM notifications WHERE read_at IS NOT NULL AND read_at < now() - interval '90 days' RETURNING id"
    );
    const result = {
      expiredSessions: sessions.rowCount,
      resetTokens: resets.rowCount,
      verificationTokens: verifications.rowCount,
      phoneCodes: phones.rowCount,
      mailBodiesPurged: oldMail.rowCount,
      oldNotifications: notifications.rowCount
    };
    await audit(req.auth.user.id, 'system.cleanup', { metadata: result, ip: req.ip });
    res.json({ ok: true, ...result });
  })
);

adminConsoleRouter.get(
  '/system/queue',
  requireCapability('mail.view'),
  asyncHandler(async (_req, res) => {
    res.json({ mail: mailStatus(), stats: await mailStats(), settings: await getSettings() });
  })
);
