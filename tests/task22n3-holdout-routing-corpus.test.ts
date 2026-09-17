import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadRoutingCorpus, RoutingEvaluationCorpus } from '../src/routing-evaluation-corpus.js';
import { registry } from '../src/registry.js';

const curatedPath = join(process.cwd(), 'tests/fixtures/routing-curated-corpus.json');
const holdoutPath = join(process.cwd(), 'tests/fixtures/routing-holdout-corpus.json');

type HoldoutSummary = {
  total: number;
  clear: number;
  probable: number;
  ambiguous: number;
  noMatch: number;
  casesPerSpecialist: Record<string, number>;
  adversarialSimilarity: number;
};

function normalizeRequest(request: string): string { return request.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US'); }

function summarize(corpus: RoutingEvaluationCorpus): HoldoutSummary {
  const summary: HoldoutSummary = {total: corpus.cases.length, clear: 0, probable: 0, ambiguous: 0, noMatch: 0, casesPerSpecialist: {}, adversarialSimilarity: 0};
  for (const item of corpus.cases) {
    if (item.expected.confidence === 'CLEAR') summary.clear++;
    if (item.expected.confidence === 'PROBABLE') summary.probable++;
    if (item.expected.outcome === 'AMBIGUOUS') summary.ambiguous++;
    if (item.expected.outcome === 'NO_MATCH') summary.noMatch++;
    if (item.tags.includes('adversarial-similarity')) summary.adversarialSimilarity++;
    const ids = item.expected.outcome === 'SPECIFIC_SPECIALIST' ? [item.expected.specialistId] : item.expected.outcome === 'APPROVED_EQUIVALENT_SET' ? item.expected.specialistIds : [];
    for (const id of ids) summary.casesPerSpecialist[id] = (summary.casesPerSpecialist[id] ?? 0) + 1;
  }
  return summary;
}

async function corpora(): Promise<{curated: RoutingEvaluationCorpus; holdout: RoutingEvaluationCorpus}> {
  return {curated: await loadRoutingCorpus(curatedPath), holdout: await loadRoutingCorpus(holdoutPath)};
}

test('22N3-01 authoritative holdout corpus loads through Task 22N1 infrastructure', async () => {
  const {holdout} = await corpora();
  assert.equal(holdout.schemaVersion, 1);
  assert.ok(holdout.cases.length >= 12);
});

test('22N3-02 every holdout case is categorized HOLDOUT', async () => {
  const {holdout} = await corpora();
  assert.ok(holdout.cases.every(item => item.category === 'HOLDOUT'));
  assert.equal(holdout.cases.some(item => item.category === 'CURATED'), false);
});

test('22N3-03 holdout IDs are unique', async () => {
  const {holdout} = await corpora();
  const ids = holdout.cases.map(item => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, [...ids].sort((a, b) => a.localeCompare(b)));
});

test('22N3-04 holdout IDs do not collide with curated IDs', async () => {
  const {curated, holdout} = await corpora();
  const curatedIds = new Set(curated.cases.map(item => item.id));
  assert.equal(holdout.cases.some(item => curatedIds.has(item.id)), false);
});

test('22N3-05 holdout requests do not duplicate curated requests exactly or after normalization', async () => {
  const {curated, holdout} = await corpora();
  const exact = new Set(curated.cases.map(item => item.request));
  const normalized = new Set(curated.cases.map(item => normalizeRequest(item.request)));
  assert.equal(holdout.cases.some(item => exact.has(item.request)), false);
  assert.equal(holdout.cases.some(item => normalized.has(normalizeRequest(item.request))), false);
});

test('22N3-06 every holdout expected specialist validates against the canonical registry', async () => {
  const {holdout} = await corpora();
  for (const item of holdout.cases) {
    const ids = item.expected.outcome === 'SPECIFIC_SPECIALIST' ? [item.expected.specialistId] : item.expected.outcome === 'APPROVED_EQUIVALENT_SET' ? item.expected.specialistIds : [];
    for (const id of ids) assert.equal(registry[id]?.status, 'ACTIVE', `${item.id} expected ${id}`);
  }
});

test('22N3-07 holdout has independent clear ownership coverage', async () => {
  const {holdout} = await corpora();
  const clear = holdout.cases.filter(item => item.expected.confidence === 'CLEAR');
  assert.ok(clear.length >= 6);
  assert.ok(clear.every(item => item.expected.outcome === 'SPECIFIC_SPECIALIST' && item.expected.specialistId === 'architecture-security-advisor'));
});

test('22N3-08 holdout has realistic no-match coverage with no selected specialist', async () => {
  const {holdout} = await corpora();
  const noMatch = holdout.cases.filter(item => item.expected.outcome === 'NO_MATCH');
  assert.ok(noMatch.length >= 6);
  assert.ok(noMatch.every(item => item.expected.confidence === 'NO_MATCH'));
});

test('22N3-09 holdout contains adversarially similar but unowned technical requests', async () => {
  const {holdout} = await corpora();
  const adversarial = holdout.cases.filter(item => item.tags.includes('adversarial-similarity'));
  assert.ok(adversarial.length >= 2);
  assert.ok(adversarial.every(item => item.expected.outcome === 'NO_MATCH'));
});

test('22N3-10 unsupported PROBABLE and AMBIGUOUS classes are not fabricated', async () => {
  const {holdout} = await corpora();
  const activeOwners = Object.values(registry).filter(item => item.status === 'ACTIVE');
  const hasOverlap = activeOwners.some(item => item.overlapsWith.length > 0);
  assert.equal(activeOwners.length, 1);
  assert.equal(hasOverlap, false);
  assert.equal(holdout.cases.some(item => item.expected.confidence === 'PROBABLE'), false);
  assert.equal(holdout.cases.some(item => item.expected.outcome === 'AMBIGUOUS'), false);
});

test('22N3-11 holdout summary is deterministic and content-only', async () => {
  const {holdout} = await corpora();
  const first = summarize(holdout);
  const second = summarize(holdout);
  assert.deepEqual(first, second);
  assert.deepEqual(first, {total: 12, clear: 6, probable: 0, ambiguous: 0, noMatch: 6, casesPerSpecialist: {'architecture-security-advisor': 6}, adversarialSimilarity: 2});
});

test('22N3-12 holdout load, validation, and summary have no routing side effects', async () => {
  const before = JSON.stringify(registry);
  const {holdout} = await corpora();
  summarize(holdout);
  assert.equal(JSON.stringify(registry), before);
  assert.equal(holdout.cases.every(item => item.category === 'HOLDOUT'), true);
});
