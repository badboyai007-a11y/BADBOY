CREATE TABLE IF NOT EXISTS github_developer_permissions (
  id text PRIMARY KEY,
  owner_id text NOT NULL,
  repository text NOT NULL,
  branch_pattern text NOT NULL,
  actions jsonb NOT NULL CHECK (jsonb_typeof(actions) = 'array'),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS github_developer_permissions_scope_idx
  ON github_developer_permissions (owner_id, repository, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS github_developer_lockdowns (
  owner_id text PRIMARY KEY,
  reason text NOT NULL,
  locked_at timestamptz NOT NULL DEFAULT now()
);

-- Approval issuance and consumption both re-check the Owner's current scope.
-- This makes revocation and emergency lockdown effective even for pending approvals.
CREATE OR REPLACE FUNCTION enforce_github_developer_approval_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  repo text;
  branch_ref text;
  permitted boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM github_developer_lockdowns WHERE owner_id = NEW.owner_id) THEN
    RAISE EXCEPTION 'GitHub developer actions are locked down by the owner'
      USING ERRCODE = '42501';
  END IF;

  repo := split_part(NEW.resource, ':', 1);
  branch_ref := split_part(NEW.resource, ':', 2);
  IF NEW.action = 'create-draft-pr' THEN
    branch_ref := split_part(branch_ref, '->', 1);
  ELSIF NEW.action = 'dispatch-workflow' THEN
    branch_ref := split_part(branch_ref, '@', 2);
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM github_developer_permissions p
     WHERE p.owner_id = NEW.owner_id
       AND p.repository = repo
       AND p.revoked_at IS NULL
       AND p.expires_at > NOW()
       AND p.actions ? NEW.action
       AND (
         p.branch_pattern = '*'
         OR p.branch_pattern = branch_ref
         OR (right(p.branch_pattern, 2) = '/*'
             AND branch_ref LIKE left(p.branch_pattern, length(p.branch_pattern) - 1) || '%')
       )
  ) INTO permitted;

  IF NOT permitted THEN
    RAISE EXCEPTION 'No active owner permission matches this repository, branch and action'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS github_developer_approval_scope_guard ON github_developer_approvals;
CREATE TRIGGER github_developer_approval_scope_guard
BEFORE INSERT OR UPDATE OF consumed_at ON github_developer_approvals
FOR EACH ROW EXECUTE FUNCTION enforce_github_developer_approval_scope();

-- Audit rows are append-only through the application database role.
CREATE OR REPLACE FUNCTION prevent_github_developer_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'GitHub developer audit records are append-only'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS github_developer_audit_immutable ON github_developer_audit_logs;
CREATE TRIGGER github_developer_audit_immutable
BEFORE UPDATE OR DELETE ON github_developer_audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_github_developer_audit_mutation();
