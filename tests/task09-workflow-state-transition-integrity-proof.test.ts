import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MemoryStore } from '../src/store.js';
import { Orchestrator } from '../src/orchestrator.js';
import { freezeContext } from '../src/trust.js';

const principal = { id: 'task09-owner', roles: ['developer'], scopes: ['workflow:run'], authType: 'token' as const, maxClassification: 'RESTRICTED' as const };
const repository = { repositoryId: 'task09-repo', source: '.', classification: 'PUBLIC' as const, allowedCallers: [principal.id], allowedSpecialists: ['architecture-security-advisor'], allowedExecutionTypes: ['specialist'], allowedRefs: ['main'], approvedRef: 'main' };
const input = (context: unknown = { principal, resolvedRepository: repository }) => ({ requestId: randomUUID(), workflowType: 'non_code' as const, logicalSpecialistId: 'architecture-security-advisor', runtimeId: 'architecture-security-advisor-api', validationRequired: false, effectiveClassification: 'PUBLIC' as const, objective: 'state transition proof', context, requiresImplementation: false });
const unused = {} as any;
const runContext = (workflow: { id: string; requestId: string }) => freezeContext({ principal, operation: 'run', requestId: workflow.requestId, workflowId: workflow.id, specialistId: 'architecture-security-advisor', executionType: 'specialist', effectiveClassification: 'PUBLIC' }, repository);
const decision = (workflowId: string, selectedSpecialistId: string | null = 'architecture-security-advisor') => ({ id: randomUUID(), workflowId, selectedSpecialistId, routingConfidence: selectedSpecialistId ? 'CLEAR' as const : 'AMBIGUOUS' as const, routingReason: 'state proof', decisionType: 'INITIAL' as const, supersedesDecisionId: null, createdAt: new Date().toISOString() });

test('09-01 illegal lifecycle transitions fail without changing state or events', () => {
  const store = new MemoryStore();
  const workflow = store.createWorkflow(input());
  const before = { status: workflow.status, version: workflow.version, events: store.getEvents(workflow.id).length };
  assert.throws(() => store.transitionWorkflow(workflow, 'COMPLETE', 'caller', principal.id), /INVALID_STATE_TRANSITION/);
  assert.deepEqual({ status: workflow.status, version: workflow.version, events: store.getEvents(workflow.id).length }, before);
});

test('09-02 invalid routing state cannot leave memory routing history behind', async () => {
  const store = new MemoryStore();
  const workflow = store.createWorkflow(input());
  const invalid = decision(workflow.id, null);
  await assert.rejects(() => store.persistRoutingResolution(invalid, [], undefined), /CLARIFICATION_QUESTION_REQUIRED/);
  assert.equal((await store.getRoutingHistory(workflow.id)).length, 0);
  assert.equal(workflow.status, 'ROUTED');
});

test('09-03 clarification and approval gates block execution before executor work', async () => {
  for (const blockedState of ['AWAITING_CLARIFICATION', 'AWAITING_APPROVAL'] as const) {
    const store = new MemoryStore();
    const workflow = store.createWorkflow(input());
    store.transitionWorkflow(workflow, blockedState, 'system', blockedState);
    let launches = 0;
    const app = new Orchestrator(store, { execute: async () => { launches += 1; throw new Error('executor must not run'); } } as any, unused, unused, unused, { [repository.repositoryId]: repository });
    await assert.rejects(() => app.run(workflow.id, runContext(workflow)), new RegExp(blockedState === 'AWAITING_CLARIFICATION' ? 'CLARIFICATION_REQUIRED' : 'APPROVAL_REQUIRED'));
    assert.equal(launches, 0);
    assert.equal(store.getAttempts(workflow.id).length, 0);
  }
});

test('09-04 terminal workflow replay is deterministic and override is rejected', async () => {
  const store = new MemoryStore();
  const workflow = store.createWorkflow(input());
  store.transitionWorkflow(workflow, 'SPECIALIST_RUNNING', 'system', 'specialist');
  store.transitionWorkflow(workflow, 'SPECIALIST_COMPLETE', 'system', 'specialist');
  store.transitionWorkflow(workflow, 'COMPLETE', 'system', 'state-machine');
  let launches = 0;
  const app = new Orchestrator(store, { execute: async () => { launches += 1; throw new Error('executor must not run'); } } as any, unused, unused, unused, { [repository.repositoryId]: repository });
  const replay = await app.run(workflow.id, runContext(workflow));
  assert.equal(replay.status, 'COMPLETE');
  assert.equal(launches, 0);
  await assert.rejects(() => store.applyUserOverride(workflow.id, 'policy-document-reviewer'), /OVERRIDE_STATE_UNSAFE/);
});

test('09-05 answered clarification cannot resume a workflow that is no longer awaiting clarification', async () => {
  const store = new MemoryStore();
  const workflow = store.createWorkflow(input());
  const initial = decision(workflow.id, null);
  await store.recordRoutingDecisionWithCandidates(initial, []);
  const clarification = await store.createPendingClarification({ workflowId: workflow.id, routingDecisionId: initial.id, question: 'Which route?' });
  await store.recordClarificationResponse(clarification.id, 'Use the approved route');
  workflow.status = 'COMPLETE';
  const resumed = { ...decision(workflow.id), decisionType: 'POST_CLARIFICATION' as const, supersedesDecisionId: initial.id };
  await assert.rejects(() => store.resumeClarification(workflow.id, clarification.id, resumed, []), /CLARIFICATION_WORKFLOW_STATE_MISMATCH/);
  assert.equal((await store.getRoutingHistory(workflow.id)).length, 1);
});

test('09-06 override requires an actual pending clarification before changing its state', async () => {
  const store = new MemoryStore();
  const workflow = store.createWorkflow(input());
  const initial = decision(workflow.id);
  await store.recordRoutingDecision(initial);
  workflow.status = 'AWAITING_CLARIFICATION';
  await assert.rejects(() => store.applyUserOverride(workflow.id, 'policy-document-reviewer'), /CLARIFICATION_NOT_FOUND/);
  assert.equal((await store.getRoutingHistory(workflow.id)).length, 1);
  assert.equal(workflow.status, 'AWAITING_CLARIFICATION');
});
