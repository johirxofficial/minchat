import { z } from 'zod';
import { query } from '../db.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Runtime settings. Values live in PostgreSQL so staff can change behaviour
 * without a redeploy; environment variables provide the initial defaults.
 */
const SETTING_SCHEMA = {
  registration_open: z.boolean(),
  maintenance_mode: z.boolean(),
  maintenance_message: z.string().trim().min(3).max(300),
  require_email_verification: z.boolean(),
  public_directory: z.boolean(),
  max_upload_mb: z.coerce.number().int().min(1).max(100),
  support_email: z.string().trim().email().max(254)
};

export const SETTING_KEYS = Object.keys(SETTING_SCHEMA);

function defaults() {
  return {
    registration_open: config.registrationOpen,
    maintenance_mode: false,
    maintenance_message: 'MinChat is getting a quick tune-up. Please check back shortly.',
    require_email_verification: false,
    public_directory: true,
    max_upload_mb: config.maxUploadMb,
    support_email: 'support@minchat.local'
  };
}

let cache = { value: null, at: 0 };
const TTL_MS = 10_000;

export function invalidateSettings() {
  cache = { value: null, at: 0 };
}

export async function getSettings({ fresh = false } = {}) {
  if (!fresh && cache.value && Date.now() - cache.at < TTL_MS) return cache.value;
  const value = defaults();
  try {
    const rows = await query('SELECT key, value FROM app_settings');
    for (const row of rows.rows) {
      if (!(row.key in SETTING_SCHEMA)) continue;
      const parsed = SETTING_SCHEMA[row.key].safeParse(row.value);
      if (parsed.success) value[row.key] = parsed.data;
      else logger.warn({ key: row.key }, 'ignoring invalid stored setting');
    }
  } catch (err) {
    logger.error({ err }, 'could not load runtime settings; using defaults');
  }
  cache = { value, at: Date.now() };
  return value;
}

export async function setSetting(key, value, updatedBy = null) {
  if (!(key in SETTING_SCHEMA)) {
    throw Object.assign(new Error(`Unknown setting: ${key}`), { status: 400, code: 'UNKNOWN_SETTING' });
  }
  const parsed = SETTING_SCHEMA[key].safeParse(value);
  if (!parsed.success) {
    throw Object.assign(new Error(parsed.error.issues[0]?.message || 'Invalid value'), {
      status: 400,
      code: 'INVALID_SETTING'
    });
  }
  const res = await query(
    `INSERT INTO app_settings (key, value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, now())
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING key, value, updated_at`,
    [key, JSON.stringify(parsed.data), updatedBy]
  );
  invalidateSettings();
  return res.rows[0];
}

export async function settingRows() {
  const rows = await query(
    `SELECT s.key, s.value, s.updated_at, u.username AS updated_by_username
       FROM app_settings s
       LEFT JOIN users u ON u.id = s.updated_by
      ORDER BY s.key`
  );
  return rows.rows;
}

export async function validateSettingsPatch(patch) {
  const clean = {};
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (!(key in SETTING_SCHEMA)) continue;
    const parsed = SETTING_SCHEMA[key].safeParse(value);
    if (parsed.success) clean[key] = parsed.data;
  }
  return clean;
}
