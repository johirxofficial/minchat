/**
 * Create the two demo member accounts used by scripts/verify-backend.mjs.
 *
 *   npm run seed:demo
 *
 * Set DEMO_PASSWORD to override the default. Existing accounts are left alone
 * apart from being reactivated and marked email-verified.
 */
import { one, query, closeDatabase } from '../db.js';
import { hashPassword, verifyPassword } from '../lib/tokens.js';
import { logger } from '../logger.js';

const password = process.env.DEMO_PASSWORD || 'correct horse battery';

const accounts = [
  { username: 'alice', email: 'alice@example.com', displayName: 'Alice A' },
  { username: 'bob', email: 'bob@example.com', displayName: 'Bob B' }
];

try {
  for (const account of accounts) {
    const existing = await one('SELECT * FROM users WHERE username=$1 OR email=$2 LIMIT 1', [
      account.username,
      account.email
    ]);

    if (existing) {
      const matches = await verifyPassword(existing.password_hash, password);
      await query(
        "UPDATE users SET status='active', email_verified_at=COALESCE(email_verified_at, now()) WHERE id=$1",
        [existing.id]
      );
      logger.info(
        { username: existing.username, passwordMatches: matches },
        'demo account already exists (password was not changed)'
      );
      continue;
    }

    const hash = await hashPassword(password);
    const created = await one(
      `INSERT INTO users (username, email, password_hash, role, email_verified_at)
       VALUES ($1,$2,$3,'user',now()) RETURNING id`,
      [account.username, account.email, hash]
    );
    await query(
      `INSERT INTO user_profiles (user_id, display_name, visibility, discoverable)
       VALUES ($1,$2,'public',true)
       ON CONFLICT (user_id) DO NOTHING`,
      [created.id, account.displayName]
    );
    logger.info({ username: account.username }, 'demo account created');
  }
  process.exitCode = 0;
} catch (err) {
  logger.error({ err }, 'demo seeding failed');
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
