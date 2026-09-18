import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MemoryStore } from '../src/store.js';
import { Orchestrator } from '../src/orchestrator.js';
import { assertWorkflowPrincipal, contextFromWorkflow } from '../src/trust.js';

const owner = { id: 'task08-owner', roles: ['developer'], scopes: ['workflow:create', 'workflow:run'], authType: 'token' as const, maxClassification: 'RESTRICTED' as const };
const other = { id: 'task08-other', roles: ['developer'], scopes: ['workflow:create', 'workflow:run'], authType: 'token' as const, maxClassification: 'RESTRICTED' as const };
const repository = { repositoryId: 'task08-repo', source: '.', classification: 'PUBLIC' as const, allowedCallers: [owner.id, other.id], allowedSpecialists: ['architecture-security-advisor'], allowedExecutionTypes: ['specialist'], allowedRefs: ['main'], approvedRef: 'main' };

const unused = {} as any;
const workflowInput = (context: unknown) => ({ requestId: randomUUID(), workflowType: 'non_code' as const, logicalSpecialistId: 'architecture-security-advisor', runtimeId: 'architecture-security-advisor-api', validationRequired: false, effectiveClassification: 'PUBLIC' as const, objective: 'authorized architecture review', context, requiresImplementation: false });

test('08-01 an authorized principal resolves the canonical specialist within the authorized repository', () => {
  const workflow = { id: 'task08-workflow', requestId: 'task08-request', logicalSpecialistId: 'architecture-security-advisor', effectiveClassification: 'PUBLIC' as const, context: { principal: owner, resolvedRepository: repository } };
  assert.doesNotThrow(() => assertWorkflowPrincipal(workflow, owner));
  const context = contextFromWorkflow(workflow, 'run', 'specialist', owner, { 'task08-repo': repository });
  assert.equal(context.principal.id, owner.id);
  assert.equal(context.resolvedRepository?.repositoryId, repository.repositoryId);
  assert.equal(context.specialistId, 'architecture-security-advisor');
});

test('08-02 a valid specialist does not authorize another principal to read or execute the workflow', () => {
  const workflow = { id: 'task08-workflow', requestId: 'task08-request', logicalSpecialistId: 'architecture-security-advisor', effectiveClassification: 'PUBLIC' as const, context: { principal: owner, resolvedRepository: repository } };
  assert.throws(() => assertWorkflowPrincipal(workflow, other), /AUTHORIZATION_FAILED/);
  assert.throws(() => contextFromWorkflow(workflow, 'run', 'specialist', other, { 'task08-repo': repository }), /AUTHORIZATION_FAILED/);
});

test('08-03 specialist override cannot bypass the persisted workflow principal boundary', async () => {
  const store = new MemoryStore();
  const workflow = store.createWorkflow(workflowInput({ principal: owner, resolvedRepository: repository }));
  const decision = { id: randomUUID(), workflowId: workflow.id, selectedSpecialistId: workflow.logicalSpecialistId, routingConfidence: 'CLEAR' as const, routingReason: 'canonical route', decisionType: 'INITIAL' as const, supersedesDecisionId: null, createdAt: new Date().toISOString() };
  await store.recordRoutingDecision(decision);
  const app = new Orchestrator(store, unused, unused, unused, unused, { 'task08-repo': repository });
  await assert.rejects(() => app.applyUserOverride(workflow.id, 'policy-document-reviewer', 'forged scope', other, decision.id), /AUTHORIZATION_FAILED/);
  assert.equal((await store.getLatestRoutingDecision(workflow.id))?.id, decision.id);
});

test('08-04 clarification resume cannot bypass the persisted workflow principal boundary', async () => {
  const store = new MemoryStore();
  const workflow = store.createWorkflow(workflowInput({ principal: owner, resolvedRepository: repository }));
  const decision = { id: randomUUID(), workflowId: workflow.id, selectedSpecialistId: null, routingConfidence: 'AMBIGUOUS' as const, routingReason: 'clarification required', decisionType: 'INITIAL' as const, supersedesDecisionId: null, createdAt: new Date().toISOString() };
  await store.recordRoutingDecisionWithCandidates(decision, [{ id: randomUUID(), routingDecisionId: decision.id, specialistId: 'architecture-security-advisor', rank: 1, matchReason: 'architecture' }]);
  const clarification = await store.createPendingClarification({ workflowId: workflow.id, routingDecisionId: decision.id, question: 'Which architecture scope?' });
  const app = new Orchestrator(store, unused, unused, unused, unused, { 'task08-repo': repository });
  await assert.rejects(() => app.resumeClarification(workflow.id, clarification.id, 'use the approved scope', other), /AUTHORIZATION_FAILED/);
  assert.equal((await store.getClarification(clarification.id))?.status, 'PENDING');
});
