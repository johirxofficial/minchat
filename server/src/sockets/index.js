import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { z } from 'zod';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { duplicateRedis } from '../redis.js';
import { sessionFromToken } from '../middleware/auth.js';
import { addPresence, removePresence, refreshPresence, onlineFlags } from '../lib/presence.js';
import { one, query } from '../db.js';
import { emitToUser, setIo } from '../realtime.js';
import { uuid } from '../lib/validate.js';
import { socketRateLimit } from '../middleware/rateLimit.js';
import { createMessage, markDelivered, markRead } from '../services/messages.js';
import { registerCallHandlers, handleCallDisconnect, recoverStaleCalls } from './calls.js';
import { fileUrl } from '../lib/dto.js';

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function originAllowed(origin) {
  if (!origin) return true;
  return config.allowedOrigins.includes(origin.replace(/\/+$/, ''));
}

async function friendRows(userId) {
  const rows = await query(
    `SELECT u.id, u.last_active_at, p.show_online_status, p.show_last_active
       FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.user_a=$1::uuid THEN f.user_b ELSE f.user_a END
       JOIN user_profiles p ON p.user_id=u.id
      WHERE $1::uuid IN (f.user_a, f.user_b) AND u.status='active'`,
    [userId]
  );
  return rows.rows;
}

async function broadcastPresence(userId, online, lastActiveAt = null) {
  const friends = await friendRows(userId);
  for (const friend of friends) {
    if (!friend.show_online_status) continue;
    const canSeeLastActive = friend.show_last_active === 'everyone' || friend.show_last_active === 'friends';
    emitToUser(friend.id, 'presence:update', {
      userId,
      online,
      lastActiveAt: canSeeLastActive ? lastActiveAt : null
    });
  }
}

async function presenceSnapshot(userId) {
  const friends = await friendRows(userId);
  const online = await onlineFlags(friends.map((f) => f.id));
  return friends
    .filter((f) => f.show_online_status)
    .map((f) => ({
      userId: f.id,
      online: online.has(f.id),
      lastActiveAt:
        f.show_last_active === 'nobody' || (f.show_last_active === 'friends' && false)
          ? null
          : f.last_active_at
    }));
}

const messageSchema = z.object({
  conversationId: uuid,
  body: z.string().max(4000).nullish(),
  replyToId: uuid.nullish(),
  clientNonce: z.string().min(8).max(64).nullish(),
  attachmentIds: z.array(uuid).max(10).default([]),
  type: z.enum(['text', 'image', 'video', 'audio', 'file']).default('text')
});

const typingSchema = z.object({
  conversationId: uuid,
  isTyping: z.boolean()
});

function reply(ack, payload) {
  if (typeof ack === 'function') ack(payload);
}

function socketError(err) {
  return {
    ok: false,
    error: {
      code: err.code || 'SOCKET_ERROR',
      message: err.status && err.message ? err.message : 'Unable to complete that action right now.'
    }
  };
}

