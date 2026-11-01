import { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../db.js';
import { asyncHandler, notFound } from '../lib/errors.js';
import { uuid, validate } from '../lib/validate.js';
import { requireAuth, csrfProtection } from '../middleware/auth.js';
import {
  markNotificationsRead,
  unreadNotificationCount
} from '../lib/notifications.js';
import { config } from '../config.js';
import { publicVapidKey, pushConfigured } from '../lib/push.js';
import { fileUrl } from '../lib/dto.js';

export const notificationsRouter = Router();

function notificationDto(row) {
  return {
    id: row.id,
    type: row.type,
    conversationId: row.conversation_id,
    messageId: row.message_id,
    callId: row.call_id,
    payload: row.payload,
    readAt: row.read_at,
    createdAt: row.created_at,
    actor: row.actor_id
      ? {
          id: row.actor_id,
          username: row.actor_username,
          displayName: row.actor_display_name,
          avatarUrl: fileUrl(row.actor_avatar_file_id)
        }
      : null
  };
}

notificationsRouter.get(
  '/',
  requireAuth,
  validate(
    z.object({
      page: z.coerce.number().int().min(1).max(1000).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(20),
      unread: z.enum(['true', 'false']).optional()
    }),
    'query'
  ),
  asyncHandler(async (req, res) => {
    const { page, limit, unread } = req.validatedQuery;
    const offset = (page - 1) * limit;
    const rows = await query(
      `SELECT n.*, u.username AS actor_username, p.display_name AS actor_display_name,
              p.avatar_file_id AS actor_avatar_file_id, count(*) OVER() AS total
         FROM notifications n
         LEFT JOIN users u ON u.id=n.actor_id
         LEFT JOIN user_profiles p ON p.user_id=n.actor_id
        WHERE n.user_id=$1 ${unread === 'true' ? 'AND n.read_at IS NULL' : ''}
        ORDER BY n.created_at DESC
        LIMIT $2 OFFSET $3`,
      [req.auth.user.id, limit, offset]
    );
    const total = rows.rows[0]?.total ?? 0;
    res.json({
      notifications: rows.rows.map(notificationDto),
      unread: await unreadNotificationCount(req.auth.user.id),
      pagination: { page, limit, total, hasMore: offset + rows.rows.length < total }
    });
  })
);

notificationsRouter.get(
  '/unread-count',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ unread: await unreadNotificationCount(req.auth.user.id) });
  })
);

notificationsRouter.post(
  '/read',
  requireAuth,
  csrfProtection,
  validate(
    z
      .object({
        ids: z.array(uuid).max(100).optional(),
        conversationId: uuid.optional(),
        all: z.boolean().optional()
      })
      .optional()
  ),
  asyncHandler(async (req, res) => {
    await markNotificationsRead(req.auth.user.id, {
      ids: req.body?.ids ?? null,
      conversationId: req.body?.conversationId ?? null
    });
    res.json({ ok: true, unread: await unreadNotificationCount(req.auth.user.id) });
  })
);

notificationsRouter.get(
  '/push-key',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ enabled: pushConfigured(), publicKey: publicVapidKey() });
  })
);

notificationsRouter.post(
  '/push-subscribe',
  requireAuth,
  csrfProtection,
  validate(
    z.object({
      endpoint: z.string().url().max(2000),
      keys: z.object({
        p256dh: z.string().min(20).max(500),
        auth: z.string().min(8).max(500)
      })
    })
  ),
  asyncHandler(async (req, res) => {
    if (!config.vapid.configured) throw Object.assign(new Error('Push is not configured on this server'), { status: 503, code: 'PUSH_DISABLED' });
    const agent = String(req.headers['user-agent'] || '').slice(0, 300);
    await query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (endpoint) DO UPDATE
         SET user_id=$1, p256dh=$3, auth=$4, user_agent=$5, created_at=now()`,
      [req.auth.user.id, req.body.endpoint, req.body.keys.p256dh, req.body.keys.auth, agent]
    );
    await query('UPDATE user_profiles SET push_enabled=true WHERE user_id=$1', [req.auth.user.id]);
    res.status(201).json({ ok: true });
  })
);

notificationsRouter.delete(
  '/push-subscribe',
  requireAuth,
  csrfProtection,
  validate(z.object({ endpoint: z.string().url().max(2000) })),
  asyncHandler(async (req, res) => {
    await query('DELETE FROM push_subscriptions WHERE endpoint=$1 AND user_id=$2', [
      req.body.endpoint,
      req.auth.user.id
    ]);
    res.json({ ok: true });
  })
);
