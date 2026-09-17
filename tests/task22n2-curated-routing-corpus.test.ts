import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadRoutingCorpus, RoutingEvaluationCase, RoutingEvaluationCorpus } from '../src/routing-evaluation-corpus.js';
import { registry } from '../src/registry.js';

const corpusPath = join(process.cwd(), 'tests/fixtures/routing-curated-corpus.json');

type CorpusSummary = {
  total: number;
  clear: number;
  probable: number;
  ambiguous: number;
  noMatch: number;
  casesPerSpecialist: Record<string, number>;
  exclusion: number;
  overlap: number;
};

function summarize(corpus: RoutingEvaluationCorpus): CorpusSummary {
  const summary: CorpusSummary = {total: corpus.cases.length, clear: 0, probable: 0, ambiguous: 0, noMatch: 0, casesPerSpecialist: {}, exclusion: 0, overlap: 0};
  for (const item of corpus.cases) {
    if (item.expected.confidence === 'CLEAR') summary.clear++;
    if (item.expected.confidence === 'PROBABLE') summary.probable++;
    if (item.expected.outcome === 'AMBIGUOUS') summary.ambiguous++;
    if (item.expected.outcome === 'NO_MATCH') summary.noMatch++;
    if (item.tags.includes('exclusion')) summary.exclusion++;
    if (item.tags.includes('overlap')) summary.overlap++;
    const ids = item.expected.outcome === 'SPECIFIC_SPECIALIST' ? [item.expected.specialistId] : item.expected.outcome === 'APPROVED_EQUIVALENT_SET' ? item.expected.specialistIds : [];
    for (const id of ids) summary.casesPerSpecialist[id] = (summary.casesPerSpecialist[id] ?? 0) + 1;
  }
  return summary;
}

async function curatedCorpus(): Promise<RoutingEvaluationCorpus> { return loadRoutingCorpus(corpusPath); }

test('22N2-01 authoritative curated corpus loads through Task 22N1 infrastructure', async () => {
  const corpus = await curatedCorpus();
  assert.ok(corpus.cases.length > 0);
  assert.equal(corpus.schemaVersion, 1);
});

test('22N2-02 all authoritative corpus cases are CURATED', async () => {
  const corpus = await curatedCorpus();
  assert.ok(corpus.cases.every(item => item.category === 'CURATED'));
  assert.equal(corpus.cases.some(item => item.category === 'HOLDOUT'), false);
});

test('22N2-03 authoritative curated IDs are unique and deterministically ordered', async () => {
  const corpus = await curatedCorpus();
  const ids = corpus.cases.map(item => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, [...ids].sort((a, b) => a.localeCompare(b)));
});

test('22N2-04 every expected specialist validates against the canonical registry', async () => {
  const corpus = await curatedCorpus();
  for (const item of corpus.cases) {
    const ids = item.expected.outcome === 'SPECIFIC_SPECIALIST' ? [item.expected.specialistId] : item.expected.outcome === 'APPROVED_EQUIVALENT_SET' ? item.expected.specialistIds : [];
    for (const id of ids) assert.equal(registry[id]?.status, 'ACTIVE', `${item.id} expected ${id}`);
  }
});

test('22N2-05 clear coverage meets the registry-supported maximum', async () => {
  const summary = summarize(await curatedCorpus());
  assert.ok(summary.clear >= 6);
  assert.equal(summary.casesPerSpecialist['architecture-security-advisor'], 6);
});

test('22N2-06 probable cases, when supported, retain explicit expected ownership', async () => {
  const corpus = await curatedCorpus();
  for (const item of corpus.cases.filter(item => item.expected.confidence === 'PROBABLE')) {
    assert.ok(item.expected.outcome === 'SPECIFIC_SPECIALIST' || item.expected.outcome === 'APPROVED_EQUIVALENT_SET');
  }
  assert.equal(corpus.cases.filter(item => item.expected.confidence === 'PROBABLE').length, 0);
});

test('22N2-07 ambiguous cases, when supported, require no automatic specialist', async () => {
  const corpus = await curatedCorpus();
  for (const item of corpus.cases.filter(item => item.expected.outcome === 'AMBIGUOUS')) {
    assert.equal(item.expected.confidence, 'AMBIGUOUS');
  }
  assert.equal(corpus.cases.filter(item => item.expected.outcome === 'AMBIGUOUS').length, 0);
});

test('22N2-08 no-match cases require no selected specialist', async () => {
  const corpus = await curatedCorpus();
  const noMatch = corpus.cases.filter(item => item.expected.outcome === 'NO_MATCH');
  assert.ok(noMatch.length >= 6);
  assert.ok(noMatch.every(item => item.expected.confidence === 'NO_MATCH'));
});

test('22N2-09 exclusion and overlap coverage follows actual registry semantics', async () => {
  const corpus = await curatedCorpus();
  const hasExclusions = Object.values(registry).some(item => item.exclusions.length > 0);
  const hasOverlaps = Object.values(registry).some(item => item.overlapsWith.length > 0);
  if (hasExclusions) assert.ok(corpus.cases.some(item => item.tags.includes('exclusion')));
  else assert.equal(corpus.cases.some(item => item.tags.includes('exclusion')), false);
  if (hasOverlaps) assert.ok(corpus.cases.some(item => item.tags.includes('overlap')));
  else assert.equal(corpus.cases.some(item => item.tags.includes('overlap')), false);
});

test('22N2-10 corpus content summary is deterministic', async () => {
  const first = summarize(await curatedCorpus());
  const second = summarize(await curatedCorpus());
  assert.deepEqual(first, second);
  assert.deepEqual(first, {total: 12, clear: 6, probable: 0, ambiguous: 0, noMatch: 6, casesPerSpecialist: {'architecture-security-advisor': 6}, exclusion: 0, overlap: 0});
});

test('22N2-11 corpus load, validation, and summary have no routing side effects', async () => {
  const before = JSON.stringify(registry);
  const corpus = await curatedCorpus();
  summarize(corpus);
  assert.equal(JSON.stringify(registry), before);
  assert.equal(corpus.cases.every((item: RoutingEvaluationCase) => item.category === 'CURATED'), true);
});
