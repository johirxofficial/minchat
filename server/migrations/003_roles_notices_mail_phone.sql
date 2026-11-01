-- MinChat migration 003
-- Staff roles, admin notices, transactional mail queue, phone verification,
-- email verification and runtime site settings.

-- ---------------------------------------------------------------------------
-- Roles: user < staff < manager < admin
-- ---------------------------------------------------------------------------
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'staff', 'manager', 'admin'));

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_format;
ALTER TABLE users
  ADD CONSTRAINT users_phone_format CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{7,14}$');

CREATE UNIQUE INDEX IF NOT EXISTS users_phone_key ON users (phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_role_idx ON users (role);

-- Existing accounts are treated as verified only when the deployment was seeded
-- before verification existed; new accounts start unverified.
UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL AND status = 'active';

-- ---------------------------------------------------------------------------
-- Email verification
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  email citext NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_verification_user_idx ON email_verification_tokens (user_id);

-- ---------------------------------------------------------------------------
-- Phone verification (codes are stored as HMACs, never in plain text)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS phone_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone text NOT NULL,
  code_hash text NOT NULL,
  purpose text NOT NULL DEFAULT 'verify' CHECK (purpose IN ('verify', 'change')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS phone_verifications_user_idx ON phone_verifications (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Admin notices (shown above the conversation list)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(120) NOT NULL,
  body text NOT NULL,
  level text NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'success', 'warning', 'critical')),
  audience text NOT NULL DEFAULT 'everyone' CHECK (audience IN ('everyone', 'staff', 'admins')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  pinned boolean NOT NULL DEFAULT false,
  dismissible boolean NOT NULL DEFAULT true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notices_title_len CHECK (char_length(title) BETWEEN 1 AND 120),
  CONSTRAINT notices_body_len CHECK (char_length(body) BETWEEN 1 AND 2000),
  CONSTRAINT notices_window CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS notices_live_idx ON notices (status, starts_at, ends_at);

DROP TRIGGER IF EXISTS notices_updated_at ON notices;
CREATE TRIGGER notices_updated_at BEFORE UPDATE ON notices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS notice_dismissals (
  notice_id uuid NOT NULL REFERENCES notices(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notice_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Transactional mail outbox (queued, retried, auditable)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mail_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  to_email citext NOT NULL,
  template text NOT NULL,
  subject text NOT NULL,
  text_body text,
  html_body text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mail_outbox_queue_idx ON mail_outbox (status, scheduled_at);
CREATE INDEX IF NOT EXISTS mail_outbox_created_idx ON mail_outbox (created_at DESC);
CREATE INDEX IF NOT EXISTS mail_outbox_user_idx ON mail_outbox (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Runtime settings editable by administrators (env remains the default)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app_settings (key, value) VALUES
  ('registration_open', 'true'::jsonb),
  ('maintenance_mode', 'false'::jsonb),
  ('maintenance_message', '"MinChat is getting a quick tune-up. Please check back shortly."'::jsonb),
  ('require_email_verification', 'false'::jsonb),
  ('public_directory', 'true'::jsonb),
  ('max_upload_mb', '25'::jsonb),
  ('support_email', '"support@minchat.local"'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Security: track the last sign-in for account activity emails
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_ip inet;
