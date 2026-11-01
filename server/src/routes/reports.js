import { Router } from 'express';
import { z } from 'zod';
import { many, one, query } from '../db.js';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { uuid, validate } from '../lib/validate.js';
import { requireAuth, csrfProtection } from '../middleware/auth.js';
import { reportLimiter } from '../middleware/rateLimit.js';
import { createNotification } from '../lib/notifications.js';
import { emitToUser } from '../realtime.js';

export const reportsRouter = Router();

reportsRouter.post(
  '/',
  requireAuth,
  csrfProtection,
  reportLimiter,
  validate(
    z.object({
      userId: uuid,
      reason: z.enum(['spam', 'harassment', 'impersonation', 'inappropriate_media', 'scam', 'other']),
      details: z.string().trim().max(1000).default(''),
      messageId: uuid.optional(),
      conversationId: uuid.optional()
    })
  ),
  asyncHandler(async (req, res) => {
    const me = req.auth.user.id;
    const { userId, reason, details } = req.body;
    if (userId === me) throw badRequest('You cannot report yourself', 'SELF_REPORT');
    const target = await one(
      `SELECT u.id, u.username, p.display_name FROM users u
         JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1 AND u.status='active'`,
      [userId]
    );
    if (!target) throw notFound('User not found', 'USER_NOT_FOUND');

    let conversationId = req.body.conversationId ?? null;
    let messageId = req.body.messageId ?? null;
    if (messageId) {
      const message = await one(
        `SELECT m.conversation_id FROM messages m
           JOIN conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=$2 AND cm.left_at IS NULL
          WHERE m.id=$1`,
        [messageId, me]
      );
      if (!message) throw badRequest('The referenced message is not available to you', 'INVALID_EVIDENCE');
      conversationId = message.conversation_id;
    } else if (conversationId) {
      const member = await one(
        'SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2 AND left_at IS NULL',
        [conversationId, me]
      );
      if (!member) throw badRequest('The referenced conversation is not available to you', 'INVALID_EVIDENCE');
    }

    const report = await one(
      `INSERT INTO reports (reporter_id, reported_id, reason, details, message_id, conversation_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [me, userId, reason, details, messageId, conversationId]
    );

    const admins = await many("SELECT id FROM users WHERE role='admin' AND status='active'");
    for (const admin of admins) {
      await createNotification({
        userId: admin.id,
        type: 'system',
        actorId: me,
        payload: {
          reportId: report.id,
          reportedUsername: target.username,
          reason
        }
      }).catch(() => {});
      emitToUser(admin.id, 'admin:report', { reportId: report.id, reason });
    }

    res.status(201).json({ report: { id: report.id, status: report.status, createdAt: report.created_at } });
  })
);

reportsRouter.get(
  '/mine',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT r.id, r.reason, r.details, r.status, r.created_at, r.reviewed_at,
              u.username AS reported_username, p.display_name AS reported_display_name
         FROM reports r
         LEFT JOIN users u ON u.id=r.reported_id
         LEFT JOIN user_profiles p ON p.user_id=r.reported_id
        WHERE r.reporter_id=$1
        ORDER BY r.created_at DESC
        LIMIT 50`,
      [req.auth.user.id]
    );
    res.json({
      reports: rows.rows.map((r) => ({
        id: r.id,
        reason: r.reason,
        details: r.details,
        status: r.status,
        createdAt: r.created_at,
        reviewedAt: r.reviewed_at,
        reportedUser: { username: r.reported_username, displayName: r.reported_display_name }
      }))
    });
  })
);
