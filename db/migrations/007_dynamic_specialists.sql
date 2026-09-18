CREATE TABLE IF NOT EXISTS specialists (
  id TEXT PRIMARY KEY,
  origin TEXT NOT NULL CHECK (origin = 'DYNAMIC'),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE','INACTIVE','DEPRECATED')),
  version TEXT NOT NULL,
  definition JSONB NOT NULL,
  source_workflow_id UUID NULL REFERENCES workflows(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS specialists_active_idx ON specialists(status, id);
