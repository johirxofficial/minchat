import { many, one, query } from '../db.js';
import { onlineFlags } from '../lib/presence.js';
import { fileUrl, messageSelect, toMessage } from '../lib/dto.js';
import { notFound } from '../lib/errors.js';
import { friendIds } from '../lib/access.js';

export async function friendIdSet(userId) {
  return new Set(await friendIds(userId));
}

function memberDto(m, { meId, online, friends }) {
  const isSelf = m.id === meId;
  const isFriend = friends.has(m.id);
  const displayName = m.displayName ?? m.display_name ?? m.username;
  const avatarFileId = m.avatarFileId ?? m.avatar_file_id;
  const showOnlineStatus = m.showOnlineStatus ?? m.show_online_status;
  const showLastActive = m.showLastActive ?? m.show_last_active;
  const lastActiveAt = m.lastActiveAt ?? m.last_active_at;
  const canSeeLastActive =
    showLastActive === 'everyone' ||
    (showLastActive === 'friends' && isFriend) ||
    isSelf;
  const canSeeOnline =
    showOnlineStatus &&
    (isSelf || isFriend || showLastActive === 'everyone');
  return {
    id: m.id,
    username: m.username,
    displayName,
    avatarUrl: fileUrl(avatarFileId),
    role: m.role,
    isSelf,
    online: canSeeOnline ? online : null,
    lastActiveAt: canSeeLastActive ? lastActiveAt : null
  };
}

export function previewOf(last) {
  if (!last) return null;
  if (last.deletedAt) return { id: last.id, type: 'system', body: null, deleted: true, senderId: last.senderId, senderName: null, createdAt: last.createdAt, hasAttachment: false };
  let body = last.body;
  if (!body) {
    body = last.type === 'image' ? 'Photo'
      : last.type === 'video' ? 'Video'
      : last.type === 'audio' ? 'Voice message'
      : last.type === 'file' ? 'Attachment'
      : '';
  }
  return {
    id: last.id,
    type: last.type,
    body: body ? String(body).slice(0, 160) : '',
    deleted: false,
    senderId: last.senderId,
    senderName: last.senderName,
    createdAt: last.createdAt,
    hasAttachment: Boolean(last.hasAttachment)
  };
}

async function hydrateMembers(rows, meId) {
  const ids = rows.map((m) => m.id);
  const online = await onlineFlags(ids);
  const friends = await friendIdSet(meId);
  return rows.map((m) => memberDto(m, { meId, online: online.has(m.id), friends }));
}

