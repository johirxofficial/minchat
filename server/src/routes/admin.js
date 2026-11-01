import { Router } from 'express';
import { z } from 'zod';
import os from 'node:os';
import { statfs } from 'node:fs/promises';
import { one, query } from '../db.js';
import { asyncHandler } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { requireAuth, requireCapability, requireStaff, csrfProtection } from '../middleware/auth.js';
import { config } from '../config.js';
import { checkRedis } from '../redis.js';
import { onlineCount } from '../lib/presence.js';
import { storageUsage } from '../lib/storage.js';
import { mailConfigured, mailMode, mailStats } from '../lib/mail.js';
import { hasCapability } from '../lib/permissions.js';

export const adminRouter = Router();

adminRouter.use(requireAuth, requireStaff, csrfProtection);

adminRouter.get(
  '/stats',
  requireCapability('console.access'),
  asyncHandler(async (req, res) => {
    const counts = await one(
      `SELECT
         (SELECT count(*)::int FROM users WHERE status='active') AS active_users,
         (SELECT count(*)::int FROM users WHERE status='suspended') AS suspended_users,
         (SELECT count(*)::int FROM users WHERE status='active' AND role='admin') AS admins,
         (SELECT count(*)::int FROM users WHERE status='active' AND role='manager') AS managers,
         (SELECT count(*)::int FROM users WHERE status='active' AND role='staff') AS staff,
         (SELECT count(*)::int FROM users WHERE status='active' AND role='user') AS members,
         (SELECT count(*)::int FROM users WHERE created_at > now() - interval '24 hours') AS signups_24h,
         (SELECT count(*)::int FROM messages WHERE created_at > now() - interval '24 hours') AS messages_24h,
         (SELECT count(*)::int FROM calls WHERE started_at > now() - interval '24 hours') AS calls_24h,
         (SELECT count(*)::int FROM reports WHERE status IN ('open','reviewing')) AS open_reports,
         (SELECT count(*)::int FROM friend_requests WHERE status='pending') AS pending_requests,
         (SELECT count(*)::int FROM notices WHERE status='published') AS published_notices,
         (SELECT count(*)::int FROM sessions WHERE revoked_at IS NULL AND expires_at > now()) AS active_sessions`
    );
    const storage = await storageUsage();
    const payload = {
      counts: { ...counts, online: await onlineCount() },
      storage: { bytes: storage.bytes, files: storage.count },
      server: { version: config.version, uptimeSeconds: Math.round(process.uptime()) },
      capabilities: req.auth.user.role
    };
    if (hasCapability(req.auth.user.role, 'mail.view')) {
      payload.mail = await mailStats();
      payload.mailMode = mailMode();
    }
    res.json(payload);
  })
);

adminRouter.get(
  '/storage',
  requireCapability('console.access'),
  asyncHandler(async (req, res) => {
    const total = await storageUsage();
    const users = await query(
      `SELECT u.id, u.username, p.display_name, p.avatar_file_id,
              count(f.id)::int AS files, COALESCE(SUM(f.size_bytes),0)::bigint AS bytes
         FROM files f
         JOIN users u ON u.id=f.owner_id
         LEFT JOIN user_profiles p ON p.user_id=u.id
        GROUP BY u.id, u.username, p.display_name, p.avatar_file_id
        ORDER BY bytes DESC
        LIMIT 20`
    );
    res.json({
      total: { bytes: total.bytes, count: total.count },
      quotaPerUserBytes: config.userQuotaBytes,
      users: users.rows.map((u) => ({
        id: u.id,
        username: u.username,
        displayName: u.display_name,
        avatarUrl: u.avatar_file_id ? `/api/files/${u.avatar_file_id}` : null,
        files: u.files,
        bytes: Number(u.bytes)
      })),
      maxUploadMb: config.maxUploadMb,
      storageDir: config.storageDir
    });
  })
);

adminRouter.get(
  '/audit-logs',
  requireCapability('audit.view'),
  validate(
    z.object({
      page: z.coerce.number().int().min(1).max(10000).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      action: z.string().trim().max(80).optional()
    }),
    'query'
  ),
  asyncHandler(async (req, res) => {
    const { page, limit, action } = req.validatedQuery;
    const params = [];
    let where = '';
    if (action) {
      params.push(`${action.replace(/[\\%_]/g, '\\$&')}%`);
      where = 'WHERE al.action ILIKE $1';
    }
    params.push(limit, (page - 1) * limit);
    const rows = await query(
      `SELECT al.id, al.action, al.target_type, al.target_id, al.metadata, al.ip, al.created_at,
              u.username AS admin_username, u.role AS admin_role, p.display_name AS admin_display_name,
              count(*) OVER() AS total
         FROM admin_audit_logs al
         LEFT JOIN users u ON u.id=al.admin_id
         LEFT JOIN user_profiles p ON p.user_id=al.admin_id
        ${where}
        ORDER BY al.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const total = rows.rows[0]?.total ?? 0;
    res.json({
      logs: rows.rows.map((l) => ({
        id: l.id,
        action: l.action,
        targetType: l.target_type,
        targetId: l.target_id,
        metadata: l.metadata,
        ip: l.ip,
        createdAt: l.created_at,
        admin: l.admin_username
          ? { username: l.admin_username, role: l.admin_role, displayName: l.admin_display_name }
          : null
      })),
      pagination: { page, limit, total, hasMore: page * limit < total }
    });
  })
);

adminRouter.get(
  '/health',
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
    let disk = null;
    try {
      const stat = await statfs(config.storageDir);
      disk = { freeBytes: stat.bavail * stat.bsize, totalBytes: stat.blocks * stat.bsize };
    } catch {
      disk = null;
    }
    const db = await one('SELECT version() AS version, current_database() AS db').catch(() => null);
    const migrations = await query('SELECT name, applied_at FROM schema_migrations ORDER BY name').catch(() => ({ rows: [] }));
    const storage = await storageUsage().catch(() => ({ bytes: 0, count: 0 }));
    const mem = { total: os.totalmem(), free: os.freemem(), load: os.loadavg() };

    const healthy = dbOk && redisCheck.ok;
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      checks: {
        database: { ok: dbOk, latencyMs: dbLatency, error: dbError },
        redis: { ok: redisCheck.ok, latencyMs: redisCheck.latencyMs },
        storage: { ok: Boolean(disk), ...(disk ?? {}), files: storage.count, bytes: storage.bytes }
      },
      runtime: {
        version: config.version,
        env: config.env,
        uptimeSeconds: Math.round(process.uptime()),
        node: process.version,
        memory: mem,
        onlineUsers: await onlineCount().catch(() => 0)
      },
      config: {
        port: config.port,
        publicUrl: config.publicUrl,
        smtpConfigured: mailConfigured(),
        mailMode: mailMode(),
        pushConfigured: config.vapid.configured,
        turnConfigured: config.turnConfigured,
        registrationOpen: config.registrationOpen,
        maxUploadMb: config.maxUploadMb,
        storageDir: config.storageDir
      },
      database: db ? { version: db.version.split(' ').slice(0, 2).join(' '), name: db.db } : null,
      migrations: migrations.rows
    });
  })
);
