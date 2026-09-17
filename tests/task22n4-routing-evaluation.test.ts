import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadRoutingCorpus, RoutingEvaluationCase } from '../src/routing-evaluation-corpus.js';
import { compareRoutingCase, computeReleaseGates, evaluateCorpora, evaluateCorpus, formatEvaluationReport, RoutingEvaluationResult, summarizeEvaluation } from '../src/routing-evaluation.js';

const curatedPath = join(process.cwd(), 'tests/fixtures/routing-curated-corpus.json');
const holdoutPath = join(process.cwd(), 'tests/fixtures/routing-holdout-corpus.json');

const caseFor = (expected: RoutingEvaluationCase['expected']): RoutingEvaluationCase => ({schemaVersion: 1, id: 'synthetic-case', title: 'Synthetic evaluation case', request: 'Synthetic request', expected, category: 'CURATED', tags: ['synthetic']});
const actual = (routingConfidence: 'CLEAR'|'PROBABLE'|'AMBIGUOUS'|'NO_MATCH', selectedSpecialistId: string|null, requiresClarification = false) => ({routingConfidence, selectedSpecialistId, routingReason: 'synthetic', candidates: [], requiresClarification});
const result = (category: 'CURATED'|'HOLDOUT', expectedOutcome: RoutingEvaluationResult['expectedOutcome'], passed: boolean): RoutingEvaluationResult => ({caseId: `${category}-${expectedOutcome}-${passed}`, category, expectedOutcome, actualConfidence: passed ? 'CLEAR' : 'PROBABLE', actualSelectedSpecialistId: passed ? 'architecture-security-advisor' : null, passed});

test('22N4-01 SPECIFIC_SPECIALIST comparator accepts the exact owner and rejects another owner', () => {
  const item = caseFor({outcome: 'SPECIFIC_SPECIALIST', specialistId: 'architecture-security-advisor', confidence: 'CLEAR'});
  assert.equal(compareRoutingCase(item, actual('CLEAR', 'architecture-security-advisor')).passed, true);
  const failed = compareRoutingCase(item, actual('CLEAR', 'other-specialist'));
  assert.equal(failed.passed, false);
  assert.match(failed.mismatch!, /selected specialist/);
});

test('22N4-02 APPROVED_EQUIVALENT_SET comparator accepts members and rejects outsiders', () => {
  const item = caseFor({outcome: 'APPROVED_EQUIVALENT_SET', specialistIds: ['architecture-security-advisor', 'other-specialist'], confidence: 'PROBABLE'});
  assert.equal(compareRoutingCase(item, actual('PROBABLE', 'architecture-security-advisor')).passed, true);
  assert.equal(compareRoutingCase(item, actual('PROBABLE', 'unapproved-specialist')).passed, false);
});

test('22N4-03 AMBIGUOUS comparator requires clarification without an automatic route', () => {
  const item = caseFor({outcome: 'AMBIGUOUS', confidence: 'AMBIGUOUS', clarificationRequired: true});
  assert.equal(compareRoutingCase(item, actual('AMBIGUOUS', null, true)).passed, true);
  assert.equal(compareRoutingCase(item, actual('AMBIGUOUS', 'architecture-security-advisor', true)).passed, false);
});

test('22N4-04 NO_MATCH comparator accepts no route and rejects forced routing', () => {
  const item = caseFor({outcome: 'NO_MATCH', confidence: 'NO_MATCH'});
  assert.equal(compareRoutingCase(item, actual('NO_MATCH', null)).passed, true);
  assert.equal(compareRoutingCase(item, actual('PROBABLE', 'architecture-security-advisor')).passed, false);
});

test('22N4-05 explicit confidence mismatch fails an otherwise selected owner', () => {
  const item = caseFor({outcome: 'SPECIFIC_SPECIALIST', specialistId: 'architecture-security-advisor', confidence: 'CLEAR'});
  const failed = compareRoutingCase(item, actual('PROBABLE', 'architecture-security-advisor'));
  assert.equal(failed.passed, false);
  assert.match(failed.mismatch!, /confidence expected CLEAR/);
});

test('22N4-06 curated hard gate fails on one failed evaluated case', () => {
  const curated = summarizeEvaluation([result('CURATED', 'SPECIFIC_SPECIALIST', true), result('CURATED', 'NO_MATCH', false)]);
  const holdout = summarizeEvaluation([result('HOLDOUT', 'SPECIFIC_SPECIALIST', true), result('HOLDOUT', 'NO_MATCH', true)]);
  assert.equal(computeReleaseGates(curated, holdout).curatedRoutingGate, 'FAIL');
});

