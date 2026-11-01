import { one, query } from '../db.js';
import { badRequest, conflict } from './errors.js';
import { sha256, safeEqual } from './tokens.js';
import { enqueueMail } from './mail.js';

const PHONE_RE = /^\+[1-9][0-9]{7,14}$/;

export function normalizePhone(input) {
  if (typeof input !== 'string') return null;
  const cleaned = input.replace(/[\s()\-.]/g, '');
  if (!PHONE_RE.test(cleaned)) return null;
  return cleaned;
}

export const PHONE_HINT = 'Use international format, for example +8801712345678';

export async function createPhoneVerification(user, phone, purpose = 'verify') {
  const normalized = normalizePhone(phone);
  if (!normalized) throw badRequest(PHONE_HINT, 'INVALID_PHONE');
  if (!user.email) throw badRequest('Add an email address before linking a phone number', 'EMAIL_REQUIRED');

  const taken = await one(
    'SELECT 1 FROM users WHERE phone=$1 AND id <> $2',
    [normalized, user.id]
  );
  if (taken) throw conflict('That phone number is already linked to another account', 'PHONE_TAKEN');

  const code = String(Math.floor(100000 + Math.random() * 900000));
  await query(
    `UPDATE phone_verifications SET consumed_at=now()
      WHERE user_id=$1 AND consumed_at IS NULL`,
    [user.id]
  );
  await query(
    `INSERT INTO phone_verifications (user_id, phone, code_hash, purpose, expires_at)
     VALUES ($1,$2,$3,$4, now() + interval '10 minutes')`,
    [user.id, normalized, sha256(`phone:${user.id}:${normalized}:${code}`), purpose]
  );

  await enqueueMail({
    to: user.email,
    userId: user.id,
    template: 'phoneCode',
    data: {
      username: user.display_name || user.username,
      phone: normalized,
      code,
      expiresMinutes: 10
    },
    meta: { kind: 'security', phone: normalized }
  });

  return { phone: normalized, expiresInSeconds: 600, delivery: 'email' };
}

export async function verifyPhoneCode(user, code) {
  const normalizedCode = String(code ?? '').trim();
  if (!/^[0-9]{6}$/.test(normalizedCode)) {
    throw badRequest('Enter the 6-digit code from your email', 'INVALID_CODE');
  }
  const row = await one(
    `SELECT * FROM phone_verifications
      WHERE user_id=$1 AND consumed_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1`,
    [user.id]
  );
  if (!row) throw badRequest('That code has expired. Request a new one.', 'CODE_EXPIRED');
  if (row.attempts >= 5) {
    throw badRequest('Too many incorrect attempts. Request a new code.', 'CODE_LOCKED');
  }

  const expected = sha256(`phone:${user.id}:${row.phone}:${normalizedCode}`);
  if (!safeEqual(expected, row.code_hash)) {
    await query('UPDATE phone_verifications SET attempts=attempts+1 WHERE id=$1', [row.id]);
    throw badRequest('That code is not correct', 'INVALID_CODE');
  }

  const taken = await one('SELECT 1 FROM users WHERE phone=$1 AND id <> $2', [row.phone, user.id]);
  if (taken) throw conflict('That phone number is already linked to another account', 'PHONE_TAKEN');

  await query('UPDATE phone_verifications SET consumed_at=now() WHERE id=$1', [row.id]);
  await query(
    'UPDATE users SET phone=$2, phone_verified_at=now() WHERE id=$1',
    [user.id, row.phone]
  );

  await enqueueMail({
    to: user.email,
    userId: user.id,
    template: 'phoneVerified',
    data: { username: user.display_name || user.username, phone: row.phone },
    meta: { kind: 'security' }
  }).catch(() => {});

  return { phone: row.phone, verifiedAt: new Date().toISOString() };
}

export async function removePhone(user, phone) {
  await query('UPDATE users SET phone=NULL, phone_verified_at=NULL WHERE id=$1', [user.id]);
  await enqueueMail({
    to: user.email,
    userId: user.id,
    template: 'phoneRemoved',
    data: { username: user.display_name || user.username, phone },
    meta: { kind: 'security' }
  }).catch(() => {});
}

export function maskPhone(phone) {
  if (!phone) return null;
  return `${phone.slice(0, 3)}•••${phone.slice(-3)}`;
}

export { PHONE_RE };
