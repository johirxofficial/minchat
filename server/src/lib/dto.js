import { config } from '../config.js';
import { capabilitiesFor, ROLE_LABELS } from './permissions.js';

export const fileUrl = (id) => (id ? `/api/files/${id}` : null);

export function meDto(row, { counts = {}, csrfToken = null } = {}) {
  return {
    user: {
      id: row.id,
      username: row.username,
      email: row.email,
      role: row.role,
      status: row.status,
      roleLabel: ROLE_LABELS[row.role] || row.role,
      capabilities: capabilitiesFor(row.role),
      phone: row.phone ?? null,
      phoneVerifiedAt: row.phone_verified_at ?? null,
      emailVerifiedAt: row.email_verified_at ?? null,
      displayName: row.display_name,
      bio: row.bio,
      avatarUrl: fileUrl(row.avatar_file_id),
      createdAt: row.created_at,
      lastActiveAt: row.last_active_at,
      settings: {
        visibility: row.visibility,
        bioVisibility: row.bio_visibility,
        avatarVisibility: row.avatar_visibility,
        showLastActive: row.show_last_active,
        showOnlineStatus: row.show_online_status,
        friendRequestPolicy: row.friend_request_policy,
        contactPolicy: row.contact_policy,
        discoverable: row.discoverable,
        notifyMessages: row.notify_messages,
        notifyCalls: row.notify_calls,
        notifyFriendRequests: row.notify_friend_requests,
        pushEnabled: row.push_enabled
      }
    },
    csrfToken,
    counts: {
      notifications: counts.notifications ?? 0,
      unreadMessages: counts.unread_messages ?? 0
    },
    pushPublicKey: config.vapid.publicKey || null,
    limits: {
      maxUploadMb: config.maxUploadMb,
      storageQuotaMb: config.userQuotaMb,
      maxGroupMembers: config.maxGroupMembers
    },
    server: { version: config.version, publicUrl: config.publicUrl }
  };
}

export function userSummary(row) {
  if (!row || !row.id) return null;
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name ?? row.displayName ?? row.username,
    avatarUrl: fileUrl(row.avatar_file_id ?? row.avatarFileId),
    status: row.status ?? 'active',
    isDeleted: (row.status ?? 'active') === 'deleted'
  };
}

export function profileDto(row, viewerId, { isFriend = false, isSelf = false } = {}) {
  if (!row) return null;
  const canSeeBio =
    isSelf ||
    isFriend ||
    (row.visibility === 'public' && row.bio_visibility === 'public') ||
    row.bio_visibility === 'public';
  const canSeeAvatar =
    isSelf || isFriend || row.avatar_visibility === 'public';
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    bio: canSeeBio ? row.bio : null,
    avatarUrl: canSeeAvatar ? fileUrl(row.avatar_file_id) : null,
    visibility: row.visibility,
    showOnlineStatus: isSelf || isFriend ? row.show_online_status : row.show_online_status && false,
    showLastActive: row.show_last_active,
    discoverable: row.discoverable,
    isFriend,
    isSelf,
    createdAt: row.created_at
  };
}

export function presenceDto(row, { online, lastActive }) {
  return {
    userId: row.id,
    username: row.username,
    displayName: row.display_name,
    online: Boolean(online),
    lastActiveAt: lastActive ?? null
  };
}

export function toMessage(row) {
  const deleted = Boolean(row.deleted_at);
  return {
    id: row.id,
    conversationId: row.conversation_id,
    type: row.type,
    body: deleted ? null : row.body,
    sender: row.sender && row.sender.id
      ? {
          id: row.sender.id,
          username: row.sender.username,
          displayName: row.sender.displayName || row.sender.username,
          avatarUrl: fileUrl(row.sender.avatarFileId),
          isDeleted: row.sender.status === 'deleted'
        }
      : null,
    replyTo: row.reply_to
      ? {
          id: row.reply_to.id,
          body: row.reply_to.body,
          type: row.reply_to.type,
          senderId: row.reply_to.senderId
        }
      : null,
    reactions: Array.isArray(row.reactions) ? row.reactions : [],
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
    receipts: {
      total: Number(row.receipt_total ?? 0),
      delivered: Number(row.receipt_delivered ?? 0),
      read: Number(row.receipt_read ?? 0)
    },
    editedAt: row.edited_at,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    clientNonce: row.client_nonce ?? null,
    isDeleted: deleted
  };
}

export const messageSelect = (viewerParam = '$1') => `
  SELECT m.id, m.conversation_id, m.sender_id, m.type, m.body, m.created_at,
         m.edited_at, m.deleted_at, m.reply_to_id, m.client_nonce,
         CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object(
           'id', u.id, 'username', u.username, 'displayName', p.display_name,
           'avatarFileId', p.avatar_file_id, 'status', u.status
         ) END AS sender,
         CASE WHEN rm.id IS NULL THEN NULL ELSE json_build_object(
           'id', rm.id, 'body', CASE WHEN rm.deleted_at IS NULL THEN left(rm.body, 300) ELSE NULL END,
           'senderId', rm.sender_id, 'type', rm.type
         ) END AS reply_to,
         COALESCE((
           SELECT json_agg(json_build_object(
             'emoji', x.emoji, 'count', x.count, 'me', x.me, 'userIds', x.user_ids
           ) ORDER BY x.emoji) FROM (
             SELECT r.emoji, count(*)::int AS count, bool_or(r.user_id = ${viewerParam}) AS me,
                    json_agg(r.user_id) AS user_ids
               FROM message_reactions r WHERE r.message_id = m.id GROUP BY r.emoji
           ) x
         ), '[]'::json) AS reactions,
         COALESCE((
           SELECT json_agg(json_build_object(
             'id', a.id, 'fileId', f.id, 'name', f.original_name, 'mime', f.mime,
             'size', f.size_bytes, 'kind', f.kind, 'durationMs', f.duration_ms,
             'url', '/api/files/' || f.id
           ) ORDER BY a.created_at)
             FROM attachments a JOIN files f ON f.id = a.file_id WHERE a.message_id = m.id
         ), '[]'::json) AS attachments,
         (SELECT count(*)::int FROM message_receipts r WHERE r.message_id = m.id) AS receipt_total,
         (SELECT count(*)::int FROM message_receipts r WHERE r.message_id = m.id AND r.delivered_at IS NOT NULL) AS receipt_delivered,
         (SELECT count(*)::int FROM message_receipts r WHERE r.message_id = m.id AND r.read_at IS NOT NULL) AS receipt_read
    FROM messages m
    LEFT JOIN users u ON u.id = m.sender_id
    LEFT JOIN user_profiles p ON p.user_id = u.id
    LEFT JOIN messages rm ON rm.id = m.reply_to_id
`;