export function initSockets(httpServer) {
  const io = new Server(httpServer, {
    path: '/socket.io',
    serveClient: false,
    maxHttpBufferSize: 256 * 1024,
    pingInterval: 25_000,
    pingTimeout: 20_000,
    connectionStateRecovery: {
      maxDisconnectionDuration: 120_000,
      skipMiddlewares: false
    },
    cors: {
      origin: (origin, callback) => callback(null, originAllowed(origin)),
      credentials: true
    },
    allowRequest: (req, callback) => {
      callback(null, originAllowed(req.headers.origin));
    }
  });

  const pubClient = duplicateRedis();
  const subClient = duplicateRedis();
  io.adapter(createAdapter(pubClient, subClient));
  setIo(io);

  io.use(async (socket, next) => {
    try {
      if (!originAllowed(socket.handshake.headers.origin)) return next(new Error('origin_not_allowed'));
      const cookies = parseCookies(socket.handshake.headers.cookie || '');
      const token = cookies[config.isTest ? 'minchat_session' : 'minchat_session'];
      if (!token) return next(new Error('unauthorized'));
      const row = await sessionFromToken(token);
      if (!row) return next(new Error('unauthorized'));
      socket.data.sessionId = row.session_id;
      socket.data.user = {
        id: row.user_id,
        username: row.username,
        role: row.role,
        displayName: row.display_name,
        avatarFileId: row.avatar_file_id
      };
      next();
    } catch (err) {
      logger.warn({ err }, 'socket authentication failed');
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const user = socket.data.user;
    const userId = user.id;
    socket.join(`user:${userId}`);
    socket.join(`session:${socket.data.sessionId}`);

    await addPresence(userId, socket.id).catch(() => {});
    await query('UPDATE users SET last_active_at=now() WHERE id=$1', [userId]).catch(() => {});

    try {
      const memberships = await query(
        'SELECT conversation_id FROM conversation_members WHERE user_id=$1 AND left_at IS NULL',
        [userId]
      );
      for (const row of memberships.rows) socket.join(`conv:${row.conversation_id}`);
    } catch (err) {
      logger.warn({ err }, 'failed to join conversation rooms');
    }

    broadcastPresence(userId, true).catch(() => {});
    const snapshot = await presenceSnapshot(userId).catch(() => []);
    socket.emit('presence:snapshot', { users: snapshot });
    socket.emit('session:ready', { userId, sessionId: socket.data.sessionId });

    const heartbeat = setInterval(() => {
      refreshPresence(userId, socket.id).catch(() => {});
      query('UPDATE users SET last_active_at=now() WHERE id=$1', [userId]).catch(() => {});
    }, 60_000);

    registerChatHandlers(io, socket);
    registerCallHandlers(io, socket);

    socket.on('presence:heartbeat', () => {
      refreshPresence(userId, socket.id).catch(() => {});
    });

    socket.on('disconnect', async () => {
      clearInterval(heartbeat);
      try {
        const lastSocket = await removePresence(userId, socket.id);
        if (lastSocket) {
          const lastActiveAt = new Date().toISOString();
          await query('UPDATE users SET last_active_at=now() WHERE id=$1', [userId]);
          broadcastPresence(userId, false, lastActiveAt).catch(() => {});
          await handleCallDisconnect(io, userId).catch((err) => logger.warn({ err }, 'call disconnect cleanup failed'));
        }
      } catch (err) {
        logger.warn({ err }, 'presence cleanup failed');
      }
    });
  });

  recoverStaleCalls().catch(() => {});
  return io;
}

function registerChatHandlers(io, socket) {
  const userId = socket.data.user.id;

  socket.on('conversation:join', async (payload, ack) => {
    try {
      const conversationId = payload?.conversationId;
      if (!uuid.safeParse(conversationId).success) throw Object.assign(new Error('Invalid conversation'), { code: 'BAD_REQUEST' });
      const member = await one(
        'SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2 AND left_at IS NULL',
        [conversationId, userId]
      );
      if (!member) throw Object.assign(new Error('Conversation not found'), { code: 'NOT_FOUND' });
      socket.join(`conv:${conversationId}`);
      reply(ack, { ok: true });
    } catch (err) {
      reply(ack, socketError(err));
    }
  });

  socket.on('message:send', async (payload, ack) => {
    try {
      if (!(await socketRateLimit(userId, 'message', 30, 10_000))) {
        throw Object.assign(new Error('Slow down'), { code: 'RATE_LIMITED' });
      }
      const parsed = messageSchema.safeParse(payload);
      if (!parsed.success) throw Object.assign(new Error('Invalid message'), { code: 'VALIDATION_ERROR' });
      const result = await createMessage({
        conversationId: parsed.data.conversationId,
        senderId: userId,
        body: parsed.data.body,
        replyToId: parsed.data.replyToId,
        clientNonce: parsed.data.clientNonce,
        attachmentIds: parsed.data.attachmentIds,
        requestedType: parsed.data.type
      });
      reply(ack, { ok: true, message: result.message, duplicate: result.duplicate });
    } catch (err) {
      logger.debug({ err }, 'socket message send failed');
      reply(ack, socketError(err));
    }
  });

  socket.on('message:delivered', async (payload, ack) => {
    try {
      if (!(await socketRateLimit(userId, 'delivered', 60, 10_000))) {
        throw Object.assign(new Error('Slow down'), { code: 'RATE_LIMITED' });
      }
      const parsed = z.object({ messageIds: z.array(uuid).min(1).max(100) }).safeParse(payload);
      if (!parsed.success) throw Object.assign(new Error('Invalid receipt'), { code: 'VALIDATION_ERROR' });
      const updated = await markDelivered(userId, parsed.data.messageIds);
      reply(ack, { ok: true, updated });
    } catch (err) {
      reply(ack, socketError(err));
    }
  });

  socket.on('conversation:read', async (payload, ack) => {
    try {
      if (!(await socketRateLimit(userId, 'read', 60, 10_000))) {
        throw Object.assign(new Error('Slow down'), { code: 'RATE_LIMITED' });
      }
      const parsed = z.object({ conversationId: uuid, messageId: uuid }).safeParse(payload);
      if (!parsed.success) throw Object.assign(new Error('Invalid read receipt'), { code: 'VALIDATION_ERROR' });
      const result = await markRead(parsed.data.conversationId, userId, parsed.data.messageId);
      reply(ack, { ok: true, ...result });
    } catch (err) {
      reply(ack, socketError(err));
    }
  });

  socket.on('typing', async (payload, ack) => {
    try {
      if (!(await socketRateLimit(userId, 'typing', 60, 10_000))) {
        reply(ack, { ok: false, error: { code: 'RATE_LIMITED', message: 'Slow down' } });
        return;
      }
      const parsed = typingSchema.safeParse(payload);
      if (!parsed.success) {
        reply(ack, { ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid typing event' } });
        return;
      }
      const member = await one(
        'SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2 AND left_at IS NULL',
        [parsed.data.conversationId, userId]
      );
      if (!member) {
        reply(ack, { ok: false, error: { code: 'NOT_FOUND', message: 'Conversation not found' } });
        return;
      }
      socket.to(`conv:${parsed.data.conversationId}`).emit('typing', {
        conversationId: parsed.data.conversationId,
        userId,
        displayName: socket.data.user.displayName,
        isTyping: parsed.data.isTyping
      });
      reply(ack, { ok: true });
    } catch {
      reply(ack, { ok: false, error: { code: 'SOCKET_ERROR', message: 'Unable to update typing state' } });
    }
  });
}
