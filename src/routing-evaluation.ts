import { ExpectedRoutingOutcome, RoutingEvaluationCase, RoutingEvaluationCorpus } from './routing-evaluation-corpus.js';
import { registry as canonicalRegistry } from './registry.js';
import { DeterministicRequestInterpreter, interpretAndSelect, resolveRouting } from './routing.js';
import { RoutingConfidence, RoutingResolution, Specialist } from './domain.js';

export type EvaluationGateStatus = 'PASS' | 'FAIL' | 'NOT_EVALUATED_NO_CASES';
export type EvaluationCoverageStatus = 'COMPLETE' | 'LIMITED';

export interface RoutingEvaluationResult {
  caseId: string;
  category: 'CURATED' | 'HOLDOUT';
  expectedOutcome: ExpectedRoutingOutcome['outcome'];
  expectedConfidence?: RoutingConfidence;
  expectedSpecialistId?: string;
  expectedSpecialistIds?: string[];
  actualConfidence: RoutingConfidence;
  actualSelectedSpecialistId: string | null;
  passed: boolean;
  mismatch?: string;
}

export interface RoutingEvaluationSummary {
  total: number;
  passed: number;
  failed: number;
  byOutcome: Record<ExpectedRoutingOutcome['outcome'], { total: number; passed: number; failed: number }>;
  results: RoutingEvaluationResult[];
}

export interface RoutingReleaseGates {
  curatedRoutingGate: EvaluationGateStatus;
  holdoutClearGate: EvaluationGateStatus;
  holdoutNoMatchGate: EvaluationGateStatus;
  curatedCoverageStatus: EvaluationCoverageStatus;
  holdoutCoverageStatus: EvaluationCoverageStatus;
  routingQualityGate: 'PASS' | 'FAIL';
  fullFourStateCoverage: 'YES' | 'NO';
  holdoutClearCorrect: number;
  holdoutClearTotal: number;
  holdoutClearPercentage: number | null;
  holdoutNoMatchViolations: number;
}

export interface RoutingEvaluationReport {
  curated: RoutingEvaluationSummary;
  holdout: RoutingEvaluationSummary;
  gates: RoutingReleaseGates;
}

const outcomeTypes: ExpectedRoutingOutcome['outcome'][] = ['SPECIFIC_SPECIALIST', 'APPROVED_EQUIVALENT_SET', 'AMBIGUOUS', 'NO_MATCH'];

function expectedFields(expected: ExpectedRoutingOutcome): Pick<RoutingEvaluationResult, 'expectedConfidence'|'expectedSpecialistId'|'expectedSpecialistIds'> {
  if (expected.outcome === 'SPECIFIC_SPECIALIST') return {expectedConfidence: expected.confidence, expectedSpecialistId: expected.specialistId};
  if (expected.outcome === 'APPROVED_EQUIVALENT_SET') return {expectedConfidence: expected.confidence, expectedSpecialistIds: [...expected.specialistIds]};
  return {expectedConfidence: expected.confidence};
}

export function compareRoutingCase(item: RoutingEvaluationCase, actual: RoutingResolution): RoutingEvaluationResult {
  const expected = item.expected;
  const mismatch: string[] = [];
  if (expected.outcome === 'SPECIFIC_SPECIALIST') {
    if (actual.selectedSpecialistId !== expected.specialistId) mismatch.push(`selected specialist expected ${expected.specialistId} but was ${actual.selectedSpecialistId ?? 'none'}`);
    if (expected.confidence !== undefined && actual.routingConfidence !== expected.confidence) mismatch.push(`confidence expected ${expected.confidence} but was ${actual.routingConfidence}`);
  } else if (expected.outcome === 'APPROVED_EQUIVALENT_SET') {
    if (!actual.selectedSpecialistId || !expected.specialistIds.includes(actual.selectedSpecialistId)) mismatch.push('selected specialist was outside the approved equivalent set');
    if (expected.confidence !== undefined && actual.routingConfidence !== expected.confidence) mismatch.push(`confidence expected ${expected.confidence} but was ${actual.routingConfidence}`);
  } else if (expected.outcome === 'AMBIGUOUS') {
    if (actual.routingConfidence !== 'AMBIGUOUS' || actual.selectedSpecialistId !== null || !actual.requiresClarification) mismatch.push('expected unresolved ambiguity without an automatic specialist route');
  } else if (actual.routingConfidence !== 'NO_MATCH' || actual.selectedSpecialistId !== null) {
    mismatch.push('expected NO_MATCH without an automatic specialist route');
  }
  return {caseId: item.id, category: item.category, expectedOutcome: expected.outcome, ...expectedFields(expected), actualConfidence: actual.routingConfidence, actualSelectedSpecialistId: actual.selectedSpecialistId, passed: mismatch.length === 0, ...(mismatch.length ? {mismatch: mismatch.join('; ')} : {})};
}

function emptyOutcomeCounts(): RoutingEvaluationSummary['byOutcome'] {
  return {SPECIFIC_SPECIALIST: {total: 0, passed: 0, failed: 0}, APPROVED_EQUIVALENT_SET: {total: 0, passed: 0, failed: 0}, AMBIGUOUS: {total: 0, passed: 0, failed: 0}, NO_MATCH: {total: 0, passed: 0, failed: 0}};
}

