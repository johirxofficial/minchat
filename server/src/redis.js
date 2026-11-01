import Redis from 'ioredis';
import { config } from './config.js';
import { logger } from './logger.js';

function createClient(name) {
  const client = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
    connectionName: `minchat:${name}`,
    retryStrategy: (times) => Math.min(times * 200, 3000)
  });
  client.on('error', (err) => logger.error({ err, name }, 'Redis error'));
  client.on('reconnecting', () => logger.warn({ name }, 'Redis reconnecting'));
  client.on('ready', () => logger.info({ name }, 'Redis ready'));
  return client;
}

export const redis = createClient('main');

export function duplicateRedis() {
  return createClient('duplicate');
}

export async function checkRedis() {
  const start = Date.now();
  const pong = await redis.ping();
  return { ok: pong === 'PONG', latencyMs: Date.now() - start };
}

export async function closeRedis() {
  await redis.quit().catch(() => {});
}
