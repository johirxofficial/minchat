import http from 'node:http';
import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { initSockets } from './sockets/index.js';
import { closeDatabase, checkDatabase } from './db.js';
import { closeRedis, checkRedis } from './redis.js';
import { ensureStorageDirs } from './lib/storage.js';
import { startMailWorker, stopMailWorker } from './lib/mail.js';

async function main() {
  await ensureStorageDirs();
  await checkDatabase();
  const redis = await checkRedis();
  if (!redis.ok) logger.warn('Redis did not answer PING at startup');

  const app = createApp();
  const server = http.createServer(app);
  const io = initSockets(server);
  startMailWorker();

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.fatal({ port: config.port, host: config.host }, 'Port is already in use');
    } else {
      logger.fatal({ err }, 'HTTP server error');
    }
    process.exit(1);
  });

  server.listen(config.port, config.host, () => {
    logger.info(
      {
        host: config.host,
        port: config.port,
        env: config.env,
        publicUrl: config.publicUrl,
        storage: config.storageDir,
        turn: config.turnConfigured
      },
      `MinChat listening on http://${config.host}:${config.port}`
    );
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    const force = setTimeout(() => process.exit(1), 15_000);
    force.unref();
    io.close();
    await new Promise((resolve) => server.close(resolve));
    stopMailWorker();
    await Promise.allSettled([closeRedis(), closeDatabase()]);
    clearTimeout(force);
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => {
    logger.error({ err }, 'unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    process.exit(1);
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start MinChat');
  process.exit(1);
});
