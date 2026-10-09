CREATE TABLE admin_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_sessions_user_idx ON admin_sessions(admin_user_id);
CREATE INDEX admin_sessions_expiry_idx ON admin_sessions(expires_at);
ALTER TABLE audit_logs ADD COLUMN actor_role text CHECK (actor_role IS NULL OR actor_role IN ('NEWS_ADMIN','MANAGER','BRT_ADMIN'));
CREATE INDEX audit_logs_actor_created_idx ON audit_logs(actor_id,created_at DESC);