export async function conversationList(meId) {
  const rows = await query(
    `SELECT c.id, c.type, c.name, c.image_file_id, c.created_at, c.updated_at, c.last_message_at,
            cm.role AS my_role, cm.muted_until, cm.notification_level, cm.last_read_at,
            lm.id AS lm_id, lm.body AS lm_body, lm.type AS lm_type, lm.deleted_at AS lm_deleted_at,
            lm.created_at AS lm_created_at, lm.sender_id AS lm_sender_id,
            lp.display_name AS lm_sender_name,
            (lm.id IS NOT NULL AND EXISTS (SELECT 1 FROM attachments a WHERE a.message_id=lm.id)) AS lm_has_attachment,
            (SELECT count(*)::int FROM messages m
              WHERE m.conversation_id=c.id AND m.deleted_at IS NULL AND m.type<>'system'
                AND m.sender_id<>$1::uuid
                AND m.created_at >= cm.joined_at
                AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)) AS unread,
            (SELECT json_agg(json_build_object(
                       'id', u.id, 'username', u.username, 'displayName', p.display_name,
                       'avatarFileId', p.avatar_file_id, 'role', cm2.role,
                       'lastActiveAt', u.last_active_at, 'showOnlineStatus', p.show_online_status,
                       'showLastActive', p.show_last_active, 'contactPolicy', p.contact_policy
                     ) ORDER BY cm2.joined_at)
               FROM conversation_members cm2
               JOIN users u ON u.id=cm2.user_id
               JOIN user_profiles p ON p.user_id=u.id
              WHERE cm2.conversation_id=c.id AND cm2.left_at IS NULL AND u.status='active') AS members
       FROM conversation_members cm
       JOIN conversations c ON c.id=cm.conversation_id
       LEFT JOIN LATERAL (
         SELECT m.id, m.body, m.type, m.deleted_at, m.created_at, m.sender_id,
                sp.display_name AS sender_name
           FROM messages m
           LEFT JOIN user_profiles sp ON sp.user_id=m.sender_id
          WHERE m.conversation_id=c.id
          ORDER BY m.created_at DESC, m.id DESC
          LIMIT 1
       ) lm ON true
       LEFT JOIN user_profiles lp ON lp.user_id=lm.sender_id
      WHERE cm.user_id=$1::uuid AND cm.left_at IS NULL
      ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
      LIMIT 200`,
    [meId]
  );

  const blockedByMe = new Set(
    (await many('SELECT blocked_id FROM blocks WHERE blocker_id=$1', [meId])).map((r) => r.blocked_id)
  );
  const blockedMe = new Set(
    (await many('SELECT blocker_id FROM blocks WHERE blocked_id=$1', [meId])).map((r) => r.blocker_id)
  );
  const friends = await friendIdSet(meId);

  const allMemberIds = rows.rows.flatMap((r) => (Array.isArray(r.members) ? r.members.map((m) => m.id) : []));
  const online = await onlineFlags(allMemberIds);

  const conversations = [];
  for (const row of rows.rows) {
    const members = (Array.isArray(row.members) ? row.members : []).map((m) =>
      memberDto(m, { meId, online: online.has(m.id), friends })
    );
    const other = row.type === 'direct' ? members.find((m) => !m.isSelf) : null;
    if (row.type === 'direct') {
      if (!other) continue; // deleted or departed counterpart
      if (blockedByMe.has(other.id)) continue; // blocker hides the thread
    }
    const otherRaw = row.type === 'direct'
      ? (Array.isArray(row.members) ? row.members.find((m) => m.id !== meId) : null)
      : null;
    let canSend = true;
    let sendBlockedReason = null;
    if (row.type === 'direct') {
      if (blockedByMe.has(other.id) || blockedMe.has(other.id)) {
        canSend = false;
        sendBlockedReason = 'UNAVAILABLE';
      } else if (!friends.has(other.id)) {
        canSend = false;
        sendBlockedReason = 'NOT_FRIENDS';
      } else if (otherRaw && otherRaw.contactPolicy !== 'friends') {
        canSend = false;
        sendBlockedReason = 'CONTACT_DISABLED';
      }
    }
    conversations.push({
      id: row.id,
      type: row.type,
      name: row.name,
      avatarUrl: fileUrl(row.image_file_id),
      createdAt: row.created_at,
      lastMessageAt: row.last_message_at ?? row.created_at,
      unreadCount: row.unread ?? 0,
      notificationLevel: row.notification_level,
      mutedUntil: row.muted_until,
      myRole: row.my_role,
      isAdmin: row.my_role === 'admin',
      members,
      otherUser: other,
      lastMessage: previewOf(
        row.lm_id
          ? {
              id: row.lm_id,
              body: row.lm_body,
              type: row.lm_type,
              deletedAt: row.lm_deleted_at,
              createdAt: row.lm_created_at,
              senderId: row.lm_sender_id,
              senderName: row.lm_sender_name,
              hasAttachment: row.lm_has_attachment
            }
          : null
      ),
      canSend,
      sendBlockedReason
    });
  }
  return conversations;
}