export function summarizeEvaluation(results: RoutingEvaluationResult[]): RoutingEvaluationSummary {
  const byOutcome = emptyOutcomeCounts();
  for (const result of results) {
    const counts = byOutcome[result.expectedOutcome];
    counts.total++;
    if (result.passed) counts.passed++; else counts.failed++;
  }
  return {total: results.length, passed: results.filter(result => result.passed).length, failed: results.filter(result => !result.passed).length, byOutcome, results: [...results]};
}

function coverage(summary: RoutingEvaluationSummary): EvaluationCoverageStatus {
  return outcomeTypes.every(outcome => summary.byOutcome[outcome].total > 0) ? 'COMPLETE' : 'LIMITED';
}

function gateForOutcome(summary: RoutingEvaluationSummary, outcome: ExpectedRoutingOutcome['outcome']): EvaluationGateStatus {
  const counts = summary.byOutcome[outcome];
  return counts.total === 0 ? 'NOT_EVALUATED_NO_CASES' : counts.failed === 0 ? 'PASS' : 'FAIL';
}

export function computeReleaseGates(curated: RoutingEvaluationSummary, holdout: RoutingEvaluationSummary): RoutingReleaseGates {
  const clear = holdout.byOutcome.SPECIFIC_SPECIALIST;
  const clearPercentage = clear.total ? clear.passed / clear.total : null;
  const holdoutClearGate: EvaluationGateStatus = clear.total === 0 ? 'NOT_EVALUATED_NO_CASES' : clearPercentage !== null && clearPercentage >= 0.95 ? 'PASS' : 'FAIL';
  const holdoutNoMatch = holdout.byOutcome.NO_MATCH;
  const holdoutNoMatchGate: EvaluationGateStatus = holdoutNoMatch.total === 0 ? 'NOT_EVALUATED_NO_CASES' : holdoutNoMatch.failed === 0 ? 'PASS' : 'FAIL';
  const curatedRoutingGate: EvaluationGateStatus = curated.total === 0 ? 'NOT_EVALUATED_NO_CASES' : curated.failed === 0 ? 'PASS' : 'FAIL';
  const curatedCoverageStatus = coverage(curated);
  const holdoutCoverageStatus = coverage(holdout);
  const applicable = [curatedRoutingGate, holdoutClearGate, holdoutNoMatchGate];
  return {curatedRoutingGate, holdoutClearGate, holdoutNoMatchGate, curatedCoverageStatus, holdoutCoverageStatus, routingQualityGate: applicable.every(status => status === 'PASS') ? 'PASS' : 'FAIL', fullFourStateCoverage: curatedCoverageStatus === 'COMPLETE' && holdoutCoverageStatus === 'COMPLETE' ? 'YES' : 'NO', holdoutClearCorrect: clear.passed, holdoutClearTotal: clear.total, holdoutClearPercentage: clearPercentage, holdoutNoMatchViolations: holdoutNoMatch.failed};
}

export async function evaluateCorpus(corpus: RoutingEvaluationCorpus, interpreter = new DeterministicRequestInterpreter(), inputRegistry: Readonly<Record<string, Specialist>> = canonicalRegistry): Promise<RoutingEvaluationSummary> {
  const results: RoutingEvaluationResult[] = [];
  for (const item of corpus.cases) {
    const interpreted = await interpretAndSelect(interpreter, {request: item.request}, inputRegistry as Record<string, Specialist>);
    results.push(compareRoutingCase(item, resolveRouting(interpreted.candidates)));
  }
  return summarizeEvaluation(results);
}

export async function evaluateCorpora(curated: RoutingEvaluationCorpus, holdout: RoutingEvaluationCorpus, interpreter = new DeterministicRequestInterpreter(), inputRegistry: Readonly<Record<string, Specialist>> = canonicalRegistry): Promise<RoutingEvaluationReport> {
  const curatedSummary = await evaluateCorpus(curated, interpreter, inputRegistry);
  const holdoutSummary = await evaluateCorpus(holdout, interpreter, inputRegistry);
  return {curated: curatedSummary, holdout: holdoutSummary, gates: computeReleaseGates(curatedSummary, holdoutSummary)};
}

export function formatEvaluationReport(report: RoutingEvaluationReport): string {
  const failed = [...report.curated.results, ...report.holdout.results].filter(result => !result.passed).map(result => `${result.category}:${result.caseId} — ${result.mismatch}`).join('\n');
  const percentage = report.gates.holdoutClearPercentage === null ? 'NOT_EVALUATED_NO_CASES' : `${(report.gates.holdoutClearPercentage * 100).toFixed(2)}%`;
  return [
    `CURATED ${report.curated.passed}/${report.curated.total} passed; gate=${report.gates.curatedRoutingGate}; coverage=${report.gates.curatedCoverageStatus}`,
    `HOLDOUT ${report.holdout.passed}/${report.holdout.total} passed; clear=${report.gates.holdoutClearCorrect}/${report.gates.holdoutClearTotal} (${percentage}); clearGate=${report.gates.holdoutClearGate}; noMatchGate=${report.gates.holdoutNoMatchGate}; coverage=${report.gates.holdoutCoverageStatus}`,
    `ROUTING_QUALITY_GATE=${report.gates.routingQualityGate}; FULL_FOUR_STATE_COVERAGE=${report.gates.fullFourStateCoverage}`,
    ...(failed ? ['FAILURES:', failed] : [])
  ].join('\n');
}
