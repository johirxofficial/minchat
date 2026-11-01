import { pool, query, closeDatabase } from '../db.js';
import { removeOrphanFiles, storageUsage } from '../lib/storage.js';
import { logger } from '../logger.js';

try {
  const orphans = await removeOrphanFiles(24);
  const sessions = await query(
    `DELETE FROM sessions WHERE expires_at < now() - interval '7 days' OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '7 days')`
  );
  const resets = await query(
    `DELETE FROM password_reset_tokens WHERE expires_at < now() - interval '7 days' OR used_at < now() - interval '7 days'`
  );
  const notifications = await query(
    `DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < now() - interval '30 days'`
  );
  const staleCalls = await query(
    `UPDATE calls SET status='missed', ended_at=coalesce(ended_at, now()), end_reason=coalesce(end_reason,'stale')
      WHERE status='ringing' AND started_at < now() - interval '10 minutes'`
  );
  const storage = await storageUsage();
  logger.info(
    {
      orphanFiles: orphans,
      sessions: sessions.rowCount,
      resetTokens: resets.rowCount,
      notifications: notifications.rowCount,
      staleCalls: staleCalls.rowCount,
      storageBytes: storage.bytes,
      files: storage.count
    },
    'cleanup complete'
  );
  process.exitCode = 0;
} catch (err) {
  logger.error({ err }, 'cleanup failed');
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
