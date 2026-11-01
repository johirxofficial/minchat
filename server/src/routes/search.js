import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { asyncHandler } from '../lib/errors.js';
import { uuid, validate } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { searchLimiter } from '../middleware/rateLimit.js';

export const searchRouter = Router();

searchRouter.get(
  '/messages',
  requireAuth,
  searchLimiter,
  validate(
    z.object({
      q: z.string().trim().min(2, 'Search for at least 2 characters').max(100),
      conversationId: uuid.optional(),
      page: z.coerce.number().int().min(1).max(1000).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(20)
    }),
    'query'
  ),
  asyncHandler(async (req, res) => {
    const { q, conversationId, page, limit } = req.validatedQuery;
    const escaped = q.replace(/[\\%_]/g, '\\$&');
    const offset = (page - 1) * limit;
    const params = [req.auth.user.id, q, `%${escaped}%`, limit, offset];
    let conversationClause = '';
    if (conversationId) {
      params.push(conversationId);
      conversationClause = `AND m.conversation_id = $6`;
    }
    const rows = await query(
      `SELECT m.id, m.conversation_id, m.body, m.type, m.created_at, m.sender_id,
              c.type AS conversation_type, c.name AS conversation_name,
              p.display_name AS sender_name, u.username AS sender_username,
              count(*) OVER() AS total
         FROM messages m
         JOIN conversation_members cm
           ON cm.conversation_id = m.conversation_id AND cm.user_id = $1::uuid AND cm.left_at IS NULL
         JOIN conversations c ON c.id = m.conversation_id
         LEFT JOIN users u ON u.id = m.sender_id
         LEFT JOIN user_profiles p ON p.user_id = m.sender_id
        WHERE m.deleted_at IS NULL AND m.type <> 'system'
          AND (m.search_vector @@ websearch_to_tsquery('simple', $2) OR m.body ILIKE $3)
          ${conversationClause}
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT $4 OFFSET $5`,
      params
    );
    const total = rows.rows[0]?.total ?? 0;
    res.json({
      results: rows.rows.map((r) => ({
        id: r.id,
        conversationId: r.conversation_id,
        conversationType: r.conversation_type,
        conversationName: r.conversation_name,
        sender: { id: r.sender_id, username: r.sender_username, displayName: r.sender_name },
        type: r.type,
        body: r.body ? String(r.body).slice(0, 400) : null,
        createdAt: r.created_at
      })),
      pagination: {
        page,
        limit,
        total,
        hasMore: offset + rows.rows.length < total
      },
      query: q
    });
  })
);