test('22N4-07 missing semantic classes report NOT_EVALUATED_NO_CASES', () => {
  const empty = summarizeEvaluation([]);
  const gates = computeReleaseGates(empty, empty);
  assert.equal(gates.curatedRoutingGate, 'NOT_EVALUATED_NO_CASES');
  assert.equal(gates.holdoutClearGate, 'NOT_EVALUATED_NO_CASES');
  assert.equal(gates.holdoutNoMatchGate, 'NOT_EVALUATED_NO_CASES');
  assert.equal(gates.curatedCoverageStatus, 'LIMITED');
});

test('22N4-08 holdout CLEAR gate requires 95 percent without rounding 5/6 upward', () => {
  const sixPass = summarizeEvaluation(Array.from({length: 6}, () => result('HOLDOUT', 'SPECIFIC_SPECIALIST', true)));
  const fivePass = summarizeEvaluation([...Array.from({length: 5}, () => result('HOLDOUT', 'SPECIFIC_SPECIALIST', true)), result('HOLDOUT', 'SPECIFIC_SPECIALIST', false)]);
  const emptyCurated = summarizeEvaluation([]);
  assert.equal(computeReleaseGates(emptyCurated, sixPass).holdoutClearGate, 'PASS');
  assert.equal(computeReleaseGates(emptyCurated, fivePass).holdoutClearGate, 'FAIL');
});

test('22N4-09 one forced NO_MATCH route fails the holdout NO_MATCH gate', () => {
  const holdout = summarizeEvaluation([result('HOLDOUT', 'NO_MATCH', true), result('HOLDOUT', 'NO_MATCH', false)]);
  assert.equal(computeReleaseGates(summarizeEvaluation([]), holdout).holdoutNoMatchGate, 'FAIL');
});

test('22N4-10 real curated corpus evaluates through the production routing seam', async () => {
  const curated = await loadRoutingCorpus(curatedPath);
  const summary = await evaluateCorpus(curated);
  assert.equal(summary.total, 12);
  assert.equal(summary.byOutcome.SPECIFIC_SPECIALIST.total, 6);
  assert.equal(summary.byOutcome.NO_MATCH.total, 6);
  assert.equal(summary.results.some(item => item.caseId === 'clear-architecture-review'), true);
});

test('22N4-11 real holdout corpus evaluates through the production routing seam', async () => {
  const holdout = await loadRoutingCorpus(holdoutPath);
  const summary = await evaluateCorpus(holdout);
  assert.equal(summary.total, 12);
  assert.equal(summary.byOutcome.SPECIFIC_SPECIALIST.total, 6);
  assert.equal(summary.byOutcome.NO_MATCH.total, 6);
  assert.equal(summary.results.some(item => item.caseId === 'holdout-001'), true);
});

test('22N4-12 evaluation uses no persistence or execution boundary', async () => {
  const curated = await loadRoutingCorpus(curatedPath);
  const holdout = await loadRoutingCorpus(holdoutPath);
  const report = await evaluateCorpora(curated, holdout);
  assert.equal(report.curated.total, 12);
  assert.equal(report.holdout.total, 12);
  assert.equal(report.curated.results.every(item => item.actualSelectedSpecialistId === null || typeof item.actualSelectedSpecialistId === 'string'), true);
});

test('22N4-13 release command semantics expose a non-zero-quality result without changing corpus data', () => {
  const failed = computeReleaseGates(summarizeEvaluation([result('CURATED', 'NO_MATCH', false)]), summarizeEvaluation([]));
  assert.equal(failed.routingQualityGate, 'FAIL');
  assert.match(formatEvaluationReport({curated: summarizeEvaluation([result('CURATED', 'NO_MATCH', false)]), holdout: summarizeEvaluation([]), gates: failed}), /ROUTING_QUALITY_GATE=FAIL/);
});

test('22N4-14 current real corpus reports limited four-state coverage', async () => {
  const curated = await loadRoutingCorpus(curatedPath);
  const holdout = await loadRoutingCorpus(holdoutPath);
  const report = await evaluateCorpora(curated, holdout);
  assert.equal(report.gates.fullFourStateCoverage, 'NO');
  assert.equal(report.gates.curatedCoverageStatus, 'LIMITED');
  assert.equal(report.gates.holdoutCoverageStatus, 'LIMITED');
});
