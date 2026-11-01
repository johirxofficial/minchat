import { one } from '../db.js';
import { meDto } from './dto.js';
import { unauthorized } from './errors.js';

export async function loadMe(userId, csrfToken = null) {
  const row = await one(
    `SELECT u.id, u.username, u.email, u.phone, u.phone_verified_at, u.email_verified_at,
              u.role, u.status, u.created_at, u.last_active_at, p.*
       FROM users u JOIN user_profiles p ON p.user_id=u.id
      WHERE u.id=$1 AND u.status='active'`,
    [userId]
  );
  if (!row) throw unauthorized('Account is unavailable', 'ACCOUNT_UNAVAILABLE');
  const counts = await one(
    `SELECT
       (SELECT count(*)::int FROM notifications WHERE user_id=$1 AND read_at IS NULL) AS notifications,
       (SELECT count(*)::int FROM messages m
          JOIN conversation_members cm ON cm.conversation_id=m.conversation_id
         WHERE cm.user_id=$1 AND cm.left_at IS NULL AND m.deleted_at IS NULL
           AND m.sender_id<>$1 AND (cm.last_read_at IS NULL OR m.created_at > cm.last_read_at)) AS unread_messages`,
    [userId]
  );
  return meDto(row, { counts, csrfToken });
}
