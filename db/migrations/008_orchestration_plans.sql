CREATE TABLE IF NOT EXISTS orchestration_plans (
  id UUID PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES workflows(id),
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PLANNED','RUNNING','COMPLETE','FAILED','MANUAL_HANDOFF_REQUIRED')),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workflow_id, version)
);
CREATE TABLE IF NOT EXISTS orchestration_plan_stages (
  id UUID PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES orchestration_plans(id),
  workflow_id UUID NOT NULL REFERENCES workflows(id),
  specialist_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  dependencies TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('PENDING','RUNNING','COMPLETE','FAILED','MANUAL_HANDOFF_REQUIRED')),
  stage_order INTEGER NOT NULL,
  output_artifact_id UUID NULL REFERENCES artifacts(id),
  UNIQUE(plan_id, stage_order),
  UNIQUE(plan_id, id)
);
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS plan_id UUID NULL REFERENCES orchestration_plans(id);
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS plan_stage_id UUID NULL REFERENCES orchestration_plan_stages(id);
ALTER TABLE artifacts ADD COLUMN IF NOT EXISTS specialist_id TEXT NULL;
CREATE INDEX IF NOT EXISTS orchestration_plan_stages_plan_order_idx ON orchestration_plan_stages(plan_id, stage_order);
