import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { one, query, withTransaction } from '../db.js';
import { asyncHandler, badRequest, conflict, forbidden, notFound, payloadTooLarge } from '../lib/errors.js';
import { uuid, validate } from '../lib/validate.js';
import { requireAuth, csrfProtection } from '../middleware/auth.js';
import { messageLimiter, uploadLimiter } from '../middleware/rateLimit.js';
import { canDirectMessage, directKey, requireMembership } from '../lib/access.js';
import { conversationList, conversationView, getMessages } from '../services/conversations.js';
import { addSystemMessage, createMessage, markRead } from '../services/messages.js';
import { receiveUpload, deleteFile } from '../lib/storage.js';
import { fileUrl } from '../lib/dto.js';
import { createNotification } from '../lib/notifications.js';
import { emitToUser, joinUserToRoom, removeUserFromRoom } from '../realtime.js';

export const conversationsRouter = Router();

async function memberIds(conversationId) {
  const rows = await query(
    'SELECT user_id FROM conversation_members WHERE conversation_id=$1 AND left_at IS NULL',
    [conversationId]
  );
  return rows.rows.map((r) => r.user_id);
}

function touchMembers(conversationId, ids) {
  for (const id of ids) emitToUser(id, 'conversation:update', { conversationId });
}

async function activeFriendsOf(userId, targetIds) {
  if (!targetIds.length) return [];
  const rows = await query(
    `SELECT u.id, u.username, p.display_name FROM users u
       JOIN user_profiles p ON p.user_id=u.id
      WHERE u.id = ANY($1::uuid[]) AND u.status='active'
        AND EXISTS (
          SELECT 1 FROM friendships f
           WHERE f.user_a=LEAST($2::uuid,u.id) AND f.user_b=GREATEST($2::uuid,u.id)
        )
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
           WHERE (b.blocker_id=$2::uuid AND b.blocked_id=u.id)
              OR (b.blocker_id=u.id AND b.blocked_id=$2::uuid)
        )`,
    [targetIds, userId]
  );
  return rows.rows;
}

conversationsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ conversations: await conversationList(req.auth.user.id) });
  })
);

conversationsRouter.post(
  '/direct',
  requireAuth,
  csrfProtection,
  validate(z.object({ userId: uuid })),
  asyncHandler(async (req, res) => {
    const me = req.auth.user.id;
    const other = req.body.userId;
    const target = await one(
      `SELECT u.id, u.username, p.display_name, p.contact_policy FROM users u
         JOIN user_profiles p ON p.user_id=u.id
        WHERE u.id=$1 AND u.status='active'`,
      [other]
    );
    if (!target) throw notFound('User not found', 'USER_NOT_FOUND');
    const allowed = await canDirectMessage(me, other);
    if (!allowed.ok) {
      const map = {
        NOT_FRIENDS: ['Only friends can start a conversation', 'NOT_FRIENDS'],
        BLOCKED: ['You cannot message this user', 'BLOCKED'],
        CONTACT_DISABLED: ['This user is not accepting messages', 'CONTACT_DISABLED'],
        UNAVAILABLE: ['This user is unavailable', 'UNAVAILABLE'],
        SELF: ['You cannot message yourself', 'SELF']
      };
      const [message, code] = map[allowed.reason] ?? ['Unable to start conversation', 'UNAVAILABLE'];
      throw forbidden(message, code);
    }

    const key = directKey(me, other);
    const conversationId = await withTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
      const existing = await client.query('SELECT id FROM conversations WHERE direct_key=$1', [key]);
      if (existing.rows[0]) {
        const id = existing.rows[0].id;
        for (const userId of [me, other]) {
          await client.query(
            `INSERT INTO conversation_members (conversation_id, user_id, joined_at, last_read_at)
             VALUES ($1,$2,now(),now())
             ON CONFLICT (conversation_id,user_id)
             DO UPDATE SET left_at=NULL, joined_at=CASE WHEN conversation_members.left_at IS NOT NULL THEN now() ELSE conversation_members.joined_at END`,
            [id, userId]
          );
        }
        return id;
      }
      const created = await client.query(
        `INSERT INTO conversations (type, direct_key, created_by) VALUES ('direct',$1,$2) RETURNING id`,
        [key, me]
      );
      const id = created.rows[0].id;
      for (const userId of [me, other]) {
        await client.query(
          'INSERT INTO conversation_members (conversation_id,user_id,last_read_at) VALUES ($1,$2,now())',
          [id, userId]
        );
      }
      return id;
    });

    joinUserToRoom(me, `conv:${conversationId}`);
    joinUserToRoom(other, `conv:${conversationId}`);
    const conversation = await conversationView(conversationId, me);
    emitToUser(other, 'conversation:created', { conversationId });
    touchMembers(conversationId, [me, other]);
    res.status(201).json({ conversation });
  })
);

