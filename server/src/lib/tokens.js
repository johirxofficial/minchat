import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify, Algorithm } from '@node-rs/argon2';
import { config } from '../config.js';

const ARGON_OPTIONS = {
  memoryCost: 19456, // 19 MiB, OWASP Argon2id recommendation
  timeCost: 2,
  outputLen: 32,
  parallelism: 1,
  algorithm: Algorithm.Argon2id
};

// Verified against this dummy hash when the account does not exist, so the
// response time does not reveal whether a username is registered.
const DUMMY_HASH = await argonHash('minchat-dummy-password-not-used', ARGON_OPTIONS);

export async function hashPassword(password) {
  return argonHash(password, ARGON_OPTIONS);
}

export async function verifyPassword(hash, password) {
  try {
    return await argonVerify(hash, password);
  } catch {
    return false;
  }
}

export async function verifyDummyPassword(password) {
  await argonVerify(DUMMY_HASH, password).catch(() => false);
  return false;
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return createHmac('sha256', config.sessionSecret).update(value).digest('hex');
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
