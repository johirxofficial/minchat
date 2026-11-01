import webpush from 'web-push';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { query } from '../db.js';

if (config.vapid.configured) {
  webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
}

export function pushConfigured() {
  return config.vapid.configured;
}

export function publicVapidKey() {
  return config.vapid.configured ? config.vapid.publicKey : null;
}

export async function sendPushToUser(userId, payload) {
  if (!config.vapid.configured) return { sent: 0, skipped: true };
  const subs = await query(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
    [userId]
  );
  let sent = 0;
  await Promise.all(
    subs.rows.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          { TTL: 600, urgency: payload.type === 'call' ? 'high' : 'normal' }
        );
        sent += 1;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await query('DELETE FROM push_subscriptions WHERE id = $1', [sub.id]).catch(() => {});
        } else {
          logger.warn({ status: err.statusCode }, 'push delivery failed');
        }
      }
    })
  );
  return { sent };
}
