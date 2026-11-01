import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { one, query, withTransaction } from '../db.js';
import { asyncHandler, badRequest, conflict, notFound, payloadTooLarge } from '../lib/errors.js';
import { bioSchema, displayNameSchema, usernameSchema, validate } from '../lib/validate.js';
import { requireAuth, csrfProtection } from '../middleware/auth.js';
import { rateLimit, searchLimiter, uploadLimiter } from '../middleware/rateLimit.js';
import { mutualFriendCount } from '../lib/access.js';
import { isOnline } from '../lib/presence.js';
import { fileUrl } from '../lib/dto.js';
import { loadMe } from '../lib/me.js';
import { receiveUpload, deleteFile } from '../lib/storage.js';
import { createPhoneVerification, verifyPhoneCode, removePhone, maskPhone } from '../lib/phone.js';
import { verifyPassword } from '../lib/tokens.js';

export const usersRouter = Router();

const escapeLike = (s) => s.replace(/[\\%_]/g, '\\$&');

usersRouter.get(
  '/search',
  requireAuth,
  searchLimiter,
  validate(
    z.object({
      q: z.string().trim().min(1, 'Enter a name or username').max(50),
      page: z.coerce.number().int().min(1).max(1000).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(20)
    }),
    'query'
  ),
  asyncHandler(async (req, res) => {
    const { q, page, limit } = req.validatedQuery;
    const me = req.auth.user.id;
    const pattern = `%${escapeLike(q)}%`;
    const offset = (page - 1) * limit;

    const rows = await query(
      `SELECT u.id, u.username, u.last_active_at,
              p.display_name, p.avatar_file_id, p.bio, p.visibility, p.bio_visibility,
              p.avatar_visibility, p.show_online_status, p.show_last_active, p.discoverable,
              EXISTS (
                SELECT 1 FROM friendships f
                 WHERE f.user_a = LEAST($1::uuid, u.id) AND f.user_b = GREATEST($1::uuid, u.id)
              ) AS is_friend,
              (SELECT fr.id FROM friend_requests fr
                WHERE fr.status='pending'
                  AND ((fr.requester_id=$1 AND fr.addressee_id=u.id) OR (fr.requester_id=u.id AND fr.addressee_id=$1))
                LIMIT 1) AS pending_request_id,
              (SELECT fr.requester_id FROM friend_requests fr
                WHERE fr.status='pending'
                  AND ((fr.requester_id=$1 AND fr.addressee_id=u.id) OR (fr.requester_id=u.id AND fr.addressee_id=$1))
                LIMIT 1) AS pending_from,
              count(*) OVER() AS total
         FROM users u
         JOIN user_profiles p ON p.user_id = u.id
        WHERE u.status='active' AND u.id <> $1::uuid
          AND (u.username::text ILIKE $2 OR p.display_name ILIKE $2)
          AND p.discoverable = true
          AND NOT EXISTS (
            SELECT 1 FROM blocks b
             WHERE (b.blocker_id=$1::uuid AND b.blocked_id=u.id)
                OR (b.blocker_id=u.id AND b.blocked_id=$1::uuid)
          )
        ORDER BY
          (lower(u.username::text) = lower($3)) DESC,
          (p.display_name ILIKE $4) DESC,
          u.username ASC
        LIMIT $5 OFFSET $6`,
      [me, pattern, q, `${escapeLike(q)}%`, limit, offset]
    );

    const results = rows.rows.map((r) => {
      const isFriend = Boolean(r.is_friend);
      const canSeeBio = isFriend || (r.visibility === 'public' && r.bio_visibility === 'public');
      const canSeeAvatar = isFriend || (r.visibility === 'public' && r.avatar_visibility === 'public');
      let relationship = 'none';
      if (isFriend) relationship = 'friends';
      else if (r.pending_request_id) relationship = r.pending_from === me ? 'outgoing' : 'incoming';
      return {
        id: r.id,
        username: r.username,
        displayName: r.display_name,
        avatarUrl: canSeeAvatar ? fileUrl(r.avatar_file_id) : null,
        bio: canSeeBio ? r.bio : null,
        visibility: r.visibility,
        isFriend,
        relationship,
        pendingRequestId: r.pending_request_id ?? null
      };
    });

    res.json({
      results,
      pagination: {
        page,
        limit,
        total: rows.rows[0]?.total ?? 0,
        hasMore: rows.rows.length === limit && offset + rows.rows.length < (rows.rows[0]?.total ?? 0)
      }
    });
  })
);

usersRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await loadMe(req.auth.user.id, req.auth.csrfToken));
  })
);