conversationsRouter.post(
  '/group',
  requireAuth,
  csrfProtection,
  validate(
    z.object({
      name: z.string().trim().min(1, 'Group name is required').max(80),
      memberIds: z.array(uuid).min(1, 'Add at least one friend').max(config.maxGroupMembers)
    })
  ),
  asyncHandler(async (req, res) => {
    const me = req.auth.user.id;
    const ids = [...new Set(req.body.memberIds)].filter((id) => id !== me);
    if (!ids.length) throw badRequest('Add at least one friend', 'NO_MEMBERS');
    if (ids.length + 1 > config.maxGroupMembers) throw badRequest(`Groups can have at most ${config.maxGroupMembers} members`, 'GROUP_TOO_LARGE');
    const friends = await activeFriendsOf(me, ids);
    if (friends.length !== ids.length) throw badRequest('You can only add your friends to a group', 'NOT_FRIENDS');
    const actor = await one(
      `SELECT u.username, p.display_name FROM users u JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1`,
      [me]
    );

    const conversationId = await withTransaction(async (client) => {
      const created = await client.query(
        `INSERT INTO conversations (type, name, created_by) VALUES ('group',$1,$2) RETURNING id`,
        [req.body.name, me]
      );
      const id = created.rows[0].id;
      await client.query(
        `INSERT INTO conversation_members (conversation_id,user_id,role,last_read_at)
         VALUES ($1,$2,'admin',now())`,
        [id, me]
      );
      for (const friendId of ids) {
        await client.query(
          `INSERT INTO conversation_members (conversation_id,user_id,role,last_read_at)
           VALUES ($1,$2,'member',now())`,
          [id, friendId]
        );
      }
      return id;
    });

    for (const id of [me, ...ids]) joinUserToRoom(id, `conv:${conversationId}`);
    await addSystemMessage(conversationId, me, `${actor.display_name} created the group`);
    for (const friendId of ids) {
      emitToUser(friendId, 'conversation:created', { conversationId });
      await createNotification({
        userId: friendId,
        type: 'group_add',
        actorId: me,
        conversationId,
        payload: { groupName: req.body.name }
      }).catch(() => {});
    }
    res.status(201).json({ conversation: await conversationView(conversationId, me) });
  })
);

conversationsRouter.get(
  '/:id',
  requireAuth,
  validate(z.object({ id: uuid }), 'params'),
  asyncHandler(async (req, res) => {
    res.json({ conversation: await conversationView(req.params.id, req.auth.user.id) });
  })
);

conversationsRouter.patch(
  '/:id',
  requireAuth,
  csrfProtection,
  validate(z.object({ id: uuid }), 'params'),
  validate(z.object({ name: z.string().trim().min(1).max(80) })),
  asyncHandler(async (req, res) => {
    const me = req.auth.user.id;
    const membership = await requireMembership(req.params.id, me, { admin: true });
    if (membership.type !== 'group') throw badRequest('Only groups have names', 'NOT_A_GROUP');
    await query('UPDATE conversations SET name=$2 WHERE id=$1', [req.params.id, req.body.name]);
    const actor = await one('SELECT display_name FROM user_profiles WHERE user_id=$1', [me]);
    await addSystemMessage(req.params.id, me, `${actor.display_name} renamed the group to "${req.body.name}"`);
    touchMembers(req.params.id, await memberIds(req.params.id));
    res.json({ conversation: await conversationView(req.params.id, me) });
  })
);

conversationsRouter.post(
  '/:id/image',
  requireAuth,
  csrfProtection,
  uploadLimiter,
  validate(z.object({ id: uuid }), 'params'),
  asyncHandler(async (req, res) => {
    const me = req.auth.user.id;
    await requireMembership(req.params.id, me, { admin: true });
    const { file } = await receiveUpload(req, me, 'group_avatar');
    if (file.size_bytes > 8 * 1024 * 1024) {
      await deleteFile(file.id);
      throw payloadTooLarge('Group photos must be at most 8 MB');
    }
    const previous = await one('SELECT image_file_id FROM conversations WHERE id=$1', [req.params.id]);
    await query('UPDATE conversations SET image_file_id=$2 WHERE id=$1', [req.params.id, file.id]);
    if (previous?.image_file_id) await deleteFile(previous.image_file_id);
    touchMembers(req.params.id, await memberIds(req.params.id));
    res.json({ ok: true, avatarUrl: fileUrl(file.id) });
  })
);

