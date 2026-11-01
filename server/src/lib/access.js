import { query, one } from '../db.js';
import { forbidden, notFound } from './errors.js';

export function directKey(a, b) {
  return [a, b].sort().join(':');
}

export async function areFriends(a, b) {
  if (!a || !b || a === b) return false;
  const row = await one(
    'SELECT 1 FROM friendships WHERE user_a = LEAST($1::uuid,$2::uuid) AND user_b = GREATEST($1::uuid,$2::uuid)',
    [a, b]
  );
  return Boolean(row);
}

export async function hasBlockBetween(a, b) {
  if (!a || !b) return false;
  const row = await one(
    'SELECT blocker_id, blocked_id FROM blocks WHERE (blocker_id=$1 AND blocked_id=$2) OR (blocker_id=$2 AND blocked_id=$1) LIMIT 1',
    [a, b]
  );
  return row || null;
}

export async function isOnlineUser(userId) {
  const row = await one("SELECT 1 FROM users WHERE id=$1 AND status='active'", [userId]);
  return Boolean(row);
}

export async function getMembership(conversationId, userId) {
  return one(
    `SELECT cm.*, c.type, c.name, c.direct_key, c.created_by, c.image_file_id
       FROM conversation_members cm
       JOIN conversations c ON c.id = cm.conversation_id
      WHERE cm.conversation_id = $1 AND cm.user_id = $2 AND cm.left_at IS NULL`,
    [conversationId, userId]
  );
}

export async function requireMembership(conversationId, userId, { admin = false } = {}) {
  const m = await getMembership(conversationId, userId);
  if (!m) throw notFound('Conversation not found', 'CONVERSATION_NOT_FOUND');
  if (admin && m.role !== 'admin') throw forbidden('Only group administrators can do that', 'ADMIN_REQUIRED');
  return m;
}

export async function getOtherMember(conversationId, userId) {
  return one(
    `SELECT u.id, u.username, u.last_active_at, p.display_name, p.avatar_file_id, p.show_online_status, p.show_last_active
       FROM conversation_members cm
       JOIN users u ON u.id = cm.user_id
       JOIN user_profiles p ON p.user_id = u.id
      WHERE cm.conversation_id=$1 AND cm.user_id<>$2 AND cm.left_at IS NULL AND u.status='active'
      LIMIT 1`,
    [conversationId, userId]
  );
}

/**
 * Ordinary one-to-one conversations require an accepted friendship, no block
 * in either direction, and the recipient's contact policy must not be "nobody".
 */
export async function canDirectMessage(senderId, recipientId) {
  if (senderId === recipientId) return { ok: false, reason: 'SELF' };
  if (!(await areFriends(senderId, recipientId))) return { ok: false, reason: 'NOT_FRIENDS' };
  if (await hasBlockBetween(senderId, recipientId)) return { ok: false, reason: 'BLOCKED' };
  const recipient = await one(
    `SELECT p.contact_policy FROM user_profiles p JOIN users u ON u.id=p.user_id
      WHERE p.user_id=$1 AND u.status='active'`,
    [recipientId]
  );
  if (!recipient) return { ok: false, reason: 'UNAVAILABLE' };
  if (recipient.contact_policy === 'nobody') return { ok: false, reason: 'CONTACT_DISABLED' };
  return { ok: true };
}

export async function mutualFriendCount(a, b) {
  const row = await one(
    `WITH fa AS (
       SELECT CASE WHEN user_a=$1 THEN user_b ELSE user_a END AS friend_id FROM friendships WHERE $1 IN (user_a,user_b)
     ), fb AS (
       SELECT CASE WHEN user_a=$2 THEN user_b ELSE user_a END AS friend_id FROM friendships WHERE $2 IN (user_a,user_b)
     )
     SELECT count(*)::int AS n FROM fa JOIN fb USING (friend_id)`,
    [a, b]
  );
  return row?.n ?? 0;
}

export async function friendIds(userId) {
  const rows = await query(
    `SELECT CASE WHEN user_a=$1 THEN user_b ELSE user_a END AS friend_id
       FROM friendships WHERE $1 IN (user_a, user_b)`,
    [userId]
  );
  return rows.rows.map((r) => r.friend_id);
}

export async function assertCanSendToConversation(conversationId, senderId) {
  const m = await requireMembership(conversationId, senderId);
  if (m.type === 'direct') {
    const other = await getOtherMember(conversationId, senderId);
    if (!other) throw forbidden('This conversation is no longer available', 'CONVERSATION_UNAVAILABLE');
    if (await hasBlockBetween(senderId, other.id))
      throw forbidden('You cannot message this user', 'BLOCKED');
    if (!(await areFriends(senderId, other.id)))
      throw forbidden('Only friends can exchange messages. Send a friend request first.', 'NOT_FRIENDS');
    const recipient = await one(
      `SELECT p.contact_policy FROM user_profiles p JOIN users u ON u.id=p.user_id WHERE p.user_id=$1 AND u.status='active'`,
      [other.id]
    );
    if (!recipient || recipient.contact_policy === 'nobody')
      throw forbidden('This user is not accepting messages', 'CONTACT_DISABLED');
  }
  return m;
}
