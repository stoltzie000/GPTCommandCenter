import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { loadRoutingCorpus } from '../src/routing-evaluation-corpus.js';
import { evaluateCorpus } from '../src/routing-evaluation.js';
import { collectExecutionTruthMetrics, collectRoutingMetrics, ExecutionTruthRecord } from '../src/routing-execution-metrics.js';

const curatedPath = join(process.cwd(), 'tests/fixtures/routing-curated-corpus.json');
const holdoutPath = join(process.cwd(), 'tests/fixtures/routing-holdout-corpus.json');
const attempt = (state: 'CLAIMED'|'RUNNING'|'SUCCEEDED', initiationEvidence?: unknown, terminalEvidence?: unknown) => ({state, initiationEvidence, terminalEvidence});
const execRecord = (overrides: Partial<ExecutionTruthRecord> = {}): ExecutionTruthRecord => ({workflowId: 'workflow', workflowStatus: 'ROUTED', executionStarted: false, executionCompleted: false, attempts: [], ...overrides});

test('22O1-01 wrong automatic route increments only wrongAutomaticRouteCount', () => {
  const corpus = {schemaVersion: 1, cases: [{schemaVersion: 1, id: 'wrong', title: 'wrong', request: 'request', category: 'CURATED' as const, tags: [], expected: {outcome: 'SPECIFIC_SPECIALIST' as const, specialistId: 'architecture-security-advisor', confidence: 'CLEAR' as const}}]};
  const result = {caseId: 'wrong', category: 'CURATED' as const, expectedOutcome: 'SPECIFIC_SPECIALIST' as const, expectedConfidence: 'CLEAR' as const, expectedSpecialistId: 'architecture-security-advisor', actualConfidence: 'CLEAR' as const, actualSelectedSpecialistId: 'other', passed: false, mismatch: 'wrong'};
  assert.equal(corpus.cases.length, 1);
  const metrics = collectRoutingMetrics([result], 'CURATED');
  assert.equal(metrics.wrongAutomaticRouteCount, 1);
  assert.equal(metrics.missedExpectedRouteCount, 0);
});

test('22O1-02 missed expected route is distinct from wrong automatic route', () => {
  const result = {caseId: 'missed', category: 'CURATED' as const, expectedOutcome: 'SPECIFIC_SPECIALIST' as const, expectedConfidence: 'CLEAR' as const, expectedSpecialistId: 'architecture-security-advisor', actualConfidence: 'NO_MATCH' as const, actualSelectedSpecialistId: null, passed: false, mismatch: 'missed'};
  const metrics = collectRoutingMetrics([result], 'CURATED');
  assert.equal(metrics.missedExpectedRouteCount, 1);
  assert.equal(metrics.wrongAutomaticRouteCount, 0);
});

test('22O1-03 equivalent-set outsiders are wrong automatic routes but approved members are not', () => {
  const base = {caseId: 'equivalent', category: 'CURATED' as const, expectedOutcome: 'APPROVED_EQUIVALENT_SET' as const, expectedSpecialistIds: ['architecture-security-advisor', 'other'], actualConfidence: 'PROBABLE' as const, passed: true};
  assert.equal(collectRoutingMetrics([{...base, actualSelectedSpecialistId: 'other'}], 'CURATED').wrongAutomaticRouteCount, 0);
  assert.equal(collectRoutingMetrics([{...base, actualSelectedSpecialistId: 'outsider', passed: false}], 'CURATED').wrongAutomaticRouteCount, 1);
});

test('22O1-04 ambiguous auto-routes are safety violations', () => {
  const base = {caseId: 'ambiguous', category: 'CURATED' as const, expectedOutcome: 'AMBIGUOUS' as const, expectedConfidence: 'AMBIGUOUS' as const, actualConfidence: 'AMBIGUOUS' as const, passed: false};
  const auto = collectRoutingMetrics([{...base, actualSelectedSpecialistId: 'architecture-security-advisor'}], 'CURATED');
  const unresolved = collectRoutingMetrics([{...base, actualSelectedSpecialistId: null, passed: true}], 'CURATED');
  assert.equal(auto.ambiguousAutoRouteViolationCount, 1);
  assert.equal(auto.wrongAutomaticRouteCount, 1);
  assert.equal(unresolved.ambiguousAutoRouteViolationCount, 0);
});

