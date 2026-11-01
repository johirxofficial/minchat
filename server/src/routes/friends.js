import { Router } from 'express';
import { z } from 'zod';
import { one, query, withTransaction } from '../db.js';
import { asyncHandler, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { uuid, validate } from '../lib/validate.js';
import { requireAuth, csrfProtection } from '../middleware/auth.js';
import { friendLimiter } from '../middleware/rateLimit.js';
import { directKey, mutualFriendCount } from '../lib/access.js';
import { onlineFlags } from '../lib/presence.js';
import { createNotification, maybePush } from '../lib/notifications.js';
import { emitToUser } from '../realtime.js';
import { fileUrl } from '../lib/dto.js';

export const friendsRouter = Router();

function personSummary(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarUrl: fileUrl(row.avatar_file_id)
  };
}

async function loadTarget({ userId, username }) {
  const row = await one(
    `SELECT u.id, u.username, u.status, p.display_name, p.avatar_file_id, p.friend_request_policy,
            p.notify_friend_requests, p.push_enabled, p.discoverable
       FROM users u JOIN user_profiles p ON p.user_id=u.id
      WHERE ${userId ? 'u.id=$1' : 'u.username=$1'}`,
    [userId ?? String(username).toLowerCase()]
  );
  if (!row || row.status !== 'active') throw notFound('User not found', 'USER_NOT_FOUND');
  return row;
}

friendsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.auth.user.id;
    const rows = await query(
      `SELECT u.id, u.username, u.last_active_at,
              p.display_name, p.avatar_file_id, p.show_online_status, p.show_last_active
         FROM friendships f
         JOIN users u ON u.id = CASE WHEN f.user_a=$1::uuid THEN f.user_b ELSE f.user_a END
         JOIN user_profiles p ON p.user_id=u.id
        WHERE $1::uuid IN (f.user_a, f.user_b) AND u.status='active'
        ORDER BY lower(p.display_name), u.username`,
      [me]
    );
    const online = await onlineFlags(rows.rows.map((r) => r.id));
    res.json({
      friends: rows.rows.map((r) => ({
        ...personSummary(r),
        online: r.show_online_status ? online.has(r.id) : null,
        lastActiveAt: r.show_last_active === 'nobody' ? null : r.last_active_at
      }))
    });
  })
);

friendsRouter.get(
  '/requests',
  requireAuth,
  validate(
    z.object({ direction: z.enum(['incoming', 'outgoing']).default('incoming') }),
    'query'
  ),
  asyncHandler(async (req, res) => {
    const me = req.auth.user.id;
    const incoming = req.validatedQuery.direction === 'incoming';
    const rows = await query(
      `SELECT fr.id, fr.message, fr.status, fr.created_at,
              u.id AS user_id, u.username, u.last_active_at, p.display_name, p.avatar_file_id
         FROM friend_requests fr
         JOIN users u ON u.id = ${incoming ? 'fr.requester_id' : 'fr.addressee_id'}
         JOIN user_profiles p ON p.user_id=u.id
        WHERE ${incoming ? 'fr.addressee_id' : 'fr.requester_id'}=$1::uuid
          AND fr.status='pending' AND u.status='active'
        ORDER BY fr.created_at DESC
        LIMIT 100`,
      [me]
    );
    res.json({
      direction: req.validatedQuery.direction,
      requests: rows.rows.map((r) => ({
        id: r.id,
        message: r.message,
        createdAt: r.created_at,
        user: {
          id: r.user_id,
          username: r.username,
          displayName: r.display_name,
          avatarUrl: fileUrl(r.avatar_file_id)
        }
      }))
    });
  })
);

