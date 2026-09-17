import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadRoutingCorpus } from '../src/routing-evaluation-corpus.js';
import { DeterministicRequestInterpreter, interpretAndSelect, resolveRouting } from '../src/routing.js';
import { evaluateCorpus } from '../src/routing-evaluation.js';
import { collectRoutingMetrics } from '../src/routing-execution-metrics.js';
import { registry } from '../src/registry.js';

const curatedPath = join(process.cwd(), 'tests/fixtures/routing-curated-corpus.json');

async function route(request: string) {
  const interpreted = await interpretAndSelect(new DeterministicRequestInterpreter(), {request});
  return resolveRouting(interpreted.candidates);
}

test('22R-01 target curated request routes to the approved specialist with CLEAR confidence', async () => {
  const corpus = await loadRoutingCorpus(curatedPath);
  const item = corpus.cases.find(item => item.id === 'clear-architecture-risk-review')!;
  const result = await route(item.request);
  assert.equal(result.selectedSpecialistId, 'architecture-security-advisor');
  assert.equal(result.routingConfidence, 'CLEAR');
});

test('22R-02 routing has no corpus case-ID input or special-case path', async () => {
  const a = await route('Identify the highest-risk architectural decisions in this proposal and explain how to reduce them.');
  const b = await route('Identify the highest-risk architectural decisions in this proposal and explain how to reduce them.');
  assert.deepEqual(b, a);
  assert.equal(DeterministicRequestInterpreter.prototype.interpretRequest.length, 1);
});

test('22R-03 related architectural risk-review wording generalizes the approved capability', async () => {
  const result = await route('Assess the architectural risk profile of this service boundary and recommend mitigations before implementation.');
  assert.equal(result.selectedSpecialistId, 'architecture-security-advisor');
  assert.equal(result.routingConfidence, 'CLEAR');
});

test('22R-04 all curated CLEAR cases remain correct', async () => {
  const corpus = await loadRoutingCorpus(curatedPath);
  const clear = corpus.cases.filter(item => item.expected.confidence === 'CLEAR');
  const results = await evaluateCorpus({schemaVersion:1,cases:clear});
  assert.equal(results.total, 6);
  assert.equal(results.passed, 6);
  assert.equal(results.failed, 0);
});

test('22R-05 all curated NO_MATCH cases remain unrouted', async () => {
  const corpus = await loadRoutingCorpus(curatedPath);
  const noMatch = corpus.cases.filter(item => item.expected.outcome === 'NO_MATCH');
  const results = await evaluateCorpus({schemaVersion:1,cases:noMatch});
  assert.equal(results.total, 6);
  assert.equal(results.passed, 6);
  assert.equal(results.failed, 0);
  assert.equal(results.results.filter(item => item.actualSelectedSpecialistId !== null).length, 0);
});

test('22R-06 curated adversarial-similarity NO_MATCH cases remain safe', async () => {
  const corpus = await loadRoutingCorpus(curatedPath);
  const cases = corpus.cases.filter(item => item.tags.includes('adversarial-similarity'));
  const results = await evaluateCorpus({schemaVersion:1,cases});
  assert.equal(results.total, 3);
  assert.equal(results.passed, 3);
});

test('22R-07 unrelated technical implementation remains NO_MATCH', async () => {
  const result = await route('Implement the caching layer and write the production code for the database adapter.');
  assert.equal(result.selectedSpecialistId, null);
  assert.equal(result.routingConfidence, 'NO_MATCH');
});

test('22R-08 normalization does not globally promote non-owned requests to CLEAR', async () => {
  const result = await route('Translate an employee handbook from Spanish into English while preserving its tone.');
  assert.equal(result.selectedSpecialistId, null);
  assert.equal(result.routingConfidence, 'NO_MATCH');
});

test('22R-09 curated metrics calculate zero failures after the repair', async () => {
  const corpus = await loadRoutingCorpus(curatedPath);
  const summary = await evaluateCorpus(corpus);
  const metrics = collectRoutingMetrics(summary.results, 'CURATED');
  assert.equal(metrics.failedCases, 0);
  assert.equal(metrics.missedExpectedRouteCount, 0);
  assert.equal(metrics.wrongAutomaticRouteCount, 0);
  assert.equal(metrics.noMatchForcedRouteViolationCount, 0);
});

test('22R-10 routing evaluation remains pure and does not touch registry or execution state', async () => {
  const before = JSON.stringify(registry);
  const corpus = await loadRoutingCorpus(curatedPath);
  await evaluateCorpus(corpus);
  assert.equal(JSON.stringify(registry), before);
});
