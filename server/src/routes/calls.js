import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { asyncHandler, notFound } from '../lib/errors.js';
import { uuid, validate } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';
import { fileUrl } from '../lib/dto.js';

export const callsRouter = Router();

callsRouter.get(
  '/config',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({
      iceServers: config.iceServers,
      turnConfigured: config.turnConfigured,
      ringTimeoutMs: config.callRingTimeoutMs,
      secureContextRequired: true
    });
  })
);

callsRouter.get(
  '/history',
  requireAuth,
  validate(
    z.object({
      page: z.coerce.number().int().min(1).max(1000).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(20)
    }),
    'query'
  ),
  asyncHandler(async (req, res) => {
    const { page, limit } = req.validatedQuery;
    const me = req.auth.user.id;
    const offset = (page - 1) * limit;
    const rows = await query(
      `SELECT c.*, count(*) OVER() AS total,
              ou.id AS other_id, ou.username AS other_username,
              op.display_name AS other_display_name, op.avatar_file_id AS other_avatar_file_id
         FROM calls c
         LEFT JOIN LATERAL (
           SELECT u.id, u.username, p.display_name, p.avatar_file_id
             FROM users u JOIN user_profiles p ON p.user_id=u.id
            WHERE u.id = CASE WHEN c.caller_id=$1::uuid THEN c.callee_id ELSE c.caller_id END
         ) ou ON true
         LEFT JOIN user_profiles op ON op.user_id=ou.id
        WHERE c.caller_id=$1::uuid OR c.callee_id=$1::uuid
        ORDER BY c.started_at DESC
        LIMIT $2 OFFSET $3`,
      [me, limit, offset]
    );
    const total = rows.rows[0]?.total ?? 0;
    res.json({
      calls: rows.rows.map((r) => ({
        id: r.id,
        conversationId: r.conversation_id,
        type: r.type,
        status: r.status,
        direction: r.caller_id === me ? 'outgoing' : 'incoming',
        startedAt: r.started_at,
        answeredAt: r.answered_at,
        endedAt: r.ended_at,
        durationSeconds: r.duration_seconds,
        endReason: r.end_reason,
        otherUser: {
          id: r.other_id,
          username: r.other_username,
          displayName: r.other_display_name,
          avatarUrl: fileUrl(r.other_avatar_file_id)
        }
      })),
      pagination: { page, limit, total, hasMore: offset + rows.rows.length < total }
    });
  })
);

callsRouter.get(
  '/:id',
  requireAuth,
  validate(z.object({ id: uuid }), 'params'),
  asyncHandler(async (req, res) => {
    const me = req.auth.user.id;
    const call = await query(
      'SELECT * FROM calls WHERE id=$1 AND ($2::uuid = caller_id OR $2::uuid = callee_id)',
      [req.params.id, me]
    );
    if (!call.rows[0]) throw notFound('Call not found', 'CALL_NOT_FOUND');
    const events = await query(
      'SELECT event, actor_id, detail, created_at FROM call_events WHERE call_id=$1 ORDER BY created_at',
      [req.params.id]
    );
    res.json({
      call: {
        id: call.rows[0].id,
        conversationId: call.rows[0].conversation_id,
        type: call.rows[0].type,
        status: call.rows[0].status,
        callerId: call.rows[0].caller_id,
        calleeId: call.rows[0].callee_id,
        startedAt: call.rows[0].started_at,
        answeredAt: call.rows[0].answered_at,
        endedAt: call.rows[0].ended_at,
        endReason: call.rows[0].end_reason,
        durationSeconds: call.rows[0].duration_seconds,
        events: events.rows
      }
    });
  })
);
