import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadRoutingCorpus } from '../src/routing-evaluation-corpus.js';
import { computeReleaseGates, evaluateCorpora, RoutingEvaluationResult, summarizeEvaluation } from '../src/routing-evaluation.js';
import { collectExecutionTruthMetrics, collectRoutingMetrics } from '../src/routing-execution-metrics.js';
import { buildRoutingReleaseReport, releaseReportExitCode, renderRoutingReleaseReport, serializeRoutingReleaseReport } from '../src/routing-release-report.js';
import { registry } from '../src/registry.js';

const curatedPath = join(process.cwd(), 'tests/fixtures/routing-curated-corpus.json');
const holdoutPath = join(process.cwd(), 'tests/fixtures/routing-holdout-corpus.json');
const result = (category: 'CURATED'|'HOLDOUT', outcome: RoutingEvaluationResult['expectedOutcome'], passed: boolean, selected: string|null, confidence: 'CLEAR'|'PROBABLE'|'AMBIGUOUS'|'NO_MATCH', expectedConfidence: 'CLEAR'|'PROBABLE'|'AMBIGUOUS'|'NO_MATCH' = confidence): RoutingEvaluationResult => ({caseId: `${category}-${outcome}-${selected ?? 'none'}-${confidence}`, category, expectedOutcome: outcome, expectedConfidence, ...(outcome === 'SPECIFIC_SPECIALIST' ? {expectedSpecialistId: 'architecture-security-advisor'} : outcome === 'APPROVED_EQUIVALENT_SET' ? {expectedSpecialistIds: ['architecture-security-advisor', 'other']} : {}), actualConfidence: confidence, actualSelectedSpecialistId: selected, passed});
const reportFrom = (curatedResults: RoutingEvaluationResult[], holdoutResults: RoutingEvaluationResult[], execution = collectExecutionTruthMetrics([{workflowId: 'observed', workflowStatus: 'ROUTED', executionStarted: false, executionCompleted: false, attempts: []}])) => {
  const curated = summarizeEvaluation(curatedResults);
  const holdout = summarizeEvaluation(holdoutResults);
  const evaluation = {curated, holdout, gates: computeReleaseGates(curated, holdout)};
  return buildRoutingReleaseReport(evaluation, collectRoutingMetrics(curatedResults, 'CURATED'), collectRoutingMetrics(holdoutResults, 'HOLDOUT'), execution);
};

test('22O2-01 report assembles from existing evaluation, metric, and execution snapshots', () => {
  const report = reportFrom([result('CURATED', 'NO_MATCH', true, null, 'NO_MATCH')], [result('HOLDOUT', 'NO_MATCH', true, null, 'NO_MATCH')]);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.routingMetrics.curated.totalEvaluatedCases, 1);
  assert.equal(report.executionTruth.workflowsInspected, 1);
});

test('22O2-02 routing failure remains visible independently of implementation validation', () => {
  const report = reportFrom([result('CURATED', 'SPECIFIC_SPECIALIST', false, null, 'NO_MATCH', 'CLEAR')], [result('HOLDOUT', 'NO_MATCH', true, null, 'NO_MATCH')]);
  assert.equal(report.implementationValidation, 'PASS');
  assert.equal(report.routingQuality.routingQualityGate, 'FAIL');
  assert.equal(report.releaseReadiness, 'FAIL');
});

test('22O2-03 missed expected route is reported distinctly', () => {
  const report = reportFrom([result('CURATED', 'SPECIFIC_SPECIALIST', false, null, 'NO_MATCH', 'CLEAR')], []);
  assert.equal(report.knownFailures[0].classification, 'MISSED_EXPECTED_ROUTE');
});

test('22O2-04 wrong automatic route is reported distinctly', () => {
  const failed = result('CURATED', 'SPECIFIC_SPECIALIST', false, 'wrong-specialist', 'CLEAR');
  const report = reportFrom([failed], []);
  assert.equal(report.knownFailures[0].classification, 'WRONG_AUTOMATIC_ROUTE');
});

test('22O2-05 zero-case PROBABLE and AMBIGUOUS coverage is explicit', () => {
  const report = reportFrom([result('CURATED', 'NO_MATCH', true, null, 'NO_MATCH')], [result('HOLDOUT', 'NO_MATCH', true, null, 'NO_MATCH')]);
  assert.equal(report.coverage.curated.confidence.PROBABLE.status, 'NOT_EVALUATED_NO_CASES');
  assert.equal(report.coverage.curated.confidence.AMBIGUOUS.status, 'NOT_EVALUATED_NO_CASES');
  assert.equal(report.routingQuality.fullFourStateCoverage, 'NO');
});

test('22O2-06 zero false-execution violations produce an execution-truth PASS with scope', () => {
  const report = reportFrom([result('CURATED', 'NO_MATCH', true, null, 'NO_MATCH')], [result('HOLDOUT', 'NO_MATCH', true, null, 'NO_MATCH')]);
  assert.equal(report.executionTruth.gate, 'PASS');
  assert.equal(report.executionTruth.coverageStatus, 'EVALUATED');
  assert.equal(report.executionTruth.totalFalseExecutionViolations, 0);
});

