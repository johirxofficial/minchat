import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(here, '../..');

dotenv.config({ path: process.env.ENV_FILE || path.join(projectRoot, '.env') });

const bool = (def) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const csv = (def = '') =>
  z
    .string()
    .optional()
    .transform((v) => (v ?? def).split(',').map((s) => s.trim()).filter(Boolean));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(5050),
  HOST: z.string().default('127.0.0.1'),
  APP_ORIGIN: z.string().url().default('http://localhost:5050'),
  PUBLIC_URL: z.string().url().optional(),
  CORS_ORIGINS: csv(),
  TRUST_PROXY: z.string().default('1'),
  COOKIE_SECURE: bool(false),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),

  DATABASE_URL: z.string().min(1),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(20),
  REDIS_URL: z.string().min(1),

  STORAGE_DIR: z.string().default(path.join(projectRoot, 'storage')),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(200).default(25),
  USER_STORAGE_QUOTA_MB: z.coerce.number().int().min(1).default(500),
  SERVE_STATIC: bool(false),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  STUN_URLS: csv('stun:stun.l.google.com:19302'),
  TURN_URL: z.string().optional(),
  TURN_URLS: csv(),
  TURN_USERNAME: z.string().optional(),
  TURN_PASSWORD: z.string().optional(),
  CALL_RING_TIMEOUT_MS: z.coerce.number().int().min(5000).max(120000).default(45000),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default('MinChat <no-reply@minchat.local>'),
  ALLOW_DEV_EMAIL: bool(false),

  VAPID_SUBJECT: z.string().default('mailto:admin@minchat.local'),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),

  ADMIN_USERNAME: z.string().default('johirxofficial'),
  ADMIN_EMAIL: z.string().default('admin@minchat.local'),
  ADMIN_PASSWORD: z.string().optional(),

  MAX_GROUP_MEMBERS: z.coerce.number().int().min(2).max(500).default(100),
  REGISTRATION_OPEN: bool(true),
  BCRYPT_ROUNDS: z.coerce.number().int().optional()
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  // Never print values — only the names of invalid/missing keys.
  const keys = Object.keys(parsed.error.flatten().fieldErrors);
  console.error('[minchat] Invalid environment configuration:', keys.join(', '));
  for (const [k, v] of Object.entries(parsed.error.flatten().fieldErrors)) {
    console.error(`  ${k}: ${v.join('; ')}`);
  }
  process.exit(1);
}

const e = parsed.data;
const normaliseOrigin = (o) => o.replace(/\/+$/, '');
const allowedOrigins = [...new Set(
  [e.APP_ORIGIN, e.PUBLIC_URL, ...e.CORS_ORIGINS]
    .filter(Boolean)
    .map(normaliseOrigin)
)];

const stunUrls = e.STUN_URLS.filter(Boolean);
const turnUrls = (e.TURN_URLS.length ? e.TURN_URLS : e.TURN_URL ? [e.TURN_URL] : []).filter(Boolean);
const iceServers = [];
if (stunUrls.length) iceServers.push({ urls: stunUrls });
if (turnUrls.length && e.TURN_USERNAME && e.TURN_PASSWORD) {
  iceServers.push({ urls: turnUrls, username: e.TURN_USERNAME, credential: e.TURN_PASSWORD });
}

export const config = Object.freeze({
  env: e.NODE_ENV,
  isProduction: e.NODE_ENV === 'production',
  isTest: e.NODE_ENV === 'test',
  port: e.PORT,
  host: e.HOST,
  appOrigin: normaliseOrigin(e.APP_ORIGIN),
  publicUrl: normaliseOrigin(e.PUBLIC_URL || e.APP_ORIGIN),
  allowedOrigins,
  trustProxy: /^\d+$/.test(e.TRUST_PROXY) ? Number(e.TRUST_PROXY) : e.TRUST_PROXY,
  cookieSecure: e.COOKIE_SECURE,
  cookieSameSite: e.COOKIE_SAMESITE,
  sessionTtlMs: e.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  sessionSecret: e.SESSION_SECRET,
  databaseUrl: e.DATABASE_URL,
  dbPoolMax: e.DB_POOL_MAX,
  redisUrl: e.REDIS_URL,
  storageDir: path.resolve(e.STORAGE_DIR),
  maxUploadBytes: e.MAX_UPLOAD_MB * 1024 * 1024,
  maxUploadMb: e.MAX_UPLOAD_MB,
  userQuotaBytes: e.USER_STORAGE_QUOTA_MB * 1024 * 1024,
  userQuotaMb: e.USER_STORAGE_QUOTA_MB,
  serveStatic: e.SERVE_STATIC,
  logLevel: e.LOG_LEVEL,
  iceServers,
  turnConfigured: iceServers.some((s) => String(s.urls).startsWith('turn')),
  callRingTimeoutMs: e.CALL_RING_TIMEOUT_MS,
  smtp: {
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure: e.SMTP_SECURE,
    user: e.SMTP_USER,
    password: e.SMTP_PASSWORD,
    from: e.SMTP_FROM,
    configured: Boolean(e.SMTP_HOST)
  },
  allowDevEmail: e.ALLOW_DEV_EMAIL,
  vapid: {
    subject: e.VAPID_SUBJECT,
    publicKey: e.VAPID_PUBLIC_KEY || '',
    privateKey: e.VAPID_PRIVATE_KEY || '',
    configured: Boolean(e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY)
  },
  admin: {
    username: e.ADMIN_USERNAME,
    email: e.ADMIN_EMAIL,
    password: e.ADMIN_PASSWORD
  },
  maxGroupMembers: e.MAX_GROUP_MEMBERS,
  registrationOpen: e.REGISTRATION_OPEN,
  version: '1.0.0'
});
