import { one, query, withTransaction } from '../db.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { messageSelect, toMessage } from '../lib/dto.js';
import { assertCanSendToConversation } from '../lib/access.js';
import { emitToRoom, emitToUser } from '../realtime.js';
import { isOnline } from '../lib/presence.js';
import { maybePush } from '../lib/notifications.js';
import { deleteFile } from '../lib/storage.js';

export const ALLOWED_REACTIONS = new Set([
  '👍', '❤️', '😂', '😮', '😢', '😡', '👏', '🔥', '🎉', '🙏', '💯', '✅',
  '😍', '😎', '🤔', '😴', '🙌', '💪', '👀', '🤝', '🥳', '😭', '😅', '🫶'
]);

const PREVIEW_TEXT = (type) =>
  type === 'image' ? 'Photo' : type === 'video' ? 'Video' : type === 'audio' ? 'Voice message' : type === 'file' ? 'Attachment' : 'New message';

async function fetchMessage(messageId, viewerId) {
  const row = await one(`${messageSelect('$1')} WHERE m.id=$2`, [viewerId, messageId]);
  return row ? toMessage(row) : null;
}

async function conversationMemberIds(conversationId) {
  const rows = await query(
    'SELECT user_id FROM conversation_members WHERE conversation_id=$1 AND left_at IS NULL',
    [conversationId]
  );
  return rows.rows.map((r) => r.user_id);
}

function emitConversationUpdate(conversationId, memberIds) {
  for (const id of memberIds) emitToUser(id, 'conversation:update', { conversationId });
}

async function notifyMessage({ conversation, message, sender, recipientRows }) {
  const recipients = recipientRows.filter(
    (r) =>
      r.user_id !== sender.id &&
      r.notify_messages &&
      r.notification_level !== 'none' &&
      !(r.muted_until && new Date(r.muted_until).getTime() > Date.now())
  );
  if (!recipients.length) return;

  const preview = message.body
    ? String(message.body).slice(0, 140)
    : PREVIEW_TEXT(message.type);
  const payload = {
    conversationId: conversation.id,
    conversationType: conversation.type,
    conversationName:
      conversation.type === 'group'
        ? conversation.name
        : sender.displayName,
    messageId: message.id,
    preview,
    senderName: sender.displayName,
    senderUsername: sender.username
  };

  let inserted = [];
  try {
    const result = await query(
      `INSERT INTO notifications (user_id, type, actor_id, conversation_id, message_id, payload)
       SELECT unnest($1::uuid[]), 'message', $2, $3, $4, $5::jsonb
       RETURNING id, user_id, created_at`,
      [recipients.map((r) => r.user_id), sender.id, conversation.id, message.id, JSON.stringify(payload)]
    );
    inserted = result.rows;
  } catch {
    // Notifications are helpful but must never lose a message.
    return;
  }

  const createdAt = new Date().toISOString();
  for (const row of inserted) {
    emitToUser(row.user_id, 'notification:new', {
      id: row.id,
      type: 'message',
      conversationId: conversation.id,
      messageId: message.id,
      payload,
      readAt: null,
      createdAt: row.created_at ?? createdAt,
      actor: {
        id: sender.id,
        username: sender.username,
        displayName: sender.displayName,
        avatarUrl: sender.avatarUrl ?? null
      }
    });
  }

  for (const r of recipients) {
    if (await isOnline(r.user_id).catch(() => false)) continue;
    await maybePush(
      { id: r.user_id, push_enabled: r.push_enabled, notify_messages: r.notify_messages },
      {
        type: 'message',
        title: conversation.type === 'group' ? conversation.name : sender.displayName,
        body: conversation.type === 'group' ? `${sender.displayName}: ${preview}` : preview,
        url: `/?c=${conversation.id}`,
        tag: `conversation-${conversation.id}`
      }
    ).catch(() => {});
  }
}

/**
 * Persist a message, then fan out real-time events. Delivery receipts are
 * created empty and only filled when a recipient's client acknowledges.
 */
