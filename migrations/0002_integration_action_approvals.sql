-- One-time, owner-scoped approvals for external integration side effects.
-- Only token hashes and action hashes are stored; raw approval tokens are never persisted.
CREATE TABLE IF NOT EXISTS integration_action_approvals (
  approval_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('home_assistant', 'slack')),
  action_hash TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_integration_approvals_owner_expiry
  ON integration_action_approvals(owner_id, expires_at);
