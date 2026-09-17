import test from 'node:test';
import assert from 'node:assert/strict';
import { SPECIALIST_ROLES } from '../src/domain.js';
import { registry, validateRegistry } from '../src/registry.js';
import { DeterministicRequestInterpreter, interpretAndSelect } from '../src/routing.js';
import { readSpecialist } from '../src/specialist-read-model.js';
import { reconcileRegistry } from '../src/registry-reconciliation.js';

const expectedIds = [
  'gpt-command-center', 'node-link-graph-architect', 'resume-gatekeeper',
  'tuner-pro-oracle', 'business-idea-validator', 'logic-machine',
  'architecture-security-advisor', 'project-folder-forge', 'github-oracle',
  'python-oracle', 'military-job-school-finder', 'windows-senior-support-engineer',
  'senior-software-project-manager', 'everyday-nutritionist', 'csharp-quant-engine',
  'local-ai-qa-repair-lab', 'product-definition-forge', 'mvp-forge', 'travel-agent',
  'vehicle-repair-assistant', 'gpt-builder', 'codex-prompt-builder',
  'treasure-hunter', 'policy-document-reviewer', 'equipment-repair-assistant'
];

const route = async (request: string) => {
  const result = await interpretAndSelect(new DeterministicRequestInterpreter(), { request });
  return result.candidates.map(candidate => candidate.specialistId);
};

test('04-01 canonical registry contains exactly the documented 25 identities and role counts', () => {
  assert.deepEqual(Object.keys(registry), expectedIds);
  assert.equal(new Set(Object.keys(registry)).size, 25);
  assert.deepEqual(SPECIALIST_ROLES, ['ORCHESTRATOR','ROUTABLE_SPECIALIST','BUILDER_OR_WORKFLOW_UTILITY','UNKNOWN_PENDING_REVIEW']);
  const counts = Object.values(registry).reduce<Record<string, number>>((result, specialist) => {
    result[specialist.role!] = (result[specialist.role!] ?? 0) + 1;
    return result;
  }, {});
  assert.deepEqual(counts, { ORCHESTRATOR: 1, ROUTABLE_SPECIALIST: 20, BUILDER_OR_WORKFLOW_UTILITY: 3, UNKNOWN_PENDING_REVIEW: 1 });
  validateRegistry(registry);
});

test('04-02 orchestrator and pending specialist are not generic routing targets', async () => {
  assert.equal(registry['gpt-command-center'].routingApproved, false);
  assert.equal(registry['gpt-command-center'].role, 'ORCHESTRATOR');
  assert.equal(registry['treasure-hunter'].routingApproved, false);
  assert.equal(registry['treasure-hunter'].status, 'INACTIVE');
  assert.equal((await route('Use GPT Command Center as a general fallback for this task')).includes('gpt-command-center'), false);
  assert.equal((await route('Find the hidden treasure in this request')).includes('treasure-hunter'), false);
});

test('04-03 builder utilities are explicit destinations but not generic fallbacks', async () => {
  assert.deepEqual(await route('Build and configure a new GPT'), ['gpt-builder']);
  assert.deepEqual(await route('Set up the ChatGPT project folder structure'), ['project-folder-forge']);
  assert.deepEqual(await route('Prepare the implementation prompt for Codex'), ['codex-prompt-builder']);
  assert.equal((await route('Handle this unrelated task')).includes('gpt-builder'), false);
});

test('04-04 architecture ownership and Task 22R normalization remain intact', async () => {
  assert.deepEqual(await route('Review the architecture of this service'), ['architecture-security-advisor']);
  assert.deepEqual(await route('Assess the architectural risks in this design'), ['architecture-security-advisor']);
  assert.equal(registry['architecture-security-advisor'].runtimeId, 'architecture-security-advisor-api');
  assert.equal(registry['architecture-security-advisor'].canValidateCodex, true);
});

test('04-05 new canonical entries have no fabricated executable runtime', () => {
  for (const specialist of Object.values(registry).filter(x => x.specialistId !== 'architecture-security-advisor')) {
    assert.equal(specialist.runtimeStatus, 'UNVERIFIED');
    assert.equal(specialist.runtimeId, null);
    assert.equal(specialist.runtime, undefined);
    assert.equal(readSpecialist(specialist).runtime.executable, false);
  }
  const architecture = readSpecialist(registry['architecture-security-advisor']);
  assert.equal(architecture.runtime.status, registry['architecture-security-advisor'].runtimeStatus);
});

test('04-06 discovery does not grant approval or runtime authority', () => {
  const result = reconcileRegistry(registry, {
    status: 'AVAILABLE', source: 'test', observedAt: '2026-09-17T00:00:00.000Z',
    specialists: [{ specialistId: 'discovered-new', displayName: 'Discovered New', chatgptUrl: 'https://chatgpt.com/g/new' }]
  });
  const discovered = result.outcomes.find(outcome => outcome.status === 'NEW_UNREVIEWED');
  assert.ok(discovered);
  assert.equal(discovered!.routable, false);
  assert.equal(discovered!.runtime, 'UNVERIFIED');
  assert.equal(discovered!.reviewRequired, true);
  assert.equal(result.approvedRegistryChanged, false);
});

test('04-07 registry validation rejects invalid role and approval combinations', () => {
  const orchestrator = structuredClone(registry);
  orchestrator['gpt-command-center'].routingApproved = true;
  assert.throws(() => validateRegistry(orchestrator), /ORCHESTRATOR_CANNOT_BE_ROUTING_APPROVED/);

  const pending = structuredClone(registry);
  pending['treasure-hunter'].routingApproved = true;
  assert.throws(() => validateRegistry(pending), /PENDING_SPECIALIST_CANNOT_BE_ROUTING_APPROVED/);

  const duplicate = structuredClone(registry);
  duplicate.copy = { ...duplicate['architecture-security-advisor'], id: 'architecture-security-advisor' };
  assert.throws(() => validateRegistry(duplicate), /DUPLICATE_SPECIALIST_ID/);
});
