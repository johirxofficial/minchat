import { redis } from '../redis.js';

const socketsKey = (userId) => `minchat:presence:sockets:${userId}`;
const ONLINE = 'minchat:presence:online';
const TTL_SECONDS = 300;
const STALE_MS = 90_000;

export async function addPresence(userId, socketId) {
  const key = socketsKey(userId);
  await redis.sadd(key, socketId);
  await redis.expire(key, TTL_SECONDS);
  await redis.zadd(ONLINE, Date.now(), userId);
}

export async function refreshPresence(userId, socketId) {
  const key = socketsKey(userId);
  await redis.expire(key, TTL_SECONDS);
  const isMember = await redis.sismember(key, socketId);
  if (!isMember) await redis.sadd(key, socketId);
  await redis.zadd(ONLINE, Date.now(), userId);
}

export async function removePresence(userId, socketId) {
  const key = socketsKey(userId);
  await redis.srem(key, socketId);
  const remaining = await redis.scard(key);
  if (remaining === 0) {
    await redis.del(key);
    await redis.zrem(ONLINE, userId);
    return true;
  }
  return false;
}

export async function isOnline(userId) {
  const score = await redis.zscore(ONLINE, userId);
  if (!score) return false;
  if (Date.now() - Number(score) > STALE_MS) return false;
  return (await redis.scard(socketsKey(userId))) > 0;
}

/** Batched online check for a set of user ids. */
export async function onlineFlags(userIds) {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (!unique.length) return new Set();
  const pipeline = redis.pipeline();
  for (const id of unique) {
    pipeline.zscore(ONLINE, id);
    pipeline.scard(socketsKey(id));
  }
  const results = await pipeline.exec();
  const online = new Set();
  unique.forEach((id, index) => {
    const score = results[index * 2]?.[1];
    const sockets = results[index * 2 + 1]?.[1];
    if (score && Date.now() - Number(score) <= STALE_MS && Number(sockets) > 0) online.add(id);
  });
  return online;
}

export async function onlineUserIds() {
  await redis.zremrangebyscore(ONLINE, '-inf', Date.now() - STALE_MS);
  return redis.zrange(ONLINE, 0, -1);
}

export async function onlineCount() {
  await redis.zremrangebyscore(ONLINE, '-inf', Date.now() - STALE_MS);
  return redis.zcard(ONLINE);
}

export async function clearPresenceForUser(userId) {
  await redis.del(socketsKey(userId));
  await redis.zrem(ONLINE, userId);
}
