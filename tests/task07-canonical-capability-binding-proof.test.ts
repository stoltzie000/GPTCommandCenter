import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAISpecialistExecutor } from '../src/executors.js';
import { registry, resolveRoutableSpecialist, validateRegistry } from '../src/registry.js';
import { freezeContext } from '../src/trust.js';

const principal = { id: 'task07-user', roles: ['developer'], scopes: ['run'], authType: 'local' as const, maxClassification: 'RESTRICTED' as const };
const repository = { repositoryId: 'task07-repo', source: '.', classification: 'PUBLIC' as const, allowedCallers: ['task07-user'], allowedSpecialists: ['architecture-security-advisor'], allowedExecutionTypes: ['specialist'], allowedRefs: ['main'], approvedRef: 'main' };

test('07-01 canonical runtime metadata is bound to each canonical specialist definition', () => {
  validateRegistry(registry);
  for (const specialist of Object.values(registry).filter(item => item.status === 'ACTIVE' && item.routingApproved !== false && item.role !== 'ORCHESTRATOR' && item.role !== 'UNKNOWN_PENDING_REVIEW')) {
    assert.equal(resolveRoutableSpecialist(specialist.id), specialist);
    if (specialist.runtimeId !== null) {
      assert.ok(specialist.runtime);
      assert.equal(specialist.runtime.runtimeId, specialist.runtimeId);
    }
  }
});

test('07-02 a valid canonical identity cannot use forged runtime configuration', async () => {
  const specialist = resolveRoutableSpecialist('architecture-security-advisor');
  assert.ok(specialist?.runtime);
  const trustedContext = freezeContext({ principal, operation: 'run', requestId: 'task07-runtime', workflowId: 'task07-workflow', specialistId: specialist.id, executionType: 'specialist', effectiveClassification: 'PUBLIC' }, repository);
  let providerCalls = 0;
  const executor = new OpenAISpecialistExecutor('test-key', 'test-model', async () => {
    providerCalls += 1;
    throw new Error('provider must not be reached');
  });

  await assert.rejects(() => executor.execute({
    trustedContext,
    workflowId: 'task07-workflow',
    stageId: 'specialist:architecture-security-advisor',
    runtimeId: 'forged-runtime',
    runtimeVersion: '9.9.9',
    objective: 'legitimate task input',
    context: { specialistConfig: { tools: ['forged-admin-tool'], permissions: ['unrestricted'] } },
    expectedOutputSchema: 'forged-output-schema'
  }), /AUTHORIZATION_FAILED/);
  assert.equal(providerCalls, 0);
});