test('22O1-05 forced NO_MATCH routes are separately counted', () => {
  const base = {caseId: 'no-match', category: 'HOLDOUT' as const, expectedOutcome: 'NO_MATCH' as const, expectedConfidence: 'NO_MATCH' as const, actualConfidence: 'PROBABLE' as const, passed: false};
  const forced = collectRoutingMetrics([{...base, actualSelectedSpecialistId: 'architecture-security-advisor'}], 'HOLDOUT');
  const none = collectRoutingMetrics([{...base, actualConfidence: 'NO_MATCH' as const, actualSelectedSpecialistId: null, passed: true}], 'HOLDOUT');
  assert.equal(forced.noMatchForcedRouteViolationCount, 1);
  assert.equal(forced.wrongAutomaticRouteCount, 1);
  assert.equal(none.noMatchForcedRouteViolationCount, 0);
});

test('22O1-06 confidence mismatch is separate from specialist-selection error', () => {
  const result = {caseId: 'confidence', category: 'CURATED' as const, expectedOutcome: 'SPECIFIC_SPECIALIST' as const, expectedConfidence: 'CLEAR' as const, expectedSpecialistId: 'architecture-security-advisor', actualConfidence: 'PROBABLE' as const, actualSelectedSpecialistId: 'architecture-security-advisor', passed: false, mismatch: 'confidence'};
  const metrics = collectRoutingMetrics([result], 'CURATED');
  assert.equal(metrics.confidenceMismatchCount, 1);
  assert.equal(metrics.wrongAutomaticRouteCount, 0);
  assert.equal(metrics.missedExpectedRouteCount, 0);
});

test('22O1-07 zero-case classes report NOT_EVALUATED_NO_CASES', () => {
  const metrics = collectRoutingMetrics([], 'CURATED');
  assert.equal(metrics.coverage.AMBIGUOUS.status, 'NOT_EVALUATED_NO_CASES');
  assert.equal(metrics.confidenceCoverage.PROBABLE.status, 'NOT_EVALUATED_NO_CASES');
  assert.equal(metrics.confidenceCoverage.AMBIGUOUS.status, 'NOT_EVALUATED_NO_CASES');
});

test('22O1-08 real curated metrics reflect the repaired curated corpus', async () => {
  const corpus = await loadRoutingCorpus(curatedPath);
  const results = (await evaluateCorpus(corpus)).results;
  const metrics = collectRoutingMetrics(results, 'CURATED');
  assert.equal(metrics.failedCases, 0);
  assert.equal(metrics.wrongAutomaticRouteCount, 0);
  assert.equal(metrics.missedExpectedRouteCount, 0);
  assert.equal(metrics.noMatchForcedRouteViolationCount, 0);
});

test('22O1-09 real holdout metrics reflect the frozen post-repair result', async () => {
  const corpus = await loadRoutingCorpus(holdoutPath);
  const results = (await evaluateCorpus(corpus)).results;
  const metrics = collectRoutingMetrics(results, 'HOLDOUT');
  assert.equal(metrics.failedCases, 0);
  assert.equal(metrics.wrongAutomaticRouteCount, 0);
  assert.equal(metrics.missedExpectedRouteCount, 0);
  assert.equal(metrics.noMatchForcedRouteViolationCount, 0);
});

test('22O1-10 detects false execution-start claims without initiation evidence', () => {
  const metrics = collectExecutionTruthMetrics([execRecord({executionStarted: true})]);
  assert.equal(metrics.falseExecutionStartClaims, 1);
  assert.equal(metrics.totalFalseExecutionViolations, 1);
});

test('22O1-11 detects false completion claims without terminal evidence', () => {
  const metrics = collectExecutionTruthMetrics([execRecord({workflowStatus: 'COMPLETE', executionCompleted: true})]);
  assert.equal(metrics.falseExecutionCompleteClaims, 1);
  assert.equal(metrics.completeWithoutEvidenceViolations, 1);
  assert.equal(metrics.totalFalseExecutionViolations, 1);
});

