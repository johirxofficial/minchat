import { z } from 'zod';
import { config } from '../config.js';
import { one, query } from '../db.js';
import { logger } from '../logger.js';
import { uuid } from '../lib/validate.js';
import { socketRateLimit } from '../middleware/rateLimit.js';
import { canDirectMessage, getMembership, getOtherMember } from '../lib/access.js';
import { isOnline } from '../lib/presence.js';
import { createNotification, maybePush } from '../lib/notifications.js';
import { emitToUser } from '../realtime.js';
import { fileUrl } from '../lib/dto.js';

const ringTimers = new Map();

function clearRingTimer(callId) {
  const timer = ringTimers.get(callId);
  if (timer) clearTimeout(timer);
  ringTimers.delete(callId);
}

function socketReply(ack, payload) {
  if (typeof ack === 'function') ack(payload);
}

function callError(code, message) {
  return { ok: false, error: { code, message } };
}

export async function callDto(callId) {
  const row = await one(
    `SELECT c.*,
            cu.username AS caller_username, cp.display_name AS caller_display_name, cp.avatar_file_id AS caller_avatar,
            tu.username AS callee_username, tp.display_name AS callee_display_name, tp.avatar_file_id AS callee_avatar
       FROM calls c
       LEFT JOIN users cu ON cu.id=c.caller_id
       LEFT JOIN user_profiles cp ON cp.user_id=c.caller_id
       LEFT JOIN users tu ON tu.id=c.callee_id
       LEFT JOIN user_profiles tp ON tp.user_id=c.callee_id
      WHERE c.id=$1`,
    [callId]
  );
  if (!row) return null;
  return {
    id: row.id,
    conversationId: row.conversation_id,
    type: row.type,
    status: row.status,
    startedAt: row.started_at,
    answeredAt: row.answered_at,
    endedAt: row.ended_at,
    endReason: row.end_reason,
    durationSeconds: row.duration_seconds,
    caller: {
      id: row.caller_id,
      username: row.caller_username,
      displayName: row.caller_display_name,
      avatarUrl: fileUrl(row.caller_avatar)
    },
    callee: {
      id: row.callee_id,
      username: row.callee_username,
      displayName: row.callee_display_name,
      avatarUrl: fileUrl(row.callee_avatar)
    }
  };
}

async function logEvent(callId, actorId, event, detail = null) {
  await query(
    'INSERT INTO call_events (call_id, actor_id, event, detail) VALUES ($1,$2,$3,$4)',
    [callId, actorId, event, detail]
  ).catch(() => {});
}

async function notifyMissed(io, call, actorId) {
  const calleeId = call.callee_id;
  if (!calleeId) return;
  const profile = await one(
    `SELECT u.username, p.display_name, p.push_enabled, p.notify_calls
       FROM users u JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1`,
    [calleeId]
  );
  if (!profile) return;
  const caller = await one('SELECT display_name FROM user_profiles WHERE user_id=$1', [actorId]);
  await createNotification({
    userId: calleeId,
    type: 'missed_call',
    actorId,
    callId: call.id,
    conversationId: call.conversation_id,
    payload: { callType: call.type }
  }).catch(() => {});
  await maybePush(
    { id: calleeId, push_enabled: profile.push_enabled, notify_calls: profile.notify_calls },
    {
      type: 'missed_call',
      title: `Missed ${call.type} call`,
      body: `${caller?.display_name ?? 'Someone'} tried to call you.`,
      url: '/calls',
      tag: `call-${call.id}`
    }
  ).catch(() => {});
}

function scheduleRingTimeout(io, callId) {
  clearRingTimer(callId);
  const timer = setTimeout(async () => {
    ringTimers.delete(callId);
    try {
      const call = await one(
        `UPDATE calls SET status='missed', ended_at=now(), end_reason='timeout'
          WHERE id=$1 AND status='ringing' RETURNING *`,
        [callId]
      );
      if (!call) return;
      await logEvent(call.id, null, 'timeout');
      const dto = await callDto(call.id);
      emitToUser(call.caller_id, 'call:ended', { call: dto });
      emitToUser(call.callee_id, 'call:ended', { call: dto });
      await notifyMissed(io, call, call.caller_id);
    } catch (err) {
      logger.warn({ err, callId }, 'call timeout handling failed');
    }
  }, config.callRingTimeoutMs);
  timer.unref?.();
  ringTimers.set(callId, timer);
}

