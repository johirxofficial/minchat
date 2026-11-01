-- MinChat initial schema
-- All timestamps are UTC timestamptz. Identifiers are UUID v4.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username citext NOT NULL UNIQUE,
  email citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
  failed_login_attempts integer NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
  locked_until timestamptz,
  last_active_at timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_username_format CHECK (username::text ~ '^[a-z0-9_]{3,30}$'),
  CONSTRAINT users_email_format CHECK (email::text ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);
CREATE INDEX users_status_idx ON users (status);
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Validated, server-owned file metadata. Binaries live outside the web root.
CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  storage_key text NOT NULL UNIQUE,
  original_name text NOT NULL,
  mime text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('image', 'video', 'audio', 'document', 'avatar', 'group_avatar')),
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX files_owner_idx ON files (owner_id, created_at DESC);

CREATE TABLE user_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name varchar(60) NOT NULL,
  bio varchar(300) NOT NULL DEFAULT '',
  avatar_file_id uuid REFERENCES files(id) ON DELETE SET NULL,
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  bio_visibility text NOT NULL DEFAULT 'public' CHECK (bio_visibility IN ('public', 'friends')),
  avatar_visibility text NOT NULL DEFAULT 'public' CHECK (avatar_visibility IN ('public', 'friends')),
  show_last_active text NOT NULL DEFAULT 'friends' CHECK (show_last_active IN ('everyone', 'friends', 'nobody')),
  show_online_status boolean NOT NULL DEFAULT true,
  friend_request_policy text NOT NULL DEFAULT 'everyone' CHECK (friend_request_policy IN ('everyone', 'friends_of_friends', 'nobody')),
  contact_policy text NOT NULL DEFAULT 'friends' CHECK (contact_policy IN ('friends', 'nobody')),
  discoverable boolean NOT NULL DEFAULT true,
  notify_messages boolean NOT NULL DEFAULT true,
  notify_calls boolean NOT NULL DEFAULT true,
  notify_friend_requests boolean NOT NULL DEFAULT true,
  push_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_profiles_display_name_len CHECK (char_length(display_name) BETWEEN 1 AND 60),
  CONSTRAINT user_profiles_bio_len CHECK (char_length(bio) <= 300)
);
CREATE INDEX user_profiles_display_name_trgm ON user_profiles USING gin (display_name gin_trgm_ops);
CREATE TRIGGER user_profiles_updated_at BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Only SHA-256 HMACs of session tokens are stored.
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  csrf_token text NOT NULL,
  ip inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  requested_ip inet,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_user_idx ON password_reset_tokens (user_id);
CREATE INDEX password_reset_expiry_idx ON password_reset_tokens (expires_at);

CREATE TABLE push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- Social graph
-- ---------------------------------------------------------------------------
CREATE TABLE friendships (
  user_a uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_a, user_b),
  CONSTRAINT friendships_order CHECK (user_a < user_b)
);
CREATE INDEX friendships_b_idx ON friendships (user_b);

CREATE TABLE friend_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message varchar(200),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CONSTRAINT friend_requests_not_self CHECK (requester_id <> addressee_id)
);
CREATE UNIQUE INDEX friend_requests_one_pending
  ON friend_requests (least(requester_id, addressee_id), greatest(requester_id, addressee_id))
  WHERE status = 'pending';
CREATE INDEX friend_requests_addressee_idx ON friend_requests (addressee_id, status, created_at DESC);
CREATE INDEX friend_requests_requester_idx ON friend_requests (requester_id, status, created_at DESC);

CREATE TABLE blocks (
  blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT blocks_not_self CHECK (blocker_id <> blocked_id)
);
CREATE INDEX blocks_blocked_idx ON blocks (blocked_id);

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reported_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (reason IN ('spam', 'harassment', 'impersonation', 'inappropriate_media', 'scam', 'other')),
  details varchar(1000) NOT NULL DEFAULT '',
  message_id uuid,
  conversation_id uuid,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  resolution_note varchar(1000)
);
CREATE INDEX reports_status_idx ON reports (status, created_at DESC);
CREATE INDEX reports_reported_idx ON reports (reported_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Conversations and messages
-- ---------------------------------------------------------------------------
CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('direct', 'group')),
  name varchar(80),
  image_file_id uuid REFERENCES files(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  direct_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz,
  CONSTRAINT conversations_shape CHECK (
    (type = 'direct' AND direct_key IS NOT NULL AND name IS NULL)
    OR (type = 'group' AND direct_key IS NULL AND name IS NOT NULL)
  )
);
CREATE INDEX conversations_last_message_idx ON conversations (last_message_at DESC NULLS LAST);
CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  last_read_at timestamptz,
  last_read_message_id uuid,
  muted_until timestamptz,
  notification_level text NOT NULL DEFAULT 'all' CHECK (notification_level IN ('all', 'mentions', 'none')),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX conversation_members_user_idx ON conversation_members (user_id) WHERE left_at IS NULL;
