import { one, query } from '../db.js';
import { notFound } from './errors.js';
import { emitToAll } from '../realtime.js';
import { logger } from '../logger.js';

const AUDIENCE_FOR_ROLE = (role) => {
  if (role === 'admin') return ['everyone', 'staff', 'admins'];
  if (role === 'manager' || role === 'staff') return ['everyone', 'staff'];
  return ['everyone'];
};

const noticeDto = (row) => ({
  id: row.id,
  title: row.title,
  body: row.body,
  level: row.level,
  audience: row.audience,
  status: row.status,
  pinned: row.pinned,
  dismissible: row.dismissible,
  startsAt: row.starts_at,
  endsAt: row.ends_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  dismissed: Boolean(row.dismissed),
  author: row.created_by_username
    ? { username: row.created_by_username, displayName: row.created_by_display_name }
    : null
});

export async function activeNotices(userId, role, { limit = 4 } = {}) {
  const rows = await query(
    `SELECT n.*, d.notice_id IS NOT NULL AS dismissed,
            cu.username AS created_by_username, cp.display_name AS created_by_display_name
       FROM notices n
       LEFT JOIN notice_dismissals d ON d.notice_id = n.id AND d.user_id = $1::uuid
       LEFT JOIN users cu ON cu.id = n.created_by
       LEFT JOIN user_profiles cp ON cp.user_id = n.created_by
      WHERE n.status='published'
        AND n.audience = ANY($2::text[])
        AND (n.starts_at IS NULL OR n.starts_at <= now())
        AND (n.ends_at IS NULL OR n.ends_at > now())
        AND (d.notice_id IS NULL OR n.dismissible = false)
      ORDER BY n.pinned DESC, n.created_at DESC
      LIMIT $3`,
    [userId, AUDIENCE_FOR_ROLE(role), limit]
  );
  return rows.rows.map(noticeDto);
}

export async function noticeUnreadCount(userId, role) {
  const rows = await activeNotices(userId, role, { limit: 50 });
  return rows.filter((n) => !n.dismissed).length;
}

export async function dismissNotice(userId, noticeId) {
  const notice = await one('SELECT id, dismissible FROM notices WHERE id=$1', [noticeId]);
  if (!notice) throw notFound('Notice not found', 'NOTICE_NOT_FOUND');
  if (!notice.dismissible) return { dismissed: false, permanent: true };
  await query(
    `INSERT INTO notice_dismissals (notice_id, user_id) VALUES ($1,$2)
     ON CONFLICT DO NOTHING`,
    [noticeId, userId]
  );
  return { dismissed: true };
}

export async function adminListNotices({ status = null, page = 1, limit = 25 }) {
  const params = [];
  let where = '';
  if (status && status !== 'all') {
    params.push(status);
    where = `WHERE n.status = $1`;
  }
  params.push(limit, (page - 1) * limit);
  const rows = await query(
    `SELECT n.*, cu.username AS created_by_username, cp.display_name AS created_by_display_name,
            (SELECT count(*)::int FROM notice_dismissals d WHERE d.notice_id=n.id) AS dismissals,
            count(*) OVER() AS total
       FROM notices n
       LEFT JOIN users cu ON cu.id = n.created_by
       LEFT JOIN user_profiles cp ON cp.user_id = n.created_by
      ${where}
      ORDER BY n.pinned DESC, n.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return {
    notices: rows.rows.map((row) => ({ ...noticeDto(row), dismissals: row.dismissals })),
    total: rows.rows[0]?.total ?? 0
  };
}

export async function publishNotice(id, actorId, { sendEmail = false, recipients = null } = {}) {
  const row = await one(
    `UPDATE notices
        SET status='published', starts_at=COALESCE(starts_at, now()), updated_by=$2
      WHERE id=$1 AND status <> 'archived'
      RETURNING *`,
    [id, actorId]
  );
  if (!row) throw notFound('Notice not found or archived', 'NOTICE_NOT_FOUND');
  emitToAll('notice:new', noticeDto(row));
  logger.info({ noticeId: id, actorId }, 'notice published');

  if (sendEmail) {
    const { enqueueMail } = await import('./mail.js');
    const roles =
      row.audience === 'admins'
        ? ['admin']
        : row.audience === 'staff'
          ? ['staff', 'manager', 'admin']
          : ['user', 'staff', 'manager', 'admin'];
    const users = await query(
      `SELECT u.id, u.email, u.username, p.display_name
         FROM users u JOIN user_profiles p ON p.user_id=u.id
        WHERE u.status='active' AND u.role = ANY($1::text[])
        LIMIT $2`,
      [roles, recipients && Number.isFinite(recipients) ? recipients : 500]
    );
    for (const user of users.rows) {
      await enqueueMail({
        to: user.email,
        userId: user.id,
        template: 'notice',
        data: {
          username: user.display_name || user.username,
          title: row.title,
          body: row.body,
          level: row.level,
          url: null
        },
        meta: { noticeId: row.id, kind: 'announcement' }
      }).catch((err) => logger.warn({ err, userId: user.id }, 'notice email could not be queued'));
    }
  }

  return noticeDto(row);
}

export async function notifyNoticeUpdate(id) {
  const row = await one('SELECT * FROM notices WHERE id=$1', [id]);
  if (row?.status === 'published') emitToAll('notice:update', noticeDto(row));
}

export async function notifyNoticeRemoval(id) {
  emitToAll('notice:removed', { id });
}

export async function noticesForAdminCounts() {
  const row = await one(
    `SELECT count(*) FILTER (WHERE status='published')::int AS published,
            count(*) FILTER (WHERE status='draft')::int AS draft
       FROM notices`
  );
  return row;
}