test('22O1-12 CLAIMED without evidence is not itself a false-execution violation', () => {
  const metrics = collectExecutionTruthMetrics([execRecord({attempts: [attempt('CLAIMED')]})]);
  assert.deepEqual(metrics, {workflowsInspected: 1, executionStartClaimsInspected: 0, executionCompleteClaimsInspected: 0, falseExecutionStartClaims: 0, falseExecutionCompleteClaims: 0, runningWithoutEvidenceViolations: 0, completeWithoutEvidenceViolations: 0, totalFalseExecutionViolations: 0});
});

test('22O1-13 valid initiation evidence does not trigger a false-start violation', () => {
  const metrics = collectExecutionTruthMetrics([execRecord({workflowStatus: 'SPECIALIST_RUNNING', executionStarted: true, attempts: [attempt('RUNNING', {externalExecutionId: 'start'})]})]);
  assert.equal(metrics.falseExecutionStartClaims, 0);
  assert.equal(metrics.runningWithoutEvidenceViolations, 0);
});

test('22O1-14 valid terminal evidence does not trigger a false-complete violation', () => {
  const metrics = collectExecutionTruthMetrics([execRecord({workflowStatus: 'COMPLETE', executionStarted: true, executionCompleted: true, attempts: [attempt('SUCCEEDED', {externalExecutionId: 'start'}, {terminal: 'success'})]})]);
  assert.equal(metrics.totalFalseExecutionViolations, 0);
});

test('22O1-15 PostgreSQL execution-truth snapshot survives fresh-store reconstruction', {skip: !process.env.PG_TEST_URL}, async () => {
  const { PgStore } = await import('../src/pg-store.js');
  const { readWorkflow } = await import('../src/workflow-read-model.js');
  const input = (requestId: string) => ({requestId, workflowType: 'non_code' as const, logicalSpecialistId: 'architecture-security-advisor', runtimeId: 'architecture-security-advisor-api', validationRequired: false, effectiveClassification: 'PUBLIC' as const, objective: 'metric truth', context: {}, requiresImplementation: false});
  const first = new PgStore(process.env.PG_TEST_URL);
  const ids: string[] = [];
  try {
    const routed = await first.createWorkflow(input(randomUUID())); ids.push(routed.id);
    const claimed = await first.createWorkflow(input(randomUUID())); const claim = await first.claimStage(claimed.id, 'specialist:metric', 'specialist', 'runtime', 'metric-test'); ids.push(claimed.id);
    const started = await first.createWorkflow(input(randomUUID())); const startClaim = await first.claimStage(started.id, 'specialist:metric', 'specialist', 'runtime', 'metric-test'); await first.recordInitiation(started.id, startClaim.attempt.id, {externalExecutionId: 'metric-start'}, 'metric-test'); ids.push(started.id);
    const records = [];
    for (const id of ids) { const workflow = await first.getWorkflow(id); assert.ok(workflow); const read = await readWorkflow(first, workflow); records.push({workflowId: id, workflowStatus: workflow.status, executionStarted: read.execution.started, executionCompleted: read.execution.completed, attempts: await first.getAttempts(id)}); }
    const before = collectExecutionTruthMetrics(records);
    await first.pool.end();
    const second = new PgStore(process.env.PG_TEST_URL);
    try {
      const afterRecords = [];
      for (const id of ids) { const workflow = await second.getWorkflow(id); assert.ok(workflow); const read = await readWorkflow(second, workflow); afterRecords.push({workflowId: id, workflowStatus: workflow.status, executionStarted: read.execution.started, executionCompleted: read.execution.completed, attempts: await second.getAttempts(id)}); }
      assert.deepEqual(collectExecutionTruthMetrics(afterRecords), before);
    } finally { await second.pool.end(); }
  } catch (error) { await first.pool.end(); throw error; }
});

test('22O1-16 metric collection is side-effect free', async () => {
  const curated = await loadRoutingCorpus(curatedPath);
  const results = (await evaluateCorpus(curated)).results;
  const before = results.map(result => JSON.stringify(result));
  collectRoutingMetrics(results, 'CURATED');
  collectExecutionTruthMetrics([execRecord()]);
  assert.deepEqual(results.map(result => JSON.stringify(result)), before);
});