friendsRouter.post(
  '/requests',
  requireAuth,
  csrfProtection,
  friendLimiter,
  validate(
    z
      .object({
        userId: uuid.optional(),
        username: z.string().trim().min(3).max(30).optional(),
        message: z.string().trim().max(200).optional()
      })
      .refine((v) => v.userId || v.username, 'Choose a user')
  ),
  asyncHandler(async (req, res) => {
    const me = req.auth.user.id;
    const target = await loadTarget(req.body);
    if (target.id === me) throw badRequest('You cannot add yourself', 'SELF_REQUEST');

    const blocked = await one(
      'SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)',
      [me, target.id]
    );
    if (blocked) throw forbidden('You cannot send a friend request to this user', 'BLOCKED');

    const friend = await one(
      'SELECT 1 FROM friendships WHERE user_a=LEAST($1::uuid,$2::uuid) AND user_b=GREATEST($1::uuid,$2::uuid)',
      [me, target.id]
    );
    if (friend) throw conflict('You are already friends', 'ALREADY_FRIENDS');

    const existing = await one(
      `SELECT id, requester_id FROM friend_requests
        WHERE status='pending'
          AND ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1))
        LIMIT 1`,
      [me, target.id]
    );
    if (existing) {
      if (existing.requester_id === me) throw conflict('You already sent a request to this user', 'REQUEST_EXISTS');
      throw conflict('This user already sent you a request. Check your incoming requests.', 'INCOMING_REQUEST_EXISTS');
    }

    if (target.friend_request_policy === 'nobody') {
      throw forbidden('This user is not accepting friend requests', 'REQUESTS_DISABLED');
    }
    if (target.friend_request_policy === 'friends_of_friends') {
      const mutual = await mutualFriendCount(me, target.id);
      if (mutual === 0) throw forbidden('This user only accepts requests from friends of friends', 'REQUESTS_MUTUALS_ONLY');
    }

    let request;
    try {
      request = await one(
        `INSERT INTO friend_requests (requester_id, addressee_id, message)
         VALUES ($1,$2,$3) RETURNING *`,
        [me, target.id, req.body.message || null]
      );
    } catch (err) {
      if (err.code === '23505') throw conflict('A request is already pending', 'REQUEST_EXISTS');
      throw err;
    }

    const requester = await one(
      `SELECT u.id, u.username, p.display_name, p.avatar_file_id
         FROM users u JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1`,
      [me]
    );
    const payload = {
      requestId: request.id,
      message: request.message,
      user: personSummary(requester)
    };
    emitToUser(target.id, 'friend:request', payload);
    await createNotification({
      userId: target.id,
      type: 'friend_request',
      actorId: me,
      payload: { requestId: request.id, message: request.message }
    }).catch(() => {});
    await maybePush(
      { id: target.id, push_enabled: target.push_enabled, notify_friend_requests: target.notify_friend_requests },
      {
        type: 'friend_request',
        title: `New friend request from ${requester.display_name}`,
        body: request.message || 'Open MinChat to respond.',
        url: '/friends?tab=requests',
        tag: `friend-request-${request.id}`
      }
    ).catch(() => {});

    res.status(201).json({ request: { id: request.id, createdAt: request.created_at }, user: payload.user });
  })
);

async function respondToRequest(req, res, { action }) {
  const me = req.auth.user.id;
  const requestId = req.params.id;
  const result = await withTransaction(async (client) => {
    const rs = await client.query(
      'SELECT * FROM friend_requests WHERE id=$1 AND status=$2 FOR UPDATE',
      [requestId, 'pending']
    );
    const request = rs.rows[0];
    if (!request) throw notFound('Friend request not found', 'REQUEST_NOT_FOUND');
    if (action === 'accept' && request.addressee_id !== me) throw notFound('Friend request not found', 'REQUEST_NOT_FOUND');
    if (action === 'reject' && request.addressee_id !== me) throw notFound('Friend request not found', 'REQUEST_NOT_FOUND');
    if (action === 'cancel' && request.requester_id !== me) throw notFound('Friend request not found', 'REQUEST_NOT_FOUND');

    const status = action === 'accept' ? 'accepted' : action === 'reject' ? 'rejected' : 'cancelled';
    await client.query('UPDATE friend_requests SET status=$2, responded_at=now() WHERE id=$1', [request.id, status]);

    if (action === 'accept') {
      const [a, b] = [request.requester_id, request.addressee_id].sort();
      await client.query(
        `INSERT INTO friendships (user_a,user_b,created_by) VALUES ($1,$2,$3)
         ON CONFLICT (user_a,user_b) DO NOTHING`,
        [a, b, request.requester_id]
      );
    }
    return request;
  });

  const otherId = action === 'cancel' ? result.addressee_id : result.requester_id;
  const other = await one(
    `SELECT u.id,u.username,p.display_name,p.avatar_file_id FROM users u
       JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1`,
    [otherId]
  );
  const meRow = await one(
    `SELECT u.id,u.username,p.display_name,p.avatar_file_id FROM users u
       JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1`,
    [me]
  );

  if (action === 'accept') {
    emitToUser(otherId, 'friend:accepted', { user: personSummary(meRow), requestId: result.id });
    emitToUser(me, 'friend:accepted', { user: personSummary(other), requestId: result.id });
    await createNotification({
      userId: otherId,
      type: 'friend_accepted',
      actorId: me,
      payload: { requestId: result.id }
    }).catch(() => {});
    await maybePush(
      { id: otherId, push_enabled: true, notify_friend_requests: true },
      {
        type: 'friend_accepted',
        title: `${meRow.display_name} accepted your friend request`,
        body: 'You can now message each other.',
        url: '/friends',
        tag: `friend-accepted-${result.id}`
      }
    ).catch(() => {});
  } else {
    emitToUser(otherId, 'friend:request:update', { requestId: result.id, status });
    emitToUser(me, 'friend:request:update', { requestId: result.id, status });
  }

  res.json({ ok: true, status: action === 'accept' ? 'accepted' : action === 'reject' ? 'rejected' : 'cancelled' });
}