usersRouter.patch(
  '/me',
  requireAuth,
  csrfProtection,
  validate(
    z
      .object({
        displayName: displayNameSchema.optional(),
        bio: bioSchema.optional(),
        username: usernameSchema.optional()
      })
      .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to update')
  ),
  asyncHandler(async (req, res) => {
    const me = req.auth.user.id;
    const { displayName, bio, username } = req.body;
    try {
      await withTransaction(async (client) => {
        if (username !== undefined) {
          await client.query('UPDATE users SET username=$2 WHERE id=$1', [me, username]);
        }
        if (displayName !== undefined || bio !== undefined) {
          const fields = [];
          const values = [];
          if (displayName !== undefined) { fields.push(`display_name=$${fields.length + 1}`); values.push(displayName); }
          if (bio !== undefined) { fields.push(`bio=$${fields.length + 1}`); values.push(bio); }
          await client.query(
            `UPDATE user_profiles SET ${fields.join(', ')} WHERE user_id=$${fields.length + 1}`,
            [...values, me]
          );
        }
      });
    } catch (err) {
      if (err.code === '23505') throw conflict('That username is already taken', 'USERNAME_TAKEN');
      throw err;
    }
    res.json(await loadMe(me, req.auth.csrfToken));
  })
);

usersRouter.post(
  '/me/avatar',
  requireAuth,
  csrfProtection,
  uploadLimiter,
  asyncHandler(async (req, res) => {
    const { file } = await receiveUpload(req, req.auth.user.id, 'avatar');
    if (file.size_bytes > 8 * 1024 * 1024) {
      await deleteFile(file.id);
      throw payloadTooLarge('Profile photos must be at most 8 MB');
    }
    const previous = await one('SELECT avatar_file_id FROM user_profiles WHERE user_id=$1', [req.auth.user.id]);
    await query('UPDATE user_profiles SET avatar_file_id=$2 WHERE user_id=$1', [req.auth.user.id, file.id]);
    if (previous?.avatar_file_id) await deleteFile(previous.avatar_file_id);
    res.json({ ok: true, avatarUrl: fileUrl(file.id), fileId: file.id });
  })
);

usersRouter.delete(
  '/me/avatar',
  requireAuth,
  csrfProtection,
  asyncHandler(async (req, res) => {
    const previous = await one('SELECT avatar_file_id FROM user_profiles WHERE user_id=$1', [req.auth.user.id]);
    await query('UPDATE user_profiles SET avatar_file_id=NULL WHERE user_id=$1', [req.auth.user.id]);
    if (previous?.avatar_file_id) await deleteFile(previous.avatar_file_id);
    res.json({ ok: true });
  })
);

usersRouter.patch(
  '/me/settings',
  requireAuth,
  csrfProtection,
  validate(
    z
      .object({
        visibility: z.enum(['public', 'private']).optional(),
        bioVisibility: z.enum(['public', 'friends']).optional(),
        avatarVisibility: z.enum(['public', 'friends']).optional(),
        showLastActive: z.enum(['everyone', 'friends', 'nobody']).optional(),
        showOnlineStatus: z.boolean().optional(),
        friendRequestPolicy: z.enum(['everyone', 'friends_of_friends', 'nobody']).optional(),
        contactPolicy: z.enum(['friends', 'nobody']).optional(),
        discoverable: z.boolean().optional(),
        notifyMessages: z.boolean().optional(),
        notifyCalls: z.boolean().optional(),
        notifyFriendRequests: z.boolean().optional(),
        pushEnabled: z.boolean().optional()
      })
      .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to update')
  ),
  asyncHandler(async (req, res) => {
    const columnByField = {
      visibility: 'visibility',
      bioVisibility: 'bio_visibility',
      avatarVisibility: 'avatar_visibility',
      showLastActive: 'show_last_active',
      showOnlineStatus: 'show_online_status',
      friendRequestPolicy: 'friend_request_policy',
      contactPolicy: 'contact_policy',
      discoverable: 'discoverable',
      notifyMessages: 'notify_messages',
      notifyCalls: 'notify_calls',
      notifyFriendRequests: 'notify_friend_requests',
      pushEnabled: 'push_enabled'
    };
    const sets = [];
    const values = [];
    for (const [field, value] of Object.entries(req.body)) {
      if (value === undefined) continue;
      sets.push(`${columnByField[field]} = $${values.length + 1}`);
      values.push(value);
    }
    await query(
      `UPDATE user_profiles SET ${sets.join(', ')} WHERE user_id = $${values.length + 1}`,
      [...values, req.auth.user.id]
    );
    res.json(await loadMe(req.auth.user.id, req.auth.csrfToken));
  })
);

usersRouter.patch(
  '/me/phone',
  requireAuth,
  csrfProtection,
  rateLimit({ name: 'phone-add', windowMs: 60 * 60_000, max: 6, keyGenerator: (req) => req.auth?.user?.id, message: 'Too many phone verification requests.' }),
  validate(z.object({ phone: z.string().trim().min(8).max(24) })),
  asyncHandler(async (req, res) => {
    const user = await one(
      `SELECT u.id, u.email, u.username, u.phone, p.display_name
         FROM users u JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1`,
      [req.auth.user.id]
    );
    if (!user) throw badRequest('Account unavailable');
    if (user.phone) {
      throw badRequest('A phone number is already linked. Remove it before adding a new one.', 'PHONE_EXISTS');
    }
    const result = await createPhoneVerification(user, req.body.phone, 'verify');
    res.status(202).json({
      pending: true,
      phone: result.phone,
      maskedPhone: maskPhone(result.phone),
      expiresInSeconds: result.expiresInSeconds,
      delivery: result.delivery,
      message: 'We emailed a 6-digit code to your account address.'
    });
  })
);

