-- Follow-up integrity and search indexes that depend on tables created later.

ALTER TABLE reports
  ADD CONSTRAINT reports_message_fk FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL,
  ADD CONSTRAINT reports_conversation_fk FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL;

CREATE INDEX users_username_trgm ON users USING gin ((username::text) gin_trgm_ops);
CREATE INDEX reports_reporter_idx ON reports (reporter_id, created_at DESC);
CREATE INDEX notifications_conversation_idx ON notifications (conversation_id);
CREATE INDEX calls_conversation_idx ON calls (conversation_id, started_at DESC);
CREATE INDEX admin_audit_target_idx ON admin_audit_logs (target_type, target_id);
