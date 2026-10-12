CREATE TABLE auth_login_attempts (
  ip_hash text PRIMARY KEY CHECK (ip_hash ~ '^[a-f0-9]{64}$'),
  failed_attempts integer NOT NULL CHECK (failed_attempts > 0),
  window_started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auth_login_attempts_updated_idx ON auth_login_attempts(updated_at);