friendsRouter.post('/requests/:id/accept', requireAuth, csrfProtection, asyncHandler((req, res) => respondToRequest(req, res, { action: 'accept' })));
friendsRouter.post('/requests/:id/reject', requireAuth, csrfProtection, asyncHandler((req, res) => respondToRequest(req, res, { action: 'reject' })));
friendsRouter.post('/requests/:id/cancel', requireAuth, csrfProtection, asyncHandler((req, res) => respondToRequest(req, res, { action: 'cancel' })));

friendsRouter.delete(
  '/:userId',
  requireAuth,
  csrfProtection,
  asyncHandler(async (req, res) => {
    const me = req.auth.user.id;
    const other = req.params.userId;
    const deleted = await one(
      `DELETE FROM friendships
        WHERE user_a=LEAST($1::uuid,$2::uuid) AND user_b=GREATEST($1::uuid,$2::uuid)
        RETURNING user_a`,
      [me, other]
    );
    if (!deleted) throw notFound('Friendship not found', 'NOT_FRIENDS');
    emitToUser(other, 'friend:removed', { userId: me });
    emitToUser(me, 'friend:removed', { userId: other });
    res.json({ ok: true });
  })
);

friendsRouter.get(
  '/blocks/list',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT b.created_at, u.id, u.username, p.display_name, p.avatar_file_id
         FROM blocks b JOIN users u ON u.id=b.blocked_id
         JOIN user_profiles p ON p.user_id=u.id
        WHERE b.blocker_id=$1
        ORDER BY b.created_at DESC`,
      [req.auth.user.id]
    );
    res.json({
      blocks: rows.rows.map((r) => ({
        user: personSummary(r),
        blockedAt: r.created_at
      }))
    });
  })
);

friendsRouter.post(
  '/blocks',
  requireAuth,
  csrfProtection,
  validate(z.object({ userId: uuid })),
  asyncHandler(async (req, res) => {
    const me = req.auth.user.id;
    const other = req.body.userId;
    if (me === other) throw badRequest('You cannot block yourself', 'SELF_BLOCK');
    const user = await one("SELECT id FROM users WHERE id=$1 AND status='active'", [other]);
    if (!user) throw notFound('User not found');

    await withTransaction(async (client) => {
      await client.query('INSERT INTO blocks (blocker_id, blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [me, other]);
      await client.query(
        'DELETE FROM friendships WHERE user_a=LEAST($1::uuid,$2::uuid) AND user_b=GREATEST($1::uuid,$2::uuid)',
        [me, other]
      );
      await client.query(
        `UPDATE friend_requests SET status='cancelled', responded_at=now()
          WHERE status='pending' AND ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1))`,
        [me, other]
      );
      await client.query(
        `UPDATE calls SET status='ended', ended_at=now(), end_reason='blocked'
          WHERE status IN ('ringing','accepted') AND ((caller_id=$1 AND callee_id=$2) OR (caller_id=$2 AND callee_id=$1))`,
        [me, other]
      );
    });
    emitToUser(other, 'relation:changed', { userId: me, state: 'blocked' });
    emitToUser(me, 'relation:changed', { userId: other, state: 'blocked' });
    res.status(201).json({ ok: true });
  })
);

friendsRouter.delete(
  '/blocks/:userId',
  requireAuth,
  csrfProtection,
  asyncHandler(async (req, res) => {
    const deleted = await query('DELETE FROM blocks WHERE blocker_id=$1 AND blocked_id=$2', [
      req.auth.user.id,
      req.params.userId
    ]);
    if (!deleted.rowCount) throw notFound('Block not found');
    emitToUser(req.params.userId, 'relation:changed', { userId: req.auth.user.id, state: 'unblocked' });
    emitToUser(req.auth.user.id, 'relation:changed', { userId: req.params.userId, state: 'unblocked' });
    res.json({ ok: true });
  })
);