conversationsRouter.post(
  '/:id/members',
  requireAuth,
  csrfProtection,
  validate(z.object({ id: uuid }), 'params'),
  validate(z.object({ userIds: z.array(uuid).min(1).max(50) })),
  asyncHandler(async (req, res) => {
    const me = req.auth.user.id;
    await requireMembership(req.params.id, me, { admin: true });
    const ids = [...new Set(req.body.userIds)].filter((id) => id !== me);
    if (!ids.length) throw badRequest('Choose at least one friend', 'NO_MEMBERS');
    const current = await memberIds(req.params.id);
    if (current.length + ids.length > config.maxGroupMembers) {
      throw badRequest(`Groups can have at most ${config.maxGroupMembers} members`, 'GROUP_TOO_LARGE');
    }
    const friends = await activeFriendsOf(me, ids);
    if (friends.length !== ids.length) throw badRequest('You can only add your friends to a group', 'NOT_FRIENDS');

    for (const friendId of ids) {
      await query(
        `INSERT INTO conversation_members (conversation_id,user_id,role,last_read_at)
         VALUES ($1,$2,'member',now())
         ON CONFLICT (conversation_id,user_id)
         DO UPDATE SET left_at=NULL, joined_at=now(), last_read_at=now()`,
        [req.params.id, friendId]
      );
    }
    const actor = await one('SELECT display_name FROM user_profiles WHERE user_id=$1', [me]);
    const group = await one('SELECT name FROM conversations WHERE id=$1', [req.params.id]);
    const names = friends.map((f) => f.display_name).join(', ');
    await addSystemMessage(req.params.id, me, `${actor.display_name} added ${names}`);
    for (const friendId of ids) {
      joinUserToRoom(friendId, `conv:${req.params.id}`);
      emitToUser(friendId, 'conversation:created', { conversationId: req.params.id });
      await createNotification({
        userId: friendId,
        type: 'group_add',
        actorId: me,
        conversationId: req.params.id,
        payload: { groupName: group?.name ?? 'a group' }
      }).catch(() => {});
    }
    touchMembers(req.params.id, await memberIds(req.params.id));
    res.json({ conversation: await conversationView(req.params.id, me) });
  })
);

async function removeMember({ conversationId, actorId, targetId }) {
  const membership = await requireMembership(conversationId, actorId);
  if (membership.type !== 'group') throw badRequest('Not a group conversation', 'NOT_A_GROUP');
  if (targetId !== actorId && membership.role !== 'admin') {
    throw forbidden('Only group administrators can remove members', 'ADMIN_REQUIRED');
  }
  const target = await one(
    `SELECT cm.role, p.display_name FROM conversation_members cm
       JOIN user_profiles p ON p.user_id=cm.user_id
      WHERE cm.conversation_id=$1 AND cm.user_id=$2 AND cm.left_at IS NULL`,
    [conversationId, targetId]
  );
  if (!target) throw notFound('Member not found', 'MEMBER_NOT_FOUND');

  if (target.role === 'admin') {
    const admins = await one(
      `SELECT count(*)::int AS n FROM conversation_members
        WHERE conversation_id=$1 AND role='admin' AND left_at IS NULL`,
      [conversationId]
    );
    if (admins.n <= 1) {
      if (targetId !== actorId) throw badRequest('A group must keep at least one administrator', 'LAST_ADMIN');
      const successor = await one(
        `SELECT user_id FROM conversation_members
          WHERE conversation_id=$1 AND user_id<>$2 AND left_at IS NULL
          ORDER BY joined_at LIMIT 1`,
        [conversationId, targetId]
      );
      if (successor) {
        await query(
          `UPDATE conversation_members SET role='admin' WHERE conversation_id=$1 AND user_id=$2`,
          [conversationId, successor.user_id]
        );
      }
    }
  }

  await query(
    'UPDATE conversation_members SET left_at=now() WHERE conversation_id=$1 AND user_id=$2',
    [conversationId, targetId]
  );
  removeUserFromRoom(targetId, `conv:${conversationId}`);
  emitToUser(targetId, 'conversation:removed', { conversationId });
  const remaining = await memberIds(conversationId);
  const actor = await one('SELECT display_name FROM user_profiles WHERE user_id=$1', [actorId]);
  if (remaining.length) {
    await addSystemMessage(
      conversationId,
      actorId,
      targetId === actorId
        ? `${actor.display_name} left the group`
        : `${actor.display_name} removed ${target.display_name}`
    );
    touchMembers(conversationId, remaining);
  }
  if (targetId !== actorId) {
    await createNotification({
      userId: targetId,
      type: 'group_remove',
      actorId,
      conversationId,
      payload: {}
    }).catch(() => {});
  }
  return { ok: true };
}

conversationsRouter.delete(
  '/:id/members/:userId',
  requireAuth,
  csrfProtection,
  validate(z.object({ id: uuid, userId: uuid }), 'params'),
  asyncHandler(async (req, res) => {
    res.json(await removeMember({
      conversationId: req.params.id,
      actorId: req.auth.user.id,
      targetId: req.params.userId
    }));
  })
);

