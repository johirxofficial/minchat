import pg from 'pg';
import { config } from './config.js';
import { logger } from './logger.js';

// Return bigint counts as JS numbers (all counters in this schema are safely small).
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.dbPoolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: 'minchat',
  statement_timeout: 15_000
});

pool.on('error', (err) => logger.error({ err }, 'PostgreSQL pool error'));

export async function query(text, params = []) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const ms = Date.now() - start;
  if (ms > 400) logger.warn({ ms, rows: res.rowCount }, 'slow query');
  return res;
}

export async function one(text, params = []) {
  const res = await query(text, params);
  return res.rows[0] ?? null;
}

export async function many(text, params = []) {
  const res = await query(text, params);
  return res.rows;
}

export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function checkDatabase() {
  const start = Date.now();
  await pool.query('SELECT 1');
  return Date.now() - start;
}

export async function closeDatabase() {
  await pool.end();
}
