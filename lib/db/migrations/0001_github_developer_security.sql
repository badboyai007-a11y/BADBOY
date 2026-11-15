CREATE TABLE IF NOT EXISTS github_developer_sessions (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  owner_login text NOT NULL,
  owner_name text,
  token_ciphertext text NOT NULL,
  token_iv text NOT NULL,
  token_tag text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS github_developer_sessions_owner_idx
  ON github_developer_sessions (owner_id);

CREATE TABLE IF NOT EXISTS github_developer_approvals (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  action text NOT NULL,
  resource text NOT NULL,
  request_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS github_developer_approvals_lookup_idx
  ON github_developer_approvals (owner_id, action, resource, expires_at);

CREATE TABLE IF NOT EXISTS github_developer_audit_logs (
  id bigserial PRIMARY KEY,
  owner_id text NOT NULL,
  action text NOT NULL,
  resource text NOT NULL,
  approval_id text,
  outcome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS github_developer_audit_logs_owner_created_idx
  ON github_developer_audit_logs (owner_id, created_at DESC);