conversationsRouter.post(
  '/:id/leave',
  requireAuth,
  csrfProtection,
  validate(z.object({ id: uuid }), 'params'),
  asyncHandler(async (req, res) => {
    res.json(await removeMember({
      conversationId: req.params.id,
      actorId: req.auth.user.id,
      targetId: req.auth.user.id
    }));
  })
);

conversationsRouter.patch(
  '/:id/members/:userId',
  requireAuth,
  csrfProtection,
  validate(z.object({ id: uuid, userId: uuid }), 'params'),
  validate(z.object({ role: z.enum(['admin', 'member']) })),
  asyncHandler(async (req, res) => {
    const me = req.auth.user.id;
    await requireMembership(req.params.id, me, { admin: true });
    const target = await one(
      'SELECT role FROM conversation_members WHERE conversation_id=$1 AND user_id=$2 AND left_at IS NULL',
      [req.params.id, req.params.userId]
    );
    if (!target) throw notFound('Member not found', 'MEMBER_NOT_FOUND');
    if (target.role === 'admin' && req.body.role === 'member') {
      const admins = await one(
        `SELECT count(*)::int AS n FROM conversation_members WHERE conversation_id=$1 AND role='admin' AND left_at IS NULL`,
        [req.params.id]
      );
      if (admins.n <= 1) throw badRequest('A group must keep at least one administrator', 'LAST_ADMIN');
    }
    await query(
      'UPDATE conversation_members SET role=$3 WHERE conversation_id=$1 AND user_id=$2',
      [req.params.id, req.params.userId, req.body.role]
    );
    touchMembers(req.params.id, await memberIds(req.params.id));
    res.json({ conversation: await conversationView(req.params.id, me) });
  })
);

conversationsRouter.patch(
  '/:id/settings',
  requireAuth,
  csrfProtection,
  validate(z.object({ id: uuid }), 'params'),
  validate(
    z.object({
      notificationLevel: z.enum(['all', 'mentions', 'none']).optional(),
      mutedUntil: z.string().datetime().nullable().optional()
    })
  ),
  asyncHandler(async (req, res) => {
    const vals = [];
    const sets = [];
    if (req.body.notificationLevel !== undefined) {
      sets.push(`notification_level=$${vals.length + 1}`);
      vals.push(req.body.notificationLevel);
    }
    if (req.body.mutedUntil !== undefined) {
      sets.push(`muted_until=$${vals.length + 1}`);
      vals.push(req.body.mutedUntil);
    }
    if (!sets.length) throw badRequest('Nothing to update');
    await requireMembership(req.params.id, req.auth.user.id);
    await query(
      `UPDATE conversation_members SET ${sets.join(', ')}
        WHERE conversation_id=$${vals.length + 1} AND user_id=$${vals.length + 2}`,
      [...vals, req.params.id, req.auth.user.id]
    );
    res.json({ conversation: await conversationView(req.params.id, req.auth.user.id) });
  })
);

conversationsRouter.get(
  '/:id/messages',
  requireAuth,
  validate(z.object({ id: uuid }), 'params'),
  validate(
    z.object({
      before: uuid.optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50)
    }),
    'query'
  ),
  asyncHandler(async (req, res) => {
    const { before, limit } = req.validatedQuery;
    res.json(await getMessages(req.params.id, req.auth.user.id, { before, limit }));
  })
);

conversationsRouter.post(
  '/:id/messages',
  requireAuth,
  csrfProtection,
  messageLimiter,
  validate(z.object({ id: uuid }), 'params'),
  validate(
    z.object({
      body: z.string().max(4000).optional().nullable(),
      replyToId: uuid.optional().nullable(),
      clientNonce: z.string().min(8).max(64).optional().nullable(),
      attachmentIds: z.array(uuid).max(10).default([]),
      type: z.enum(['text', 'image', 'video', 'audio', 'file']).default('text')
    })
  ),
  asyncHandler(async (req, res) => {
    const result = await createMessage({
      conversationId: req.params.id,
      senderId: req.auth.user.id,
      body: req.body.body,
      replyToId: req.body.replyToId,
      clientNonce: req.body.clientNonce,
      attachmentIds: req.body.attachmentIds,
      requestedType: req.body.type
    });
    res.status(201).json({ message: result.message, duplicate: result.duplicate });
  })
);

conversationsRouter.post(
  '/:id/read',
  requireAuth,
  csrfProtection,
  validate(z.object({ id: uuid }), 'params'),
  validate(z.object({ messageId: uuid })),
  asyncHandler(async (req, res) => {
    res.json(await markRead(req.params.id, req.auth.user.id, req.body.messageId));
  })
);