async function getActiveCallForUser(userId) {
  return one(
    `SELECT * FROM calls WHERE (caller_id=$1 OR callee_id=$1) AND status IN ('ringing','accepted')
      ORDER BY started_at DESC LIMIT 1`,
    [userId]
  );
}

function validateSdp(sdp) {
  if (!sdp || typeof sdp !== 'object') return false;
  try {
    return JSON.stringify(sdp).length <= 120_000;
  } catch {
    return false;
  }
}

function validateCandidate(candidate) {
  if (candidate === null) return true;
  if (!candidate || typeof candidate !== 'object') return false;
  try {
    return JSON.stringify(candidate).length <= 8_000;
  } catch {
    return false;
  }
}

export function registerCallHandlers(io, socket) {
  const userId = socket.data.user.id;

  socket.on('call:start', async (payload, ack) => {
    try {
      if (!(await socketRateLimit(userId, 'call-start', 5, 60_000))) {
        return socketReply(ack, callError('RATE_LIMITED', 'Too many call attempts. Wait a moment.'));
      }
      const parsed = z.object({ conversationId: uuid, type: z.enum(['voice', 'video']) }).safeParse(payload);
      if (!parsed.success) return socketReply(ack, callError('VALIDATION_ERROR', 'Invalid call request'));

      const membership = await getMembership(parsed.data.conversationId, userId);
      if (!membership || membership.type !== 'direct') {
        return socketReply(ack, callError('NOT_FOUND', 'Calls are only available in direct conversations'));
      }
      const other = await getOtherMember(parsed.data.conversationId, userId);
      if (!other) return socketReply(ack, callError('UNAVAILABLE', 'This user is unavailable'));

      const allowed = await canDirectMessage(userId, other.id);
      if (!allowed.ok) {
        const code = allowed.reason === 'BLOCKED' ? 'BLOCKED' : allowed.reason === 'NOT_FRIENDS' ? 'NOT_FRIENDS' : 'UNAVAILABLE';
        return socketReply(ack, callError(code, 'You cannot call this user'));
      }

      if (await getActiveCallForUser(userId)) {
        return socketReply(ack, callError('BUSY', 'You are already on a call'));
      }
      if (await getActiveCallForUser(other.id)) {
        return socketReply(ack, callError('BUSY', 'This user is on another call'));
      }

      if (!(await isOnline(other.id))) {
        const missed = await one(
          `INSERT INTO calls (conversation_id, caller_id, callee_id, type, status, ended_at, end_reason)
           VALUES ($1,$2,$3,$4,'missed',now(),'unavailable') RETURNING *`,
          [parsed.data.conversationId, userId, other.id, parsed.data.type]
        );
        await logEvent(missed.id, userId, 'unavailable');
        await notifyMissed(io, missed, userId);
        return socketReply(ack, {
          ...callError('UNAVAILABLE', 'This user is offline. They have been notified of the missed call.'),
          callId: missed.id
        });
      }

      let call;
      try {
        call = await one(
          `INSERT INTO calls (conversation_id, caller_id, callee_id, type)
           VALUES ($1,$2,$3,$4) RETURNING *`,
          [parsed.data.conversationId, userId, other.id, parsed.data.type]
        );
      } catch (err) {
        if (err.code === '23505') return socketReply(ack, callError('BUSY', 'One of you is already on a call'));
        throw err;
      }

      await logEvent(call.id, userId, 'started', { type: call.type });
      scheduleRingTimeout(io, call.id);
      const dto = await callDto(call.id);
      emitToUser(other.id, 'call:incoming', { call: dto });
      emitToUser(userId, 'call:ringing', { call: dto });
      socketReply(ack, { ok: true, call: dto });
    } catch (err) {
      logger.warn({ err }, 'call:start failed');
      socketReply(ack, callError('CALL_FAILED', 'Unable to start the call'));
    }
  });

  socket.on('call:accept', async (payload, ack) => {
    try {
      const parsed = z.object({ callId: uuid }).safeParse(payload);
      if (!parsed.success) return socketReply(ack, callError('VALIDATION_ERROR', 'Invalid call'));
      const call = await one(
        `UPDATE calls SET status='accepted', answered_at=now()
          WHERE id=$1 AND callee_id=$2 AND status='ringing' RETURNING *`,
        [parsed.data.callId, userId]
      );
      if (!call) {
        const existing = await one('SELECT * FROM calls WHERE id=$1 AND callee_id=$2 AND status=$3', [
          parsed.data.callId,
          userId,
          'accepted'
        ]);
        if (existing) return socketReply(ack, { ok: true, call: await callDto(existing.id) });
        return socketReply(ack, callError('CALL_NOT_RINGING', 'This call is no longer available'));
      }
      clearRingTimer(call.id);
      await logEvent(call.id, userId, 'accepted');
      const dto = await callDto(call.id);
      emitToUser(call.caller_id, 'call:accepted', { call: dto });
      emitToUser(call.callee_id, 'call:accepted', { call: dto });
      socketReply(ack, { ok: true, call: dto });
    } catch (err) {
      logger.warn({ err }, 'call:accept failed');
      socketReply(ack, callError('CALL_FAILED', 'Unable to accept the call'));
    }
  });

  socket.on('call:reject', async (payload, ack) => {
    try {
      const parsed = z.object({ callId: uuid }).safeParse(payload);
      if (!parsed.success) return socketReply(ack, callError('VALIDATION_ERROR', 'Invalid call'));
      const call = await one(
        `UPDATE calls SET status='rejected', ended_at=now(), end_reason='rejected'
          WHERE id=$1 AND callee_id=$2 AND status='ringing' RETURNING *`,
        [parsed.data.callId, userId]
      );
      if (!call) return socketReply(ack, callError('CALL_NOT_RINGING', 'This call is no longer ringing'));
      clearRingTimer(call.id);
      await logEvent(call.id, userId, 'rejected');
      const dto = await callDto(call.id);
      emitToUser(call.caller_id, 'call:rejected', { call: dto });
      emitToUser(call.callee_id, 'call:rejected', { call: dto });
      socketReply(ack, { ok: true, call: dto });
    } catch (err) {
      logger.warn({ err }, 'call:reject failed');
      socketReply(ack, callError('CALL_FAILED', 'Unable to reject the call'));
    }
  });

  socket.on('call:cancel', async (payload, ack) => {
    try {
      const parsed = z.object({ callId: uuid }).safeParse(payload);
      if (!parsed.success) return socketReply(ack, callError('VALIDATION_ERROR', 'Invalid call'));
      const call = await one(
        `UPDATE calls SET status='cancelled', ended_at=now(), end_reason='cancelled'
          WHERE id=$1 AND caller_id=$2 AND status='ringing' RETURNING *`,
        [parsed.data.callId, userId]
      );
      if (!call) return socketReply(ack, callError('CALL_NOT_RINGING', 'This call is no longer ringing'));
      clearRingTimer(call.id);
      await logEvent(call.id, userId, 'cancelled');
      const dto = await callDto(call.id);
      emitToUser(call.callee_id, 'call:cancelled', { call: dto });
      emitToUser(call.caller_id, 'call:cancelled', { call: dto });
      socketReply(ack, { ok: true, call: dto });
    } catch (err) {
      logger.warn({ err }, 'call:cancel failed');
      socketReply(ack, callError('CALL_FAILED', 'Unable to cancel the call'));
    }
  });

  socket.on('call:end', async (payload, ack) => {
    try {
      const parsed = z.object({ callId: uuid }).safeParse(payload);
      if (!parsed.success) return socketReply(ack, callError('VALIDATION_ERROR', 'Invalid call'));
      const call = await one(
        `SELECT * FROM calls WHERE id=$1 AND (caller_id=$2 OR callee_id=$2) AND status IN ('ringing','accepted')`,
        [parsed.data.callId, userId]
      );
      if (!call) {
        return socketReply(ack, { ok: true, alreadyEnded: true });
      }
      const status = call.status === 'accepted' ? 'ended' : 'cancelled';
      const duration = call.status === 'accepted' && call.answered_at
        ? Math.max(1, Math.round((Date.now() - new Date(call.answered_at).getTime()) / 1000))
        : null;
      const updated = await one(
        `UPDATE calls SET status=$2, ended_at=now(), end_reason='hangup', duration_seconds=$3
          WHERE id=$1 AND status IN ('ringing','accepted') RETURNING *`,
        [call.id, status, duration]
      );
      if (!updated) return socketReply(ack, { ok: true, alreadyEnded: true });
      clearRingTimer(call.id);
      await logEvent(call.id, userId, 'ended', { duration });
      const dto = await callDto(call.id);
      const other = call.caller_id === userId ? call.callee_id : call.caller_id;
      emitToUser(other, 'call:ended', { call: dto });
      emitToUser(userId, 'call:ended', { call: dto });
      socketReply(ack, { ok: true, call: dto });
    } catch (err) {
      logger.warn({ err }, 'call:end failed');
      socketReply(ack, callError('CALL_FAILED', 'Unable to end the call'));
    }
  });

  for (const event of ['webrtc:offer', 'webrtc:answer']) {
    socket.on(event, async (payload, ack) => {
      try {
        if (!(await socketRateLimit(userId, 'webrtc', 120, 10_000))) {
          return socketReply(ack, callError('RATE_LIMITED', 'Too many signaling messages'));
        }
        const parsed = z.object({ callId: uuid, sdp: z.any() }).safeParse(payload);
        if (!parsed.success || !validateSdp(parsed.data.sdp)) {
          return socketReply(ack, callError('VALIDATION_ERROR', 'Invalid session description'));
        }
        const call = await one(
          `SELECT * FROM calls WHERE id=$1 AND (caller_id=$2 OR callee_id=$2) AND status='accepted'`,
          [parsed.data.callId, userId]
        );
        if (!call) return socketReply(ack, callError('CALL_NOT_ACTIVE', 'This call is not active'));
        const other = call.caller_id === userId ? call.callee_id : call.caller_id;
        emitToUser(other, event, { callId: call.id, from: userId, sdp: parsed.data.sdp });
        socketReply(ack, { ok: true });
      } catch (err) {
        logger.warn({ err }, `${event} failed`);
        socketReply(ack, callError('SIGNAL_FAILED', 'Unable to relay signaling data'));
      }
    });
  }

  socket.on('webrtc:ice', async (payload, ack) => {
    try {
      if (!(await socketRateLimit(userId, 'webrtc-ice', 200, 10_000))) {
        return socketReply(ack, callError('RATE_LIMITED', 'Too many signaling messages'));
      }
      const parsed = z.object({ callId: uuid, candidate: z.any() }).safeParse(payload);
      if (!parsed.success || !validateCandidate(parsed.data.candidate)) {
        return socketReply(ack, callError('VALIDATION_ERROR', 'Invalid ICE candidate'));
      }
      const call = await one(
        `SELECT * FROM calls WHERE id=$1 AND (caller_id=$2 OR callee_id=$2) AND status='accepted'`,
        [parsed.data.callId, userId]
      );
      if (!call) return socketReply(ack, callError('CALL_NOT_ACTIVE', 'This call is not active'));
      const other = call.caller_id === userId ? call.callee_id : call.caller_id;
      emitToUser(other, 'webrtc:ice', {
        callId: call.id,
        from: userId,
        candidate: parsed.data.candidate
      });
      socketReply(ack, { ok: true });
    } catch {
      socketReply(ack, callError('SIGNAL_FAILED', 'Unable to relay ICE candidate'));
    }
  });
}

