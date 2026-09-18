import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MemoryStore } from '../src/store.js';

const input = () => ({
  requestId: randomUUID(),
  workflowType: 'non_code' as const,
  logicalSpecialistId: 'architecture-security-advisor',
  runtimeId: 'architecture-security-advisor-api',
  validationRequired: false,
  effectiveClassification: 'PUBLIC' as const,
  objective: 'event and result integrity proof',
  context: {},
  requiresImplementation: false
});

test('10-01 valid artifacts emit trusted workflow-bound audit evidence', () => {
  const store = new MemoryStore();
  const workflow = store.createWorkflow(input());
  const artifact = store.addArtifact(workflow.id, 'specialist_output', { result: 'ok' });
  const events = store.getEvents(workflow.id);
  const event = events.find(candidate => candidate.eventType === 'ARTIFACT_CREATED');

  assert.ok(event);
  assert.equal(artifact.workflowId, workflow.id);
  assert.equal(event.workflowId, workflow.id);
  assert.deepEqual(event.metadata, {
    artifactId: artifact.id,
    artifactType: artifact.artifactType,
    contentHash: artifact.contentHash
  });
  assert.equal(event.sequence, events.length);
});

test('10-02 mismatched workflow context cannot mutate an attempt or attach another workflow artifact', () => {
  const store = new MemoryStore();
  const first = store.createWorkflow(input());
  const second = store.createWorkflow(input());
  const firstClaim = store.claimStage(first.id, 'specialist:first', 'specialist', first.runtimeId, 'worker');
  const secondClaim = store.claimStage(second.id, 'specialist:second', 'specialist', second.runtimeId, 'worker');
  const secondArtifact = store.addArtifact(second.id, 'specialist_output', { result: 'second' });

  assert.throws(() => store.recordInitiation(second.id, firstClaim.attempt.id, { forged: true }, 'worker'), /ATTEMPT_WORKFLOW_MISMATCH/);
  assert.throws(() => store.completeStage(first.id, firstClaim.attempt.id, 'execution', secondArtifact.id, {}, 'worker'), /ARTIFACT_WORKFLOW_MISMATCH/);
  assert.throws(() => store.completeStage(second.id, firstClaim.attempt.id, 'execution', undefined, {}, 'worker'), /ATTEMPT_WORKFLOW_MISMATCH/);

  assert.equal(store.getAttempts(first.id)[0].state, 'CLAIMED');
  assert.equal(store.getStages(first.id)[0].status, 'PENDING');
  assert.equal(store.getAttempts(second.id)[0].state, 'CLAIMED');
  assert.equal(store.getArtifacts(first.id).length, 0);
});

test('10-03 rejected provenance writes fail closed without creating success evidence', async () => {
  const store = new MemoryStore();
  const workflow = store.createWorkflow(input());
  const before = store.getEvents(workflow.id).length;
  const forgedDecision = {
    id: randomUUID(),
    workflowId: randomUUID(),
    selectedSpecialistId: null,
    routingConfidence: 'NO_MATCH' as const,
    routingReason: 'forged',
    decisionType: 'FALLBACK' as const,
    supersedesDecisionId: null,
    createdAt: new Date().toISOString()
  };

  assert.throws(() => store.appendEvent({
    workflowId: randomUUID(),
    eventType: 'WORKFLOW_COMPLETE',
    actorType: 'caller',
    actorId: 'forged'
  }), /WORKFLOW_NOT_FOUND/);
  assert.throws(() => store.addArtifact(randomUUID(), 'codex_result', { forged: true }), /WORKFLOW_NOT_FOUND/);
  assert.throws(() => store.recordRoutingDecision(forgedDecision), /WORKFLOW_NOT_FOUND/);
  assert.throws(() => store.recordRoutingCandidates([{ id: randomUUID(), routingDecisionId: randomUUID(), specialistId: 'forged', rank: 1, matchReason: 'forged' }]), /ROUTING_DECISION_NOT_FOUND/);

  assert.equal(store.getEvents(workflow.id).length, before);
  assert.equal(store.getArtifacts(workflow.id).length, 0);
  assert.equal((await store.getRoutingHistory(workflow.id)).length, 0);
});

test('10-04 duplicate stage claims do not create duplicate authoritative attempts or artifacts', () => {
  const store = new MemoryStore();
  const workflow = store.createWorkflow(input());
  const first = store.claimStage(workflow.id, 'specialist:single', 'specialist', workflow.runtimeId, 'worker-a');
  const duplicate = store.claimStage(workflow.id, 'specialist:single', 'specialist', workflow.runtimeId, 'worker-b');

  assert.equal(duplicate.existing, true);
  assert.equal(duplicate.attempt.id, first.attempt.id);
  assert.equal(store.getAttempts(workflow.id).length, 1);
  assert.equal(store.getArtifacts(workflow.id).length, 0);
});
