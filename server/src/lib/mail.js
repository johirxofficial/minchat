import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { one, query, withTransaction } from '../db.js';
import { renderTemplate } from './mailTemplates.js';

/**
 * Transactional mail is written to `mail_outbox` first and delivered by a
 * background worker with bounded retries. Nothing in a request path waits for
 * SMTP, and administrators can inspect, retry or cancel every message.
 */

let transporter = null;
let workerTimer = null;
let processing = false;

const MAX_ATTEMPTS = 5;

if (config.smtp.configured) {
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    pool: true,
    maxConnections: 3
  });
}

export function mailConfigured() {
  return Boolean(transporter);
}

export function mailMode() {
  if (transporter) return 'smtp';
  if (config.allowDevEmail) return 'development';
  return 'disabled';
}

export const mailStatus = () => ({
  configured: Boolean(transporter),
  mode: mailMode(),
  host: config.smtp.host ? config.smtp.host.replace(/.(?=.{3})/g, '*') : null,
  from: config.smtp.from,
  workerRunning: Boolean(workerTimer)
});

export async function enqueueMail({
  to,
  userId = null,
  template,
  data = {},
  meta = {},
  scheduledAt = null,
  subject = null
}) {
  if (!to) throw new Error('enqueueMail requires a recipient');
  const rendered = renderTemplate(template, data);
  const row = await one(
    `INSERT INTO mail_outbox (user_id, to_email, template, subject, text_body, html_body, meta, scheduled_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb, COALESCE($8, now()))
     RETURNING id, to_email, template, subject, status, created_at`,
    [
      userId,
      String(to).toLowerCase(),
      template,
      subject || rendered.subject,
      rendered.text,
      rendered.html,
      JSON.stringify(meta),
      scheduledAt
    ]
  );
  setImmediate(() => {
    processMailQueue(5).catch((err) => logger.error({ err }, 'mail queue processing failed'));
  });
  return row;
}

/** Convenience wrapper retained for callers that only need a reset link. */
export function sendPasswordResetEmail({ to, username, token }) {
  return enqueueMail({
    to,
    template: 'passwordReset',
    data: { username, resetUrl: `${config.publicUrl}/reset-password?token=${encodeURIComponent(token)}` },
    meta: { kind: 'security' }
  });
}

async function deliver(job) {
  if (!transporter) {
    if (config.allowDevEmail) {
      logger.warn(
        { to: job.to_email, subject: job.subject, template: job.template },
        'SMTP not configured; email recorded in the outbox (development mode)'
      );
      return { development: true };
    }
    const err = new Error('SMTP is not configured on this deployment');
    err.permanent = true;
    throw err;
  }
  const info = await transporter.sendMail({
    from: config.smtp.from,
    to: job.to_email,
    subject: job.subject,
    text: job.text_body || undefined,
    html: job.html_body || undefined,
    headers: { 'X-MinChat-Template': job.template }
  });
  return info;
}

