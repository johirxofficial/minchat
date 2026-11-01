import { pool, closeDatabase } from '../db.js';
import { logger } from '../logger.js';
import { runMigrations } from '../migrate.js';

try {
  const applied = await runMigrations(pool);
  if (applied.length) logger.info({ applied }, 'migrations complete');
  else logger.info('database is up to date');
  process.exitCode = 0;
} catch (err) {
  logger.error({ err }, 'migration run failed');
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
