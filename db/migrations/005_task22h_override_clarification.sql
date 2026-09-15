ALTER TABLE routing_clarifications DROP CONSTRAINT IF EXISTS routing_clarifications_status_check;
ALTER TABLE routing_clarifications DROP CONSTRAINT IF EXISTS routing_clarifications_check;
ALTER TABLE routing_clarifications ADD CONSTRAINT routing_clarifications_status_check
  CHECK (status IN ('PENDING','ANSWERED','SUPERSEDED'));
ALTER TABLE routing_clarifications DROP CONSTRAINT IF EXISTS routing_clarifications_status_consistency_check;
ALTER TABLE routing_clarifications ADD CONSTRAINT routing_clarifications_status_consistency_check
  CHECK (
    (status = 'PENDING' AND response IS NULL AND answered_at IS NULL)
    OR
    (status = 'ANSWERED' AND response IS NOT NULL AND length(btrim(response)) > 0 AND answered_at IS NOT NULL)
    OR
    (status = 'SUPERSEDED' AND response IS NULL AND answered_at IS NULL)
  );
