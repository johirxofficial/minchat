import { one, query } from '../db.js';
import { emitToUser } from '../realtime.js';
import { isOnline } from './presence.js';
import { sendPushToUser } from './push.js';

export async function createNotification({
  userId,
  type,
  actorId = null,
  conversationId = null,
  messageId = null,
  callId = null,
  payload = {}
}) {
  const notification = await one(
    `INSERT INTO notifications (user_id, type, actor_id, conversation_id, message_id, call_id, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [userId, type, actorId, conversationId, messageId, callId, payload]
  );
  const actor = actorId
    ? await one(
        `SELECT u.id, u.username, p.display_name, p.avatar_file_id FROM users u
           JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1`,
        [actorId]
      )
    : null;
  const dto = {
    id: notification.id,
    type,
    conversationId,
    messageId,
    callId,
    payload,
    readAt: null,
    createdAt: notification.created_at,
    actor: actor
      ? {
          id: actor.id,
          username: actor.username,
          displayName: actor.display_name,
          avatarUrl: actor.avatar_file_id ? `/api/files/${actor.avatar_file_id}` : null
        }
      : null
  };
  emitToUser(userId, 'notification:new', dto);
  return dto;
}

/**
 * Decide whether to send a browser push for a notification. Message pushes
 * are skipped while the recipient has a live socket connection (they already
 * receive the in-app event). Calls are handled separately.
 */
export async function maybePush(user, { type, title, body, url, tag }) {
  if (!user || !user.push_enabled) return;
  const preferenceOk =
    (type === 'message' && user.notify_messages) ||
    (type === 'friend_request' && user.notify_friend_requests) ||
    (type === 'missed_call' && user.notify_calls) ||
    type === 'friend_accepted' ||
    type === 'group_add';
  if (!preferenceOk) return;
  if (type !== 'missed_call' && (await isOnline(user.id))) return;
  await sendPushToUser(user.id, {
    type,
    title,
    body,
    url,
    tag,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png'
  }).catch(() => {});
}

export async function unreadNotificationCount(userId) {
  const row = await one(
    'SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND read_at IS NULL',
    [userId]
  );
  return row?.n ?? 0;
}

export async function markNotificationsRead(userId, { ids = null, conversationId = null } = {}) {
  if (ids?.length) {
    await query(
      'UPDATE notifications SET read_at=now() WHERE user_id=$1 AND id = ANY($2::uuid[]) AND read_at IS NULL',
      [userId, ids]
    );
  } else if (conversationId) {
    await query(
      'UPDATE notifications SET read_at=now() WHERE user_id=$1 AND conversation_id=$2 AND read_at IS NULL',
      [userId, conversationId]
    );
  } else {
    await query('UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL', [userId]);
  }
}
