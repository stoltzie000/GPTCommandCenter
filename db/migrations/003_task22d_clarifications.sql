CREATE TABLE IF NOT EXISTS routing_clarifications (
  id UUID PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES workflows(id),
  routing_decision_id UUID NOT NULL REFERENCES routing_decisions(id),
  question TEXT NOT NULL CHECK (length(btrim(question)) > 0),
  status TEXT NOT NULL CHECK (status IN ('PENDING','ANSWERED')),
  response TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  answered_at TIMESTAMPTZ NULL,
  CHECK (
    (status = 'PENDING' AND response IS NULL AND answered_at IS NULL)
    OR
    (status = 'ANSWERED' AND response IS NOT NULL AND length(btrim(response)) > 0 AND answered_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS routing_clarifications_one_pending_idx
  ON routing_clarifications (workflow_id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS routing_clarifications_workflow_created_idx
  ON routing_clarifications (workflow_id, created_at, id);
CREATE INDEX IF NOT EXISTS routing_clarifications_decision_idx
  ON routing_clarifications (routing_decision_id);
