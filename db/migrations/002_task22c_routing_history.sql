CREATE TABLE IF NOT EXISTS routing_decisions (
  id UUID PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES workflows(id),
  selected_specialist_id TEXT NULL,
  routing_confidence TEXT NOT NULL CHECK (routing_confidence IN ('CLEAR','PROBABLE','AMBIGUOUS','NO_MATCH')),
  routing_reason TEXT NOT NULL,
  decision_type TEXT NOT NULL CHECK (decision_type IN ('INITIAL','POST_CLARIFICATION','USER_OVERRIDE','DOWNSTREAM_ROUTE','FALLBACK')),
  supersedes_decision_id UUID NULL REFERENCES routing_decisions(id),
  created_at TIMESTAMPTZ NOT NULL,
  CHECK (supersedes_decision_id IS NULL OR supersedes_decision_id <> id)
);

CREATE TABLE IF NOT EXISTS routing_candidates (
  id UUID PRIMARY KEY,
  routing_decision_id UUID NOT NULL REFERENCES routing_decisions(id),
  specialist_id TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK (rank > 0),
  match_reason TEXT NOT NULL,
  UNIQUE (routing_decision_id, specialist_id),
  UNIQUE (routing_decision_id, rank)
);

CREATE INDEX IF NOT EXISTS routing_decisions_workflow_created_idx
  ON routing_decisions (workflow_id, created_at, id);
CREATE INDEX IF NOT EXISTS routing_decisions_supersedes_idx
  ON routing_decisions (supersedes_decision_id);
CREATE INDEX IF NOT EXISTS routing_candidates_decision_rank_idx
  ON routing_candidates (routing_decision_id, rank, id);