export async function createMessage({
  conversationId,
  senderId,
  body = null,
  replyToId = null,
  clientNonce = null,
  attachmentIds = [],
  requestedType = 'text'
}) {
  const membership = await assertCanSendToConversation(conversationId, senderId);
  const conversation = await one('SELECT id, type, name FROM conversations WHERE id=$1', [conversationId]);

  if (clientNonce) {
    const existing = await one(
      'SELECT id FROM messages WHERE sender_id=$1 AND client_nonce=$2 AND conversation_id=$3',
      [senderId, clientNonce, conversationId]
    );
    if (existing) return { message: await fetchMessage(existing.id, senderId), duplicate: true };
  }

  if (!Array.isArray(attachmentIds)) attachmentIds = [];
  if (attachmentIds.length > 10) throw badRequest('A message can contain at most 10 files', 'TOO_MANY_ATTACHMENTS');
  if (new Set(attachmentIds).size !== attachmentIds.length) throw badRequest('Duplicate attachment', 'DUPLICATE_ATTACHMENT');

  let files = [];
  if (attachmentIds.length) {
    const res = await query(
      'SELECT * FROM files WHERE id = ANY($1::uuid[]) AND owner_id=$2',
      [attachmentIds, senderId]
    );
    if (res.rowCount !== attachmentIds.length) throw badRequest('One or more attachments are invalid', 'INVALID_ATTACHMENT');
    const attached = await query('SELECT file_id FROM attachments WHERE file_id = ANY($1::uuid[])', [attachmentIds]);
    if (attached.rowCount) throw badRequest('A file can only be attached once', 'ALREADY_ATTACHED');
    files = res.rows;
  }

  let type = requestedType;
  if (files.length) {
    const kinds = [...new Set(files.map((f) => f.kind))];
    if (kinds.includes('audio') && files.length === 1) type = 'audio';
    else if (kinds.length === 1 && kinds[0] === 'image') type = 'image';
    else if (kinds.length === 1 && kinds[0] === 'video') type = 'video';
    else type = 'file';
    if (['avatar', 'group_avatar'].includes(kinds[0])) throw badRequest('That file cannot be attached', 'INVALID_ATTACHMENT');
  } else if (!['text'].includes(type)) {
    throw badRequest('A media message needs an attachment', 'MISSING_ATTACHMENT');
  }

  let text = typeof body === 'string' ? body.trim() : null;
  if (text === '') text = null;
  if (type === 'text' && !text) throw badRequest('Write a message first', 'EMPTY_MESSAGE');
  if (text && text.length > 4000) throw badRequest('Messages must be at most 4000 characters', 'MESSAGE_TOO_LONG');
  if (type !== 'text' && text && text.length > 1000) throw badRequest('Captions must be at most 1000 characters', 'CAPTION_TOO_LONG');

  if (replyToId) {
    const reply = await one(
      'SELECT id FROM messages WHERE id=$1 AND conversation_id=$2 AND deleted_at IS NULL',
      [replyToId, conversationId]
    );
    if (!reply) throw badRequest('The message you replied to is unavailable', 'INVALID_REPLY');
  }

  let messageId;
  try {
    messageId = await withTransaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO messages (conversation_id, sender_id, type, body, reply_to_id, client_nonce)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`,
        [conversationId, senderId, type, text, replyToId, clientNonce]
      );
      const msg = inserted.rows[0];
      for (const file of files) {
        await client.query('INSERT INTO attachments (message_id, file_id) VALUES ($1,$2)', [msg.id, file.id]);
      }
      await client.query('UPDATE conversations SET last_message_at=$2 WHERE id=$1', [conversationId, msg.created_at]);
      await client.query(
        `INSERT INTO message_receipts (message_id, user_id)
         SELECT $1, cm.user_id FROM conversation_members cm
          WHERE cm.conversation_id=$2 AND cm.left_at IS NULL AND cm.user_id<>$3`,
        [msg.id, conversationId, senderId]
      );
      await client.query(
        `UPDATE conversation_members
            SET last_read_at=$3, last_read_message_id=$4
          WHERE conversation_id=$1 AND user_id=$2`,
        [conversationId, senderId, msg.created_at, msg.id]
      );
      return msg.id;
    });
  } catch (err) {
    if (err.code === '23505' && clientNonce) {
      const existing = await one(
        'SELECT id FROM messages WHERE sender_id=$1 AND client_nonce=$2 AND conversation_id=$3',
        [senderId, clientNonce, conversationId]
      );
      if (existing) return { message: await fetchMessage(existing.id, senderId), duplicate: true };
    }
    throw err;
  }

  const message = await fetchMessage(messageId, senderId);
  const memberIds = await conversationMemberIds(conversationId);
  emitToRoom(`conv:${conversationId}`, 'message:new', message);
  emitConversationUpdate(conversationId, memberIds);

  const recipientRows = await query(
    `SELECT cm.user_id, p.display_name, p.notify_messages, p.push_enabled, cm.muted_until, cm.notification_level
       FROM conversation_members cm JOIN user_profiles p ON p.user_id=cm.user_id
      WHERE cm.conversation_id=$1 AND cm.left_at IS NULL AND cm.user_id<>$2`,
    [conversationId, senderId]
  );
  await notifyMessage({
    conversation,
    message,
    sender: {
      id: senderId,
      username: message.sender?.username,
      displayName: message.sender?.displayName,
      avatarUrl: message.sender?.avatarUrl
    },
    recipientRows: recipientRows.rows
  });

  return { message, membership, duplicate: false };
}

export async function addSystemMessage(conversationId, actorId, text) {
  const inserted = await one(
    `INSERT INTO messages (conversation_id, sender_id, type, body)
     VALUES ($1,$2,'system',$3) RETURNING id, created_at`,
    [conversationId, actorId, String(text).slice(0, 4000)]
  );
  await query('UPDATE conversations SET last_message_at=$2 WHERE id=$1', [conversationId, inserted.created_at]);
  const message = await fetchMessage(inserted.id, actorId);
  const memberIds = await conversationMemberIds(conversationId);
  emitToRoom(`conv:${conversationId}`, 'message:new', message);
  emitConversationUpdate(conversationId, memberIds);
  return message;
}

export async function markDelivered(userId, messageIds) {
  const ids = [...new Set(messageIds)].slice(0, 100);
  if (!ids.length) return [];
  const updated = await query(
    `UPDATE message_receipts SET delivered_at=now()
      WHERE user_id=$1 AND message_id = ANY($2::uuid[]) AND delivered_at IS NULL
      RETURNING message_id`,
    [userId, ids]
  );
  if (!updated.rowCount) return [];
  await emitReceiptUpdates(updated.rows.map((r) => r.message_id));
  return updated.rows.map((r) => r.message_id);
}

export async function emitReceiptUpdates(messageIds) {
  if (!messageIds.length) return;
  const rows = await query(
    `SELECT r.message_id, m.conversation_id,
            count(*)::int AS total,
            count(*) FILTER (WHERE r.delivered_at IS NOT NULL)::int AS delivered,
            count(*) FILTER (WHERE r.read_at IS NOT NULL)::int AS read
       FROM message_receipts r JOIN messages m ON m.id=r.message_id
      WHERE r.message_id = ANY($1::uuid[])
      GROUP BY r.message_id, m.conversation_id`,
    [messageIds]
  );
  const byConversation = new Map();
  for (const row of rows.rows) {
    if (!byConversation.has(row.conversation_id)) byConversation.set(row.conversation_id, []);
    byConversation.get(row.conversation_id).push({
      messageId: row.message_id,
      conversationId: row.conversation_id,
      total: row.total,
      delivered: row.delivered,
      read: row.read
    });
  }
  for (const [conversationId, updates] of byConversation) {
    emitToRoom(`conv:${conversationId}`, 'message:receipts', { updates });
  }
}

export async function markRead(conversationId, userId, messageId) {
  const membership = await one(
    'SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2 AND left_at IS NULL',
    [conversationId, userId]
  );
  if (!membership) throw notFound('Conversation not found', 'CONVERSATION_NOT_FOUND');
  const message = await one(
    'SELECT id, created_at FROM messages WHERE id=$1 AND conversation_id=$2',
    [messageId, conversationId]
  );
  if (!message) throw badRequest('Message does not belong to this conversation', 'INVALID_MESSAGE');

  // Compare against the database timestamp itself: converting a timestamptz to
  // a JS Date truncates microseconds and can leave the newest message unread.
  const readIds = await query(
    `UPDATE message_receipts r
        SET delivered_at = COALESCE(r.delivered_at, now()), read_at = now()
       FROM messages m
      WHERE r.message_id=m.id AND r.user_id=$1 AND m.conversation_id=$2
        AND m.created_at <= (SELECT created_at FROM messages WHERE id=$3)
        AND r.read_at IS NULL
      RETURNING r.message_id`,
    [userId, conversationId, messageId]
  );

  await query(
    `UPDATE conversation_members
        SET last_read_message_id = CASE
              WHEN last_read_at IS NULL OR last_read_at <= (SELECT created_at FROM messages WHERE id=$3)
                THEN $3
              ELSE last_read_message_id END,
            last_read_at = GREATEST(
              COALESCE(last_read_at, (SELECT created_at FROM messages WHERE id=$3)),
              (SELECT created_at FROM messages WHERE id=$3)
            )
      WHERE conversation_id=$1 AND user_id=$2`,
    [conversationId, userId, message.id]
  );
  await query(
    `UPDATE notifications SET read_at=now()
      WHERE user_id=$1 AND conversation_id=$2 AND read_at IS NULL`,
    [userId, conversationId]
  );

  const ids = readIds.rows.map((r) => r.message_id);
  if (ids.length) await emitReceiptUpdates(ids);
  emitToRoom(`conv:${conversationId}`, 'conversation:read', {
    conversationId,
    userId,
    messageId: message.id,
    readAt: new Date().toISOString()
  });
  emitToUser(userId, 'conversation:update', { conversationId });
  return { read: ids.length };
}

export async function editMessage(messageId, userId, newBody) {
  const message = await one(
    `SELECT m.*, cm.role FROM messages m
       JOIN conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=$2 AND cm.left_at IS NULL
      WHERE m.id=$1`,
    [messageId, userId]
  );
  if (!message) throw notFound('Message not found', 'MESSAGE_NOT_FOUND');
  if (message.deleted_at) throw badRequest('Deleted messages cannot be edited', 'MESSAGE_DELETED');
  if (message.sender_id !== userId) throw forbidden('You can only edit your own messages', 'NOT_MESSAGE_SENDER');
  if (!['text', 'image', 'video', 'audio', 'file'].includes(message.type)) throw forbidden('This message cannot be edited');

  const text = typeof newBody === 'string' ? newBody.trim() : '';
  if (message.type === 'text' && !text) throw badRequest('Messages cannot be empty', 'EMPTY_MESSAGE');
  if (text.length > 4000) throw badRequest('Messages must be at most 4000 characters', 'MESSAGE_TOO_LONG');

  await query('UPDATE messages SET body=$2, edited_at=now() WHERE id=$1', [messageId, text || null]);
  const dto = await fetchMessage(messageId, userId);
  emitToRoom(`conv:${message.conversation_id}`, 'message:updated', dto);
  emitConversationUpdate(message.conversation_id, await conversationMemberIds(message.conversation_id));
  return dto;
}

export async function deleteMessage(messageId, userId) {
  const message = await one(
    `SELECT m.*, cm.role, c.type AS conversation_type
       FROM messages m
       JOIN conversations c ON c.id=m.conversation_id
       JOIN conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=$2 AND cm.left_at IS NULL
      WHERE m.id=$1`,
    [messageId, userId]
  );
  if (!message) throw notFound('Message not found', 'MESSAGE_NOT_FOUND');
  if (message.deleted_at) return fetchMessage(messageId, userId);
  const isSender = message.sender_id === userId;
  const isGroupAdmin = message.conversation_type === 'group' && message.role === 'admin';
  if (!isSender && !isGroupAdmin) {
    throw forbidden('You do not have permission to delete this message', 'DELETE_NOT_ALLOWED');
  }

  const attachmentFiles = await query('SELECT file_id FROM attachments WHERE message_id=$1', [messageId]);
  await withTransaction(async (client) => {
    await client.query(
      'UPDATE messages SET body=NULL, deleted_at=now(), deleted_by=$2 WHERE id=$1',
      [messageId, userId]
    );
    await client.query('DELETE FROM message_reactions WHERE message_id=$1', [messageId]);
    await client.query('DELETE FROM attachments WHERE message_id=$1', [messageId]);
  });
  for (const row of attachmentFiles.rows) {
    await deleteFile(row.file_id).catch(() => {});
  }

  const dto = await fetchMessage(messageId, userId);
  emitToRoom(`conv:${message.conversation_id}`, 'message:updated', dto);
  emitConversationUpdate(message.conversation_id, await conversationMemberIds(message.conversation_id));
  return dto;
}

async function reactionState(messageId, conversationId, viewerId) {
  const row = await one(
    `SELECT COALESCE((SELECT json_agg(json_build_object(
              'emoji', x.emoji, 'count', x.count, 'me', x.me, 'userIds', x.user_ids
            ) ORDER BY x.emoji) FROM (
              SELECT r.emoji, count(*)::int AS count, bool_or(r.user_id=$3) AS me,
                     json_agg(r.user_id) AS user_ids
                FROM message_reactions r WHERE r.message_id=$1 GROUP BY r.emoji
            ) x), '[]'::json) AS reactions`,
    [messageId, conversationId, viewerId]
  );
  return row.reactions;
}

export async function addReaction(messageId, userId, emoji) {
  if (!ALLOWED_REACTIONS.has(emoji)) throw badRequest('That reaction is not supported', 'INVALID_REACTION');
  const message = await one(
    `SELECT m.id, m.conversation_id, m.deleted_at FROM messages m
       JOIN conversation_members cm ON cm.conversation_id=m.conversation_id
      WHERE m.id=$1 AND cm.user_id=$2 AND cm.left_at IS NULL`,
    [messageId, userId]
  );
  if (!message) throw notFound('Message not found', 'MESSAGE_NOT_FOUND');
  if (message.deleted_at) throw badRequest('Cannot react to a deleted message', 'MESSAGE_DELETED');
  await query(
    'INSERT INTO message_reactions (message_id,user_id,emoji) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
    [messageId, userId, emoji]
  );
  const reactions = await reactionState(messageId, message.conversation_id, userId);
  emitToRoom(`conv:${message.conversation_id}`, 'message:reactions', {
    messageId,
    conversationId: message.conversation_id,
    reactions
  });
  return reactions;
}

export async function removeReaction(messageId, userId, emoji) {
  const message = await one(
    `SELECT m.id, m.conversation_id FROM messages m
       JOIN conversation_members cm ON cm.conversation_id=m.conversation_id
      WHERE m.id=$1 AND cm.user_id=$2 AND cm.left_at IS NULL`,
    [messageId, userId]
  );
  if (!message) throw notFound('Message not found', 'MESSAGE_NOT_FOUND');
  await query('DELETE FROM message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3', [
    messageId,
    userId,
    emoji
  ]);
  const reactions = await reactionState(messageId, message.conversation_id, userId);
  emitToRoom(`conv:${message.conversation_id}`, 'message:reactions', {
    messageId,
    conversationId: message.conversation_id,
    reactions
  });
  return reactions;
}