test('22O2-07 false-execution violations fail the execution-truth gate', () => {
  const execution = collectExecutionTruthMetrics([{workflowId: 'bad', workflowStatus: 'SPECIALIST_RUNNING', executionStarted: true, executionCompleted: false, attempts: []}]);
  const report = reportFrom([result('CURATED', 'NO_MATCH', true, null, 'NO_MATCH')], [result('HOLDOUT', 'NO_MATCH', true, null, 'NO_MATCH')], execution);
  assert.equal(report.executionTruth.gate, 'FAIL');
  assert.equal(report.releaseReadiness, 'FAIL');
});

test('22O2-08 routing gate failure blocks release readiness', () => {
  const report = reportFrom([result('CURATED', 'SPECIFIC_SPECIALIST', false, null, 'NO_MATCH', 'CLEAR')], [result('HOLDOUT', 'NO_MATCH', true, null, 'NO_MATCH')]);
  assert.equal(report.routingQuality.routingQualityGate, 'FAIL');
  assert.equal(report.releaseReadiness, 'FAIL');
});

test('22O2-09 synthetic fully passing inputs produce release readiness PASS', () => {
  const makeAll = (category: 'CURATED'|'HOLDOUT') => [
    result(category, 'SPECIFIC_SPECIALIST', true, 'architecture-security-advisor', 'CLEAR'),
    result(category, 'APPROVED_EQUIVALENT_SET', true, 'architecture-security-advisor', 'PROBABLE'),
    result(category, 'AMBIGUOUS', true, null, 'AMBIGUOUS'),
    result(category, 'NO_MATCH', true, null, 'NO_MATCH')
  ];
  const report = reportFrom(makeAll('CURATED'), makeAll('HOLDOUT'));
  assert.equal(report.routingQuality.routingQualityGate, 'PASS');
  assert.equal(report.routingQuality.fullFourStateCoverage, 'YES');
  assert.equal(report.releaseReadiness, 'PASS');
});

test('22O2-10 equivalent inputs produce deterministic JSON', () => {
  const first = reportFrom([result('CURATED', 'NO_MATCH', true, null, 'NO_MATCH')], [result('HOLDOUT', 'NO_MATCH', true, null, 'NO_MATCH')]);
  const second = reportFrom([result('CURATED', 'NO_MATCH', true, null, 'NO_MATCH')], [result('HOLDOUT', 'NO_MATCH', true, null, 'NO_MATCH')]);
  assert.equal(serializeRoutingReleaseReport(first), serializeRoutingReleaseReport(second));
});

test('22O2-11 equivalent inputs produce deterministic human-readable output', () => {
  const first = reportFrom([result('CURATED', 'NO_MATCH', true, null, 'NO_MATCH')], [result('HOLDOUT', 'NO_MATCH', true, null, 'NO_MATCH')]);
  const second = reportFrom([result('CURATED', 'NO_MATCH', true, null, 'NO_MATCH')], [result('HOLDOUT', 'NO_MATCH', true, null, 'NO_MATCH')]);
  assert.equal(renderRoutingReleaseReport(first), renderRoutingReleaseReport(second));
});

test('22O2-12 serialized report excludes trust, credential, environment, and reasoning data', () => {
  const report = reportFrom([result('CURATED', 'NO_MATCH', true, null, 'NO_MATCH')], [result('HOLDOUT', 'NO_MATCH', true, null, 'NO_MATCH')]);
  const serialized = serializeRoutingReleaseReport(report);
  for (const secret of ['ExecutionContext', 'Principal', 'password', 'apiKey', 'OPENAI_API_KEY', 'chain-of-thought', 'prompt']) assert.equal(serialized.includes(secret), false, secret);
});

test('22O2-13 current real report preserves repaired gates and coverage limitations', async () => {
  const curated = await loadRoutingCorpus(curatedPath);
  const holdout = await loadRoutingCorpus(holdoutPath);
  const evaluation = await evaluateCorpora(curated, holdout);
  const report = buildRoutingReleaseReport(evaluation, collectRoutingMetrics(evaluation.curated.results, 'CURATED'), collectRoutingMetrics(evaluation.holdout.results, 'HOLDOUT'), collectExecutionTruthMetrics([{workflowId: 'observed', workflowStatus: 'ROUTED', executionStarted: false, executionCompleted: false, attempts: []}]));
  assert.equal(report.routingQuality.curatedRoutingGate, 'PASS');
  assert.equal(report.routingQuality.holdoutClearGate, 'PASS');
  assert.equal(report.routingQuality.holdoutNoMatchGate, 'PASS');
  assert.equal(report.routingQuality.routingQualityGate, 'PASS');
  assert.equal(report.routingQuality.fullFourStateCoverage, 'NO');
  assert.deepEqual(report.knownFailures, []);
});

test('22O2-14 report command exit semantics distinguish quality failure from success', () => {
  assert.equal(releaseReportExitCode('FAIL'), 1);
  assert.equal(releaseReportExitCode('PASS'), 0);
});

test('22O2-15 report generation is side-effect free and does not mutate the registry', () => {
  const before = JSON.stringify(registry);
  const report = reportFrom([result('CURATED', 'NO_MATCH', true, null, 'NO_MATCH')], [result('HOLDOUT', 'NO_MATCH', true, null, 'NO_MATCH')]);
  serializeRoutingReleaseReport(report);
  renderRoutingReleaseReport(report);
  assert.equal(JSON.stringify(registry), before);
});