export async function conversationView(conversationId, meId) {
  const row = await one(
    `SELECT c.id, c.type, c.name, c.image_file_id, c.created_by, c.created_at, c.updated_at, c.last_message_at,
            cm.role AS my_role, cm.joined_at, cm.last_read_at, cm.muted_until, cm.notification_level
       FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id=c.id AND cm.user_id=$2 AND cm.left_at IS NULL
      WHERE c.id=$1`,
    [conversationId, meId]
  );
  if (!row) throw notFound('Conversation not found', 'CONVERSATION_NOT_FOUND');

  const memberRows = await many(
    `SELECT u.id, u.username, u.last_active_at, p.display_name, p.avatar_file_id, p.show_online_status,
            p.show_last_active, p.contact_policy, cm.role
       FROM conversation_members cm
       JOIN users u ON u.id=cm.user_id
       JOIN user_profiles p ON p.user_id=u.id
      WHERE cm.conversation_id=$1 AND cm.left_at IS NULL AND u.status='active'
      ORDER BY cm.joined_at`,
    [conversationId]
  );
  const members = await hydrateMembers(memberRows, meId);
  const friends = await friendIdSet(meId);
  const other = row.type === 'direct' ? members.find((m) => !m.isSelf) : null;
  const blockedByMe = other
    ? await one('SELECT 1 FROM blocks WHERE blocker_id=$1 AND blocked_id=$2', [meId, other.id])
    : null;
  const blockedMe = other
    ? await one('SELECT 1 FROM blocks WHERE blocker_id=$1 AND blocked_id=$2', [other.id, meId])
    : null;

  let canSend = true;
  let sendBlockedReason = null;
  if (row.type === 'direct') {
    if (!other) {
      canSend = false;
      sendBlockedReason = 'UNAVAILABLE';
    } else if (blockedByMe || blockedMe) {
      canSend = false;
      sendBlockedReason = 'UNAVAILABLE';
    } else if (!friends.has(other.id)) {
      canSend = false;
      sendBlockedReason = 'NOT_FRIENDS';
    } else if (memberRows.find((m) => m.id === other.id)?.contact_policy !== 'friends') {
      canSend = false;
      sendBlockedReason = 'CONTACT_DISABLED';
    }
  }

  return {
    id: row.id,
    type: row.type,
    name: row.name,
    avatarUrl: fileUrl(row.image_file_id),
    createdBy: row.created_by,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at,
    myRole: row.my_role,
    isAdmin: row.my_role === 'admin',
    notificationLevel: row.notification_level,
    mutedUntil: row.muted_until,
    members,
    otherUser: other,
    canSend,
    sendBlockedReason
  };
}

export async function getMessages(conversationId, meId, { before = null, limit = 50 } = {}) {
  const membership = await one(
    'SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2 AND left_at IS NULL',
    [conversationId, meId]
  );
  if (!membership) throw notFound('Conversation not found', 'CONVERSATION_NOT_FOUND');

  const params = [meId, conversationId];
  let cursorClause = '';
  if (before) {
    params.push(before);
    cursorClause = `AND (m.created_at, m.id) < (SELECT created_at, id FROM messages WHERE id=$3 AND conversation_id=$2)`;
  }
  params.push(limit + 1);
  const rows = await query(
    `${messageSelect('$1')}
     WHERE m.conversation_id=$2 ${cursorClause}
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT $${params.length}`,
    params
  );
  const hasMore = rows.rows.length > limit;
  const page = hasMore ? rows.rows.slice(0, limit) : rows.rows;
  page.reverse();
  return {
    messages: page.map(toMessage),
    nextCursor: hasMore ? page[0]?.id ?? null : null,
    hasMore
  };
}

export async function unreadTotal(meId) {
  const row = await one(
    `SELECT count(*)::int AS n
       FROM messages m
       JOIN conversation_members cm ON cm.conversation_id=m.conversation_id
      WHERE cm.user_id=$1 AND cm.left_at IS NULL AND m.deleted_at IS NULL
        AND m.sender_id<>$1 AND m.type<>'system'
        AND m.created_at >= cm.joined_at
        AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)`,
    [meId]
  );
  return row?.n ?? 0;
}