export async function handleCallDisconnect(io, userId) {
  const calls = await query(
    `SELECT * FROM calls WHERE (caller_id=$1 OR callee_id=$1) AND status IN ('ringing','accepted')`,
    [userId]
  );
  for (const call of calls.rows) {
    const isCaller = call.caller_id === userId;
    const status = call.status === 'accepted' ? 'ended' : isCaller ? 'cancelled' : 'missed';
    const reason = 'disconnected';
    const duration = call.status === 'accepted' && call.answered_at
      ? Math.max(1, Math.round((Date.now() - new Date(call.answered_at).getTime()) / 1000))
      : null;
    const updated = await one(
      `UPDATE calls SET status=$2, ended_at=now(), end_reason=$3, duration_seconds=$4
        WHERE id=$1 AND status IN ('ringing','accepted') RETURNING *`,
      [call.id, status, reason, duration]
    );
    if (!updated) continue;
    clearRingTimer(call.id);
    await logEvent(call.id, userId, 'disconnected', { status });
    const other = isCaller ? call.callee_id : call.caller_id;
    const dto = await callDto(call.id);
    emitToUser(other, 'call:ended', { call: dto });
    if (status === 'missed') await notifyMissed(io, call, call.caller_id);
  }
}

export async function recoverStaleCalls() {
  const res = await query(
    `UPDATE calls
        SET status = CASE WHEN status='ringing' THEN 'missed' ELSE 'ended' END,
            ended_at = now(),
            end_reason = 'server_restart'
      WHERE status IN ('ringing','accepted')`
  );
  for (const callId of ringTimers.keys()) clearRingTimer(callId);
  if (res.rowCount) logger.warn({ count: res.rowCount }, 'closed calls left active by a previous process');
}
