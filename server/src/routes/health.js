import { Router } from 'express';
import { checkDatabase } from '../db.js';
import { checkRedis } from '../redis.js';
import { config } from '../config.js';
import { getSettings } from '../lib/settings.js';

export const healthRouter = Router();

healthRouter.get(
  '/',
  async (_req, res) => {
    let db = false;
    let redis = false;
    try {
      await checkDatabase();
      db = true;
    } catch {
      db = false;
    }
    try {
      redis = (await checkRedis()).ok;
    } catch {
      redis = false;
    }
    const ok = db && redis;
    const settings = await getSettings().catch(() => null);
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      service: 'minchat',
      version: config.version,
      checks: { database: db ? 'ok' : 'down', redis: redis ? 'ok' : 'down' },
      maintenance: settings
        ? { active: settings.maintenance_mode, message: settings.maintenance_message }
        : { active: false, message: null },
      registrationOpen: settings ? settings.registration_open : config.registrationOpen,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString()
    });
  }
);
