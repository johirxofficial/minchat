import { config } from '../config.js';
import { one, query, closeDatabase } from '../db.js';
import { hashPassword, verifyPassword } from '../lib/tokens.js';
import { passwordIssues } from '../lib/validate.js';
import { logger } from '../logger.js';

const username = String(config.admin.username || '').trim().toLowerCase();
const email = String(config.admin.email || '').trim().toLowerCase();
const password = config.admin.password;

if (!username || !email || !password) {
  logger.error('ADMIN_USERNAME, ADMIN_EMAIL and ADMIN_PASSWORD must be set to seed an administrator');
  await closeDatabase();
  process.exit(1);
}
if (!/^[a-z0-9_]{3,30}$/.test(username)) {
  logger.error('ADMIN_USERNAME must be 3-30 lowercase letters, numbers or underscores');
  await closeDatabase();
  process.exit(1);
}
const issues = passwordIssues(password, { username, email });
if (issues.length) {
  logger.error({ issue: issues[0] }, 'ADMIN_PASSWORD does not meet the password policy');
  await closeDatabase();
  process.exit(1);
}

try {
  const existing = await one('SELECT * FROM users WHERE username=$1 OR email=$2 LIMIT 1', [username, email]);
  if (existing) {
    const samePassword = await verifyPassword(existing.password_hash, password);
    await query("UPDATE users SET role='admin', status='active' WHERE id=$1", [existing.id]);
    await query("UPDATE user_profiles SET display_name=COALESCE(NULLIF(display_name,''), $2) WHERE user_id=$1", [
      existing.id,
      'Administrator'
    ]);
    logger.info(
      { username: existing.username, passwordUpdated: false, passwordMatchesEnv: samePassword },
      'existing account promoted to administrator (password was not changed by this script)'
    );
  } else {
    const hash = await hashPassword(password);
    const created = await one(
      `INSERT INTO users (username, email, password_hash, role) VALUES ($1,$2,$3,'admin') RETURNING id`,
      [username, email, hash]
    );
    await query(
      `INSERT INTO user_profiles (user_id, display_name, visibility, discoverable)
       VALUES ($1,'Administrator','private',false)`,
      [created.id]
    );
    logger.info({ username, email }, 'administrator account created');
  }
  process.exitCode = 0;
} catch (err) {
  logger.error({ err }, 'administrator seeding failed');
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