usersRouter.post(
  '/me/phone/verify',
  requireAuth,
  csrfProtection,
  rateLimit({ name: 'phone-verify', windowMs: 15 * 60_000, max: 12, keyGenerator: (req) => req.auth?.user?.id, message: 'Too many code attempts.' }),
  validate(z.object({ code: z.string().trim().min(4).max(10) })),
  asyncHandler(async (req, res) => {
    const user = await one(
      `SELECT u.id, u.email, u.username, p.display_name
         FROM users u JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1`,
      [req.auth.user.id]
    );
    if (!user) throw badRequest('Account unavailable');
    const result = await verifyPhoneCode(user, req.body.code);
    res.json({ ok: true, ...result, me: await loadMe(req.auth.user.id, req.auth.csrfToken) });
  })
);

usersRouter.delete(
  '/me/phone',
  requireAuth,
  csrfProtection,
  validate(z.object({ password: z.string().min(1).max(200) })),
  asyncHandler(async (req, res) => {
    const user = await one(
      `SELECT u.id, u.email, u.username, u.phone, u.password_hash, p.display_name
         FROM users u JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1`,
      [req.auth.user.id]
    );
    if (!user?.phone) throw badRequest('No phone number is linked', 'NO_PHONE');
    if (!(await verifyPassword(user.password_hash, req.body.password))) {
      throw badRequest('Your password is incorrect', 'INVALID_PASSWORD');
    }
    await removePhone(user, user.phone);
    res.json({ ok: true, me: await loadMe(req.auth.user.id, req.auth.csrfToken) });
  })
);

usersRouter.get(
  '/:username',
  requireAuth,
  asyncHandler(async (req, res) => {
    const me = req.auth.user.id;
    const row = await one(
      `SELECT u.id, u.username, u.created_at, u.last_active_at, p.*
         FROM users u JOIN user_profiles p ON p.user_id=u.id
        WHERE u.username=$1 AND u.status='active'`,
      [req.params.username.toLowerCase()]
    );
    if (!row) throw notFound('User not found', 'USER_NOT_FOUND');
    const blocked = await one(
      `SELECT 1 FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1)`,
      [me, row.id]
    );
    if (blocked) throw notFound('User not found', 'USER_NOT_FOUND');

    const isSelf = row.id === me;
    const friend = isSelf
      ? false
      : Boolean(await one(
          'SELECT 1 FROM friendships WHERE user_a=LEAST($1::uuid,$2::uuid) AND user_b=GREATEST($1::uuid,$2::uuid)',
          [me, row.id]
        ));
    const pending = isSelf
      ? null
      : await one(
          `SELECT id, requester_id FROM friend_requests
            WHERE status='pending' AND ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1))
            LIMIT 1`,
          [me, row.id]
        );
    const mutual = isSelf ? 0 : await mutualFriendCount(me, row.id);
    const canSeePrivate = isSelf || friend || row.visibility === 'public';
    const canSeeBio = isSelf || friend || (row.visibility === 'public' && row.bio_visibility === 'public');
    const canSeeAvatar = isSelf || friend || (row.visibility === 'public' && row.avatar_visibility === 'public');

    const online = await isOnline(row.id);
    const lastActiveVisible =
      isSelf ||
      row.show_last_active === 'everyone' ||
      (friend && row.show_last_active === 'friends');
    const onlineVisible =
      isSelf ||
      (friend && row.show_online_status) ||
      (!friend && row.show_online_status && row.show_last_active === 'everyone');

    let canSendRequest = false;
    if (!isSelf && !friend && !pending) {
      if (row.friend_request_policy === 'everyone') canSendRequest = true;
      else if (row.friend_request_policy === 'friends_of_friends') canSendRequest = mutual > 0;
    }

    res.json({
      profile: {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        bio: canSeeBio ? row.bio : null,
        avatarUrl: canSeeAvatar ? fileUrl(row.avatar_file_id) : null,
        visibility: row.visibility,
        createdAt: row.created_at,
        isSelf,
        isFriend: friend,
        mutualFriends: canSeePrivate ? mutual : 0
      },
      presence: {
        online: onlineVisible ? online : null,
        visible: onlineVisible || lastActiveVisible,
        lastActiveAt: lastActiveVisible ? row.last_active_at : null
      },
      relationship: {
        isSelf,
        isFriend: friend,
        incomingRequestId: pending && pending.requester_id !== me ? pending.id : null,
        outgoingRequestId: pending && pending.requester_id === me ? pending.id : null,
        canSendRequest,
        canMessage: friend && row.contact_policy === 'friends'
      }
    });
  })
);
