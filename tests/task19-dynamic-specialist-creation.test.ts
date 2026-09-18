import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../src/store.js';
import { assessSpecialistCoverage, buildDynamicSpecialist, dynamicSpecialistId, mergeSpecialistCatalog } from '../src/specialist-catalog.js';
import { registry, resolveRoutableSpecialist, validateRegistry } from '../src/registry.js';
import { selectCandidates } from '../src/routing.js';
import { TaskInterpretation } from '../src/domain.js';
import { Orchestrator } from '../src/orchestrator.js';
import { UnavailableCodex, UnavailableSpecialist, UnavailableValidation, SafePromptBuilder } from '../src/executors.js';
import { freezeCreationContext } from '../src/trust.js';

const interpretation = (overrides: Partial<TaskInterpretation> = {}): TaskInterpretation => ({
  intent: 'design a quantum hardware calibration workflow', requestedOutcome: 'calibration workflow',
  taskCategories: ['quantum calibration'], requiredCapabilities: ['quantum calibration'],
  excludedCapabilities: [], inputTypes: [], expectedOutputTypes: [], workflowContext: {},
  requiresCurrentInformation: false, requiresExecutableRuntime: false, ...overrides
});

test('existing built-in coverage is reused without dynamic creation', () => {
  const candidates = selectCandidates({ ...interpretation(), intent: 'review architecture security', taskCategories: ['architecture'], requiredCapabilities: ['architecture review'] });
  const decision = assessSpecialistCoverage({ ...interpretation(), taskCategories: ['architecture'], requiredCapabilities: ['architecture review'] }, candidates);
  assert.equal(decision.kind, 'EXISTING');
  assert.equal((decision as { specialistId: string }).specialistId, 'architecture-security-advisor');
});

test('collective existing coverage is recognized before creation', () => {
  const candidates = selectCandidates({ ...interpretation(), requiredCapabilities: ['python engineering', 'GitHub workflows'] }, {
    first: { ...registry['python-oracle'], id: 'first', specialistId: 'first', capabilities: ['python engineering'], primaryOwnership: ['python engineering'] },
    second: { ...registry['github-oracle'], id: 'second', specialistId: 'second', capabilities: ['GitHub workflows'], primaryOwnership: ['GitHub workflows'] }
  });
  const decision = assessSpecialistCoverage({ ...interpretation(), requiredCapabilities: ['python engineering', 'GitHub workflows'] }, candidates);
  assert.equal(decision.kind, 'ORCHESTRATE');
  assert.deepEqual(new Set((decision as { specialistIds: string[] }).specialistIds), new Set(['first', 'second']));
});

test('ambiguous intent clarifies instead of permanently creating a specialist', () => {
  const decision = assessSpecialistCoverage(interpretation({ taskCategories: [], requiredCapabilities: [], intent: 'help me with this' }), []);
  assert.equal(decision.kind, 'CLARIFY');
});

test('material capability gap creates a validated deterministic dynamic specialist', async () => {
  const store = new MemoryStore();
  const workflow = store.createWorkflow({ requestId: 'task19-gap', workflowType: 'non_code', logicalSpecialistId: null, validationRequired: false, effectiveClassification: 'PUBLIC', objective: 'quantum calibration', context: {}, requiresImplementation: false });
  const first = buildDynamicSpecialist(interpretation(), workflow.id);
  const second = buildDynamicSpecialist(interpretation(), workflow.id);
  assert.equal(first.id, second.id);
  assert.equal(first.origin, 'DYNAMIC');
  assert.equal(first.runtimeStatus, 'UNVERIFIED');
  await store.createDynamicSpecialist(first);
  await store.createDynamicSpecialist(second);
  const catalog = await store.getEffectiveSpecialists();
  validateRegistry(catalog);
  assert.equal(Object.keys(catalog).length, 26);
  assert.equal(catalog[first.id]?.creationProvenance?.sourceWorkflowId, workflow.id);
  assert.equal(resolveRoutableSpecialist(first.id, catalog)?.id, first.id);
  assert.equal(selectCandidates(interpretation(), catalog).some(candidate => candidate.specialistId === first.id), true);
});

test('dynamic specialists cannot collide with built-ins and do not receive runtime authority', async () => {
  const store = new MemoryStore();
  const forged = { ...buildDynamicSpecialist(interpretation(), 'workflow'), id: 'architecture-security-advisor', specialistId: 'architecture-security-advisor' };
  await assert.rejects(() => store.createDynamicSpecialist(forged), /DYNAMIC_SPECIALIST_COLLIDES_WITH_BUILTIN/);
  const dynamic = buildDynamicSpecialist(interpretation(), 'workflow');
  await store.createDynamicSpecialist(dynamic);
  assert.equal((await store.getEffectiveSpecialists())[dynamic.id].runtimeId, null);
});

test('catalog has no fixed 25-entry assumption', () => {
  const extras = Array.from({ length: 3 }, (_, index) => buildDynamicSpecialist(interpretation({ intent: `gap ${index}`, taskCategories: [`gap-${index}`], requiredCapabilities: [`gap-${index}`] }), `workflow-${index}`));
  const catalog = mergeSpecialistCatalog(extras);
  assert.equal(Object.keys(catalog).length, 28);
  assert.equal(new Set(Object.keys(catalog)).size, 28);
});

test('orchestrator creates and routes a material unknown capability gap', async () => {
  const store = new MemoryStore();
  const app = new Orchestrator(store, new UnavailableSpecialist(), new SafePromptBuilder(), new UnavailableCodex(), new UnavailableValidation());
  const principal = Object.freeze({ id: 'task19-user', roles: Object.freeze(['developer']), scopes: Object.freeze(['workflow:create']), authType: 'local' as const });
  const context = freezeCreationContext({ principal, operation: 'create', requestId: 'task19-orchestrator-gap', executionType: 'specialist', effectiveClassification: 'PUBLIC' });
  const workflow = await app.create({ context, workflowInput: { request_id: 'task19-orchestrator-gap', objective: 'quantum hardware calibration workflow', workflow_type: 'non_code' } });
  assert.equal(workflow.status, 'ROUTED');
  assert.match(workflow.logicalSpecialistId ?? '', /^dynamic-/);
  assert.equal((await store.getEffectiveSpecialists())[workflow.logicalSpecialistId!].runtimeStatus, 'UNVERIFIED');
});

test('dynamic creation does not bypass an explicit repository specialist allow-list', async () => {
  const store = new MemoryStore();
  const app = new Orchestrator(store, new UnavailableSpecialist(), new SafePromptBuilder(), new UnavailableCodex(), new UnavailableValidation());
  const principal = Object.freeze({ id: 'task19-policy-user', roles: Object.freeze(['developer']), scopes: Object.freeze(['workflow:create']), authType: 'local' as const });
  const context = freezeCreationContext({ principal, operation: 'create', requestId: 'task19-policy', executionType: 'specialist', effectiveClassification: 'PUBLIC' }, {
    repositoryId: 'task19-repo', source: './task19-repo', classification: 'PUBLIC', allowedCallers: ['task19-policy-user'],
    allowedExecutionTypes: ['specialist'], allowedSpecialists: ['architecture-security-advisor']
  });
  const workflow = await app.create({ context, workflowInput: { request_id: 'task19-policy', objective: 'quantum hardware calibration workflow', workflow_type: 'non_code' } });
  assert.equal(workflow.status, 'CREATED');
  assert.equal(workflow.logicalSpecialistId, null);
  assert.equal(Object.keys(await store.getEffectiveSpecialists()).length, 26);
});