CREATE INDEX conversation_members_admin_idx ON conversation_members (conversation_id) WHERE role = 'admin' AND left_at IS NULL;

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES users(id) ON DELETE SET NULL,
  type text NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'image', 'video', 'audio', 'file', 'system')),
  body text,
  reply_to_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  client_nonce text,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(body, ''))) STORED,
  CONSTRAINT messages_body_shape CHECK (
    (deleted_at IS NOT NULL AND body IS NULL)
    OR (deleted_at IS NULL AND type = 'system' AND body IS NOT NULL)
    OR (deleted_at IS NULL AND type <> 'system' AND body IS NOT NULL AND char_length(body) BETWEEN 1 AND 4000)
    OR (deleted_at IS NULL AND type IN ('image','video','audio','file') AND (body IS NULL OR char_length(body) <= 4000))
  )
);
CREATE UNIQUE INDEX messages_client_nonce
  ON messages (sender_id, client_nonce) WHERE client_nonce IS NOT NULL;
CREATE INDEX messages_conversation_cursor ON messages (conversation_id, created_at DESC, id DESC);
CREATE INDEX messages_sender_idx ON messages (sender_id, created_at DESC);
CREATE INDEX messages_search_idx ON messages USING gin (search_vector);
CREATE INDEX messages_body_trgm ON messages USING gin (body gin_trgm_ops);
CREATE INDEX messages_reply_idx ON messages (reply_to_id) WHERE reply_to_id IS NOT NULL;

ALTER TABLE conversation_members
  ADD CONSTRAINT conversation_members_last_read_fk
  FOREIGN KEY (last_read_message_id) REFERENCES messages(id) ON DELETE SET NULL;

CREATE TABLE message_reactions (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji varchar(16) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);
CREATE INDEX message_reactions_user_idx ON message_reactions (user_id);

CREATE TABLE message_receipts (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivered_at timestamptz,
  read_at timestamptz,
  PRIMARY KEY (message_id, user_id),
  CONSTRAINT message_receipts_read_implies_delivered CHECK (read_at IS NULL OR delivered_at IS NOT NULL)
);
CREATE INDEX message_receipts_pending_idx ON message_receipts (user_id) WHERE delivered_at IS NULL;

CREATE TABLE attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, file_id),
  UNIQUE (file_id)
);
CREATE INDEX attachments_message_idx ON attachments (message_id);

-- ---------------------------------------------------------------------------
-- Calls
-- ---------------------------------------------------------------------------
CREATE TABLE calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  caller_id uuid REFERENCES users(id) ON DELETE SET NULL,
  callee_id uuid REFERENCES users(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('voice', 'video')),
  status text NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing', 'accepted', 'rejected', 'missed', 'cancelled', 'ended', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  ended_at timestamptz,
  end_reason varchar(80),
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds >= 0)
);
CREATE UNIQUE INDEX calls_caller_active ON calls (caller_id) WHERE status IN ('ringing', 'accepted');
CREATE UNIQUE INDEX calls_callee_active ON calls (callee_id) WHERE status IN ('ringing', 'accepted');
CREATE INDEX calls_caller_history ON calls (caller_id, started_at DESC);
CREATE INDEX calls_callee_history ON calls (callee_id, started_at DESC);
CREATE INDEX calls_status_idx ON calls (status, started_at);

CREATE TABLE call_events (
  id bigserial PRIMARY KEY,
  call_id uuid NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  event text NOT NULL,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX call_events_call_idx ON call_events (call_id, created_at);

-- ---------------------------------------------------------------------------
-- Notifications and administration
-- ---------------------------------------------------------------------------
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('message', 'friend_request', 'friend_accepted', 'missed_call', 'group_add', 'group_remove', 'system')),
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  message_id uuid REFERENCES messages(id) ON DELETE CASCADE,
  call_id uuid REFERENCES calls(id) ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE admin_audit_logs (
  id bigserial PRIMARY KEY,
  admin_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip inet,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_created_idx ON admin_audit_logs (created_at DESC);
CREATE INDEX admin_audit_admin_idx ON admin_audit_logs (admin_id, created_at DESC);