export async function processMailQueue(limit = 20) {
  if (processing) return { skipped: true };
  processing = true;
  try {
    const jobs = await withTransaction(async (client) => {
      const res = await client.query(
        `SELECT id, to_email, template, subject, text_body, html_body, attempts, meta
           FROM mail_outbox
          WHERE status='queued' AND scheduled_at <= now()
          ORDER BY created_at ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [limit]
      );
      return res.rows;
    });

    const results = [];
    for (const job of jobs) {
      try {
        const info = await deliver(job);
        await query(
          `UPDATE mail_outbox
              SET status='sent', attempts=attempts+1, sent_at=now(), last_error=NULL,
                  meta = meta || $2::jsonb
            WHERE id=$1`,
          [job.id, JSON.stringify(info?.development ? { development: true } : {})]
        );
        results.push({ id: job.id, status: 'sent' });
      } catch (err) {
        const attempts = job.attempts + 1;
        const permanent = Boolean(err.permanent) || attempts >= MAX_ATTEMPTS;
        const retryDelayMinutes = Math.min(60, 2 ** attempts);
        await query(
          `UPDATE mail_outbox
              SET status=$2::text,
                  attempts=$3,
                  last_error=$4,
                  scheduled_at = CASE WHEN $2::text='queued' THEN now() + ($5 || ' minutes')::interval ELSE scheduled_at END
            WHERE id=$1`,
          [job.id, permanent ? 'failed' : 'queued', attempts, String(err.message || err).slice(0, 500), String(retryDelayMinutes)]
        );
        logger.warn(
          { err, mailId: job.id, template: job.template, attempts, permanent },
          'email delivery failed'
        );
        results.push({ id: job.id, status: permanent ? 'failed' : 'queued', error: err.message });
      }
    }
    return { processed: results.length, results };
  } finally {
    processing = false;
  }
}

export function startMailWorker(intervalMs = 20_000) {
  if (workerTimer) return;
  if (!transporter && !config.allowDevEmail) {
    logger.warn('mail worker not started: SMTP is not configured (set ALLOW_DEV_EMAIL=true for development)');
    return;
  }
  workerTimer = setInterval(() => {
    processMailQueue(10).catch((err) => logger.error({ err }, 'mail worker tick failed'));
  }, intervalMs);
  workerTimer.unref?.();
  processMailQueue(10).catch(() => {});
  logger.info({ intervalMs }, 'mail worker started');
}

export function stopMailWorker() {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = null;
}

export async function listMail({ status = null, page = 1, limit = 25, q = null }) {
  const params = [];
  const where = [];
  if (status && status !== 'all') {
    params.push(status);
    where.push(`m.status = $${params.length}`);
  }
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, '\\$&')}%`);
    where.push(`(m.to_email::text ILIKE $${params.length} OR m.subject ILIKE $${params.length})`);
  }
  params.push(limit, (page - 1) * limit);
  const rows = await query(
    `SELECT m.id, m.to_email, m.template, m.subject, m.status, m.attempts, m.last_error,
            m.meta, m.scheduled_at, m.sent_at, m.created_at,
            u.username, p.display_name,
            count(*) OVER() AS total
       FROM mail_outbox m
       LEFT JOIN users u ON u.id = m.user_id
       LEFT JOIN user_profiles p ON p.user_id = m.user_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY m.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return {
    mail: rows.rows.map((r) => ({
      id: r.id,
      to: r.to_email,
      template: r.template,
      subject: r.subject,
      status: r.status,
      attempts: r.attempts,
      lastError: r.last_error,
      meta: r.meta,
      scheduledAt: r.scheduled_at,
      sentAt: r.sent_at,
      createdAt: r.created_at,
      recipient: r.username ? { username: r.username, displayName: r.display_name } : null
    })),
    total: rows.rows[0]?.total ?? 0
  };
}

export async function mailStats() {
  const rows = await query(
    `SELECT status, count(*)::int AS n FROM mail_outbox GROUP BY status`
  );
  const counts = { queued: 0, sent: 0, failed: 0, cancelled: 0 };
  for (const row of rows.rows) counts[row.status] = row.n;
  const last24 = await one(
    `SELECT
       count(*) FILTER (WHERE status='sent' AND sent_at > now() - interval '24 hours')::int AS sent_24h,
       count(*) FILTER (WHERE status='failed' AND created_at > now() - interval '24 hours')::int AS failed_24h
     FROM mail_outbox`
  );
  return { counts, ...last24 };
}

export async function retryMail(id) {
  const res = await query(
    `UPDATE mail_outbox
        SET status='queued', attempts=0, last_error=NULL, scheduled_at=now()
      WHERE id=$1 AND status IN ('failed','cancelled')
      RETURNING id`,
    [id]
  );
  if (!res.rowCount) return false;
  setImmediate(() => processMailQueue(5).catch(() => {}));
  return true;
}

export async function cancelMail(id) {
  const res = await query(
    `UPDATE mail_outbox SET status='cancelled'
      WHERE id=$1 AND status IN ('queued','failed') RETURNING id`,
    [id]
  );
  return res.rowCount > 0;
}

export async function sendTestMail({ to, username = null }) {
  return enqueueMail({
    to,
    template: 'test',
    data: { username, supportEmail: config.smtp.from },
    meta: { kind: 'test' }
  });
}
