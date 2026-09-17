import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { registry, resolveRoutableSpecialist, validateRegistry } from '../src/registry.js';
import { DeterministicRequestInterpreter, interpretAndSelect, persistResolvedRouting, validateCanonicalRoutingResolution } from '../src/routing.js';
import { loadRoutingCorpus } from '../src/routing-evaluation-corpus.js';
import { MemoryStore } from '../src/store.js';
import type { RoutingResolution, SelectedCandidate } from '../src/domain.js';

const routableIds = () => Object.values(registry)
  .filter(specialist => specialist.routingApproved !== false && specialist.role !== 'ORCHESTRATOR' && specialist.role !== 'UNKNOWN_PENDING_REVIEW' && specialist.status === 'ACTIVE')
  .map(specialist => specialist.id);

function candidate(specialistId: string): SelectedCandidate {
  const specialist = resolveRoutableSpecialist(specialistId);
  assert.ok(specialist);
  return {
    specialistId,
    rank: 1,
    matchReason: 'canonical test evidence',
    evidence: {
      specialistId,
      registryVersion: specialist.registryVersion,
      ownershipMatches: ['test'],
      capabilityMatches: [],
      workflowRelationship: 'none',
      exclusionResult: 'eligible',
      specificity: 1,
      runtimeStatus: specialist.runtimeStatus,
      matchReason: 'canonical test evidence'
    }
  };
}

test('06-01 every canonical routable specialist resolves to its own registry entry', () => {
  for (const id of routableIds()) {
    const resolved = resolveRoutableSpecialist(id);
    assert.equal(resolved, registry[id]);
    assert.equal(resolved?.specialistId, id);
  }
});

test('06-02 routing candidates from both evaluation corpora are canonical', async () => {
  const interpreter = new DeterministicRequestInterpreter();
  for (const file of ['routing-curated-corpus.json', 'routing-holdout-corpus.json']) {
    const corpus = await loadRoutingCorpus(join(process.cwd(), 'tests/fixtures', file));
    for (const item of corpus.cases) {
      const result = await interpretAndSelect(interpreter, { request: item.request });
      for (const selected of result.candidates) {
        assert.equal(resolveRoutableSpecialist(selected.specialistId)?.specialistId, selected.specialistId, `${file}:${item.id}`);
      }
    }
  }
});

test('06-03 unknown, stale, and non-routable identities fail closed', () => {
  assert.equal(resolveRoutableSpecialist('does-not-exist'), undefined);
  assert.equal(resolveRoutableSpecialist('architecture_security_advisor'), undefined);
  assert.equal(resolveRoutableSpecialist('gpt-command-center'), undefined);
  assert.equal(resolveRoutableSpecialist('treasure-hunter'), undefined);

  const resolution: RoutingResolution = {
    routingConfidence: 'CLEAR', selectedSpecialistId: 'forged-specialist', routingReason: 'forged',
    candidates: [{ ...candidate('architecture-security-advisor'), specialistId: 'forged-specialist', evidence: { ...candidate('architecture-security-advisor').evidence, specialistId: 'forged-specialist' } }],
    requiresClarification: false
  };
  assert.throws(() => validateCanonicalRoutingResolution(resolution), /INVALID_ROUTING_TARGET/);
});

test('06-04 persisted routing validates candidates before any specialist-specific state is used', async () => {
  const store = new MemoryStore();
  const workflow = store.createWorkflow({ requestId: 'task06-invalid', workflowType: 'non_code', logicalSpecialistId: null, runtimeId: undefined, validationRequired: false, effectiveClassification: 'PUBLIC', objective: 'test', context: {}, requiresImplementation: false });
  const forged = candidate('architecture-security-advisor');
  forged.specialistId = 'ad-hoc-specialist';
  forged.evidence.specialistId = 'ad-hoc-specialist';
  await assert.rejects(() => persistResolvedRouting(store, workflow.id, {
    routingConfidence: 'CLEAR', selectedSpecialistId: 'ad-hoc-specialist', routingReason: 'forged', candidates: [forged], requiresClarification: false
  }), /INVALID_ROUTING_TARGET/);
  assert.equal((await store.getRoutingHistory(workflow.id)).length, 0);
  assert.equal(workflow.status, 'CREATED');
});

test('06-05 registry drift is detected by the registry-driven proof', () => {
  const removed = registry['architecture-security-advisor'];
  const staleCandidate = candidate('architecture-security-advisor');
  delete registry['architecture-security-advisor'];
  try {
    assert.equal(resolveRoutableSpecialist('architecture-security-advisor'), undefined);
    assert.throws(() => validateCanonicalRoutingResolution({
      routingConfidence: 'CLEAR', selectedSpecialistId: 'architecture-security-advisor', routingReason: 'stale',
      candidates: [staleCandidate], requiresClarification: false
    }), /INVALID_ROUTING_TARGET/);
  } finally {
    registry['architecture-security-advisor'] = removed;
    validateRegistry(registry);
  }
});

test('06-06 no configured fallback silently selects a specialist', async () => {
  const store = new MemoryStore();
  const workflow = store.createWorkflow({ requestId: 'task06-no-match', workflowType: 'non_code', logicalSpecialistId: null, runtimeId: undefined, validationRequired: false, effectiveClassification: 'PUBLIC', objective: 'test', context: {}, requiresImplementation: false });
  const result = await persistResolvedRouting(store, workflow.id, { routingConfidence: 'NO_MATCH', selectedSpecialistId: null, routingReason: 'no match', candidates: [], requiresClarification: false });
  assert.equal(result.workflow.logicalSpecialistId, null);
  assert.equal(result.workflow.status, 'CREATED');
});
