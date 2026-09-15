CREATE TABLE IF NOT EXISTS workflow_approvals (
  id UUID PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES workflows(id),
  protected_action_id TEXT NOT NULL CHECK (length(btrim(protected_action_id)) > 0),
  scope_fingerprint TEXT NOT NULL CHECK (length(btrim(scope_fingerprint)) > 0),
  reason TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  categories TEXT[] NOT NULL CHECK (cardinality(categories) > 0 AND categories <@ ARRAY['SCOPE','AUTHORITY','COST','EXTERNAL_ACCESS','SECURITY_PRIVACY','EXECUTION_RISK']::TEXT[]),
  status TEXT NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  decision_reason TEXT NULL,
  decided_by TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  decided_at TIMESTAMPTZ NULL,
  CHECK ((status = 'PENDING' AND decided_at IS NULL) OR (status IN ('APPROVED','REJECTED') AND decided_at IS NOT NULL)),
  CHECK (status = 'PENDING' OR decision_reason IS NULL OR length(btrim(decision_reason)) > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS workflow_approvals_one_pending_action_idx ON workflow_approvals (workflow_id, protected_action_id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS workflow_approvals_workflow_created_idx ON workflow_approvals (workflow_id, created_at, id);
CREATE INDEX IF NOT EXISTS workflow_approvals_action_status_idx ON workflow_approvals (workflow_id, protected_action_id, status, created_at DESC, id DESC);
