import { query } from '../db.js';

export async function audit(adminId, action, { targetType, targetId, metadata = {}, ip } = {}) {
  await query(
    `INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, metadata, ip)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [adminId, action, targetType ?? null, targetId != null ? String(targetId) : null, metadata, ip ?? null]
  );
}
