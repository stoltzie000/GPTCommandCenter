import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assertApprovalBelongsToWorkflow } from '../src/api-boundaries.js';
import { MemoryStore } from '../src/store.js';
import { readWorkflow } from '../src/workflow-read-model.js';

test('cross-workflow approval identifiers fail before approval mutation', () => {
  const approval = {
    id: randomUUID(),
    workflowId: randomUUID(),
    protectedActionId: 'specialist-run',
    reason: 'protected execution requires approval',
    categories: ['EXTERNAL_ACCESS' as const],
    status: 'PENDING' as const,
    scopeFingerprint: 'scope-v1',
    decisionReason: null,
    decidedBy: null,
    createdAt: new Date().toISOString(),
    decidedAt: null
  };
  assert.throws(() => assertApprovalBelongsToWorkflow(randomUUID(), approval), /APPROVAL_NOT_FOUND/);
  assert.equal(approval.status, 'PENDING');
  assert.equal(assertApprovalBelongsToWorkflow(approval.workflowId, approval), approval);
});

test('workflow result read model excludes persisted authorization and repository context', async () => {
  const store = new MemoryStore();
  const workflow = store.createWorkflow({
    requestId: randomUUID(),
    workflowType: 'software',
    logicalSpecialistId: null,
    runtimeId: undefined,
    validationRequired: false,
    effectiveClassification: 'CONFIDENTIAL',
    objective: 'release-gate task',
    context: {
      principal: { id: 'owner', roles: ['operator'], scopes: ['repo:read'] },
      resolvedRepository: { source: '/private/repository', repositoryId: 'private-repo' },
      authorizationDecision: { allowed: true, ruleId: 'private-policy' }
    },
    requiresImplementation: false
  });
  const result = await readWorkflow(store, workflow);
  assert.equal(result.id, workflow.id);
  assert.equal('context' in result, false);
  assert.equal('resolvedRepository' in result, false);
  assert.equal('principal' in result, false);
});
