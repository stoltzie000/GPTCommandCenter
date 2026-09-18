import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MemoryStore } from '../src/store.js';
import { Orchestrator } from '../src/orchestrator.js';

const principal = { id: 'task11-owner', roles: ['developer'], scopes: ['workflow:run'], authType: 'token' as const, maxClassification: 'RESTRICTED' as const };
const repository = { repositoryId: 'task11-repo', source: '.', classification: 'PUBLIC' as const, allowedCallers: [principal.id], allowedSpecialists: ['architecture-security-advisor'], allowedExecutionTypes: ['specialist', 'codex', 'validation'], allowedRefs: ['main'], approvedRef: 'main' };
const input = () => ({ requestId: randomUUID(), workflowType: 'non_code' as const, logicalSpecialistId: 'architecture-security-advisor', runtimeId: 'architecture-security-advisor-api', validationRequired: false, effectiveClassification: 'PUBLIC' as const, objective: 'recovery proof', context: { principal, resolvedRepository: repository }, requiresImplementation: false });

function app(store: MemoryStore) {
  return new Orchestrator(store, {} as any, {} as any, {} as any, {} as any, { [repository.repositoryId]: repository });
}

test('11-01 recovery converts persisted running work to manual handoff and blocks stale completion', async () => {
  const store = new MemoryStore();
  const workflow = store.createWorkflow(input());
  const claim = store.claimStage(workflow.id, 'specialist:architecture-security-advisor', 'specialist', workflow.runtimeId, 'worker-a');
  store.recordInitiation(workflow.id, claim.attempt.id, { externalExecutionId: 'specialist-started' }, 'worker-a');
  store.transitionWorkflow(workflow, 'SPECIALIST_RUNNING', 'orchestrator', 'specialist', undefined, claim.stage.id);

  const recovered = await app(store).recover(workflow.id, principal, 'process restarted during specialist execution');
  assert.equal(recovered.status, 'MANUAL_HANDOFF_REQUIRED');
  assert.throws(() => store.completeStage(workflow.id, claim.attempt.id, 'specialist-finished-late', undefined, {}, 'worker-a'), /WORKFLOW_NOT_ACTIVE/);
  assert.throws(() => store.transitionWorkflow(workflow, 'SPECIALIST_COMPLETE', 'stale-worker', 'worker-a'), /INVALID_STATE_TRANSITION/);
  assert.equal(store.getAttempts(workflow.id)[0].state, 'RUNNING');
});

test('11-02 recovery requires the current authorized principal and an active attempt', async () => {
  const store = new MemoryStore();
  const workflow = store.createWorkflow(input());
  store.transitionWorkflow(workflow, 'SPECIALIST_RUNNING', 'orchestrator', 'specialist');
  const otherPrincipal = { ...principal, id: 'other-principal' };
  await assert.rejects(() => app(store).recover(workflow.id, otherPrincipal, 'recovery'), /AUTHORIZATION_FAILED/);
  await assert.rejects(() => app(store).recover(workflow.id, principal, 'recovery'), /RECOVERY_ATTEMPT_NOT_ACTIVE/);
  assert.equal(workflow.status, 'SPECIALIST_RUNNING');
});

test('11-03 a claimed-but-not-started stage can be recovered without replaying external work', async () => {
  const store = new MemoryStore();
  const workflow = store.createWorkflow(input());
  store.claimStage(workflow.id, 'specialist:architecture-security-advisor', 'specialist', workflow.runtimeId, 'worker-a');

  const recovered = await app(store).recover(workflow.id, principal);
  assert.equal(recovered.status, 'MANUAL_HANDOFF_REQUIRED');
  assert.throws(() => store.claimStage(workflow.id, 'specialist:architecture-security-advisor', 'specialist', workflow.runtimeId, 'worker-b'), /WORKFLOW_NOT_ACTIVE/);
});

test('11-04 duplicate claims and terminal replays do not create new execution work', async () => {
  const store = new MemoryStore();
  const workflow = store.createWorkflow(input());
  const first = store.claimStage(workflow.id, 'specialist:architecture-security-advisor', 'specialist', workflow.runtimeId, 'worker-a');
  const duplicate = store.claimStage(workflow.id, 'specialist:architecture-security-advisor', 'specialist', workflow.runtimeId, 'worker-b');
  assert.equal(duplicate.existing, true);
  assert.equal(duplicate.attempt.id, first.attempt.id);

  store.transitionWorkflow(workflow, 'SPECIALIST_RUNNING', 'orchestrator', 'specialist');
  store.transitionWorkflow(workflow, 'SPECIALIST_COMPLETE', 'orchestrator', 'specialist');
  store.transitionWorkflow(workflow, 'COMPLETE', 'orchestrator', 'state-machine');
  const before = store.getAttempts(workflow.id).length;
  assert.throws(() => store.claimStage(workflow.id, 'codex', 'codex', undefined, 'worker-c'), /WORKFLOW_NOT_ACTIVE/);
  assert.equal(store.getAttempts(workflow.id).length, before);
});
