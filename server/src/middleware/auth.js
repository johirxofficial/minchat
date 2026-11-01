import { randomToken, sha256, safeEqual } from '../lib/tokens.js';
import { config } from '../config.js';
import { one, query } from '../db.js';
import { unauthorized, forbidden } from '../lib/errors.js';
import { redis } from '../redis.js';
import { hasCapability, isStaff } from '../lib/permissions.js';

export const SESSION_COOKIE = 'minchat_session';
export const CSRF_COOKIE = 'minchat_csrf';
const TOUCH_KEY = (id) => `minchat:session:touch:${id}`;

function baseCookie() {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    path: '/',
    maxAge: config.sessionTtlMs
  };
}

export function setSessionCookies(res, token, csrfToken) {
  res.cookie(SESSION_COOKIE, token, baseCookie());
  res.cookie(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure: config.cookieSecure,
    sameSite: config.cookieSameSite,
    path: '/',
    maxAge: config.sessionTtlMs
  });
}

export function clearSessionCookies(res) {
  const opts = { path: '/', httpOnly: true, secure: config.cookieSecure, sameSite: config.cookieSameSite };
  res.clearCookie(SESSION_COOKIE, opts);
  res.clearCookie(CSRF_COOKIE, { ...opts, httpOnly: false });
}

export async function createSession(userId, req, res) {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const expiresAt = new Date(Date.now() + config.sessionTtlMs);
  const agent = String(req.headers['user-agent'] || '').slice(0, 300);
  const session = await one(
    `INSERT INTO sessions (user_id, token_hash, csrf_token, ip, user_agent, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at, expires_at`,
    [userId, sha256(token), csrfToken, req.ip ?? null, agent, expiresAt]
  );
  setSessionCookies(res, token, csrfToken);
  return { session, token, csrfToken };
}

export async function sessionFromToken(token) {
  if (!token || typeof token !== 'string' || token.length < 20) return null;
  const row = await one(
    `SELECT s.id AS session_id, s.user_id, s.csrf_token, s.expires_at, s.revoked_at,
            u.username, u.role, u.status, p.display_name, p.avatar_file_id
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN user_profiles p ON p.user_id = u.id
      WHERE s.token_hash = $1`,
    [sha256(token)]
  );
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  if (row.status !== 'active') return null;
  return row;
}

export async function loadAuth(req, res, next) {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return next();
    const row = await sessionFromToken(token);
    if (!row) {
      clearSessionCookies(res);
      return next();
    }

    req.auth = {
      sessionId: row.session_id,
      csrfToken: row.csrf_token,
      user: {
        id: row.user_id,
        username: row.username,
        role: row.role,
        status: row.status,
        displayName: row.display_name,
        avatarFileId: row.avatar_file_id
      }
    };

    // Throttle last_seen writes and roll sessions that are over halfway expired.
    const fresh = await redis.set(TOUCH_KEY(row.session_id), '1', 'EX', 300, 'NX').catch(() => 'OK');
    if (fresh === 'OK') {
      await query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [row.session_id]);
    }
    const remaining = new Date(row.expires_at).getTime() - Date.now();
    if (remaining < config.sessionTtlMs / 2) {
      const expiresAt = new Date(Date.now() + config.sessionTtlMs);
      await query('UPDATE sessions SET expires_at = $2 WHERE id = $1', [row.session_id, expiresAt]);
      setSessionCookies(res, token, row.csrf_token);
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req, _res, next) {
  if (!req.auth) return next(unauthorized());
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.auth) return next(unauthorized());
  if (req.auth.user.role !== 'admin') return next(forbidden('Administrator access required', 'ADMIN_REQUIRED'));
  next();
}

export function requireStaff(req, _res, next) {
  if (!req.auth) return next(unauthorized());
  if (!isStaff(req.auth.user.role)) {
    return next(forbidden('Console access required', 'STAFF_REQUIRED'));
  }
  next();
}

export function requireCapability(capability) {
  return (req, _res, next) => {
    if (!req.auth) return next(unauthorized());
    if (!hasCapability(req.auth.user.role, capability)) {
      return next(forbidden('Your role cannot perform this action', 'CAPABILITY_REQUIRED'));
    }
    next();
  };
}

export function csrfProtection(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!req.auth) return next();
  const header = req.get('x-csrf-token');
  if (!header || !safeEqual(header, req.auth.csrfToken)) {
    return next(forbidden('Invalid or missing CSRF token', 'CSRF_FAILED'));
  }
  next();
}

export async function revokeSession(sessionId, userId = null) {
  await query(
    `UPDATE sessions SET revoked_at = now()
      WHERE id = $1 ${userId ? 'AND user_id = $2' : ''} AND revoked_at IS NULL`,
    userId ? [sessionId, userId] : [sessionId]
  );
  await redis.del(TOUCH_KEY(sessionId)).catch(() => {});
}

export async function revokeOtherSessions(userId, keepSessionId) {
  const res = await query(
    'UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL RETURNING id',
    [userId, keepSessionId]
  );
  return res.rowCount;
}

export async function revokeAllSessions(userId) {
  const res = await query(
    'UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL RETURNING id',
    [userId]
  );
  return res.rowCount;
}
