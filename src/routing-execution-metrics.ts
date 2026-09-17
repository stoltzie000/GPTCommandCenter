import { Attempt, WorkflowStatus } from './domain.js';
import { ExpectedRoutingOutcome } from './routing-evaluation-corpus.js';
import { RoutingEvaluationResult } from './routing-evaluation.js';

export type MetricCoverageStatus = 'EVALUATED' | 'NOT_EVALUATED_NO_CASES';

export interface RoutingMetricSnapshot {
  category: 'CURATED' | 'HOLDOUT';
  totalEvaluatedCases: number;
  passedCases: number;
  failedCases: number;
  automaticRouteCount: number;
  wrongAutomaticRouteCount: number;
  missedExpectedRouteCount: number;
  ambiguousAutoRouteViolationCount: number;
  noMatchForcedRouteViolationCount: number;
  confidenceMismatchCount: number;
  coverage: Record<ExpectedRoutingOutcome['outcome'], { total: number; status: MetricCoverageStatus }>;
  confidenceCoverage: Record<'CLEAR'|'PROBABLE'|'AMBIGUOUS'|'NO_MATCH', { total: number; status: MetricCoverageStatus }>;
}

export interface ExecutionTruthRecord {
  workflowId: string;
  workflowStatus: WorkflowStatus | string;
  executionStarted: boolean;
  executionCompleted: boolean;
  attempts: ReadonlyArray<Pick<Attempt, 'state'|'initiationEvidence'|'terminalEvidence'>>;
}

export interface ExecutionTruthSnapshot {
  workflowsInspected: number;
  executionStartClaimsInspected: number;
  executionCompleteClaimsInspected: number;
  falseExecutionStartClaims: number;
  falseExecutionCompleteClaims: number;
  runningWithoutEvidenceViolations: number;
  completeWithoutEvidenceViolations: number;
  totalFalseExecutionViolations: number;
}

const outcomeTypes: ExpectedRoutingOutcome['outcome'][] = ['SPECIFIC_SPECIALIST', 'APPROVED_EQUIVALENT_SET', 'AMBIGUOUS', 'NO_MATCH'];
const confidenceTypes = ['CLEAR', 'PROBABLE', 'AMBIGUOUS', 'NO_MATCH'] as const;
const hasEvidence = (value: unknown): boolean => value !== undefined && value !== null;

function expectedAutomaticRouteAccepted(result: RoutingEvaluationResult): boolean {
  if (result.expectedOutcome === 'SPECIFIC_SPECIALIST') return result.actualSelectedSpecialistId === result.expectedSpecialistId;
  if (result.expectedOutcome === 'APPROVED_EQUIVALENT_SET') return result.actualSelectedSpecialistId !== null && result.expectedSpecialistIds?.includes(result.actualSelectedSpecialistId) === true;
  return false;
}

function hasConfidenceMismatch(result: RoutingEvaluationResult): boolean {
  return result.expectedConfidence !== undefined && result.expectedConfidence !== result.actualConfidence;
}

export function collectRoutingMetrics(results: ReadonlyArray<RoutingEvaluationResult>, category: 'CURATED'|'HOLDOUT'): RoutingMetricSnapshot {
  const counts = Object.fromEntries(outcomeTypes.map(outcome => [outcome, {total: 0, status: 'NOT_EVALUATED_NO_CASES' as MetricCoverageStatus}])) as RoutingMetricSnapshot['coverage'];
  const confidenceCoverage = Object.fromEntries(confidenceTypes.map(confidence => [confidence, {total: 0, status: 'NOT_EVALUATED_NO_CASES' as MetricCoverageStatus}])) as RoutingMetricSnapshot['confidenceCoverage'];
  let automaticRouteCount = 0;
  let wrongAutomaticRouteCount = 0;
  let missedExpectedRouteCount = 0;
  let ambiguousAutoRouteViolationCount = 0;
  let noMatchForcedRouteViolationCount = 0;
  let confidenceMismatchCount = 0;
  for (const result of results) {
    counts[result.expectedOutcome].total++;
    if (result.expectedConfidence !== undefined) confidenceCoverage[result.expectedConfidence].total++;
    if (result.actualSelectedSpecialistId !== null) automaticRouteCount++;
    if (hasConfidenceMismatch(result)) confidenceMismatchCount++;
    if (result.expectedOutcome === 'SPECIFIC_SPECIALIST' || result.expectedOutcome === 'APPROVED_EQUIVALENT_SET') {
      if (result.actualSelectedSpecialistId === null) missedExpectedRouteCount++;
      else if (!expectedAutomaticRouteAccepted(result)) wrongAutomaticRouteCount++;
    } else if (result.expectedOutcome === 'AMBIGUOUS' && result.actualSelectedSpecialistId !== null) {
      ambiguousAutoRouteViolationCount++;
      wrongAutomaticRouteCount++;
    } else if (result.expectedOutcome === 'NO_MATCH' && result.actualSelectedSpecialistId !== null) {
      noMatchForcedRouteViolationCount++;
      wrongAutomaticRouteCount++;
    }
  }
  for (const outcome of outcomeTypes) if (counts[outcome].total > 0) counts[outcome].status = 'EVALUATED';
  for (const confidence of confidenceTypes) if (confidenceCoverage[confidence].total > 0) confidenceCoverage[confidence].status = 'EVALUATED';
  return {category, totalEvaluatedCases: results.length, passedCases: results.filter(result => result.passed).length, failedCases: results.filter(result => !result.passed).length, automaticRouteCount, wrongAutomaticRouteCount, missedExpectedRouteCount, ambiguousAutoRouteViolationCount, noMatchForcedRouteViolationCount, confidenceMismatchCount, coverage: counts, confidenceCoverage};
}

export function collectExecutionTruthMetrics(records: ReadonlyArray<ExecutionTruthRecord>): ExecutionTruthSnapshot {
  let executionStartClaimsInspected = 0;
  let executionCompleteClaimsInspected = 0;
  let falseExecutionStartClaims = 0;
  let falseExecutionCompleteClaims = 0;
  let runningWithoutEvidenceViolations = 0;
  let completeWithoutEvidenceViolations = 0;
  const runningStatuses = new Set(['SPECIALIST_RUNNING', 'CODEX_RUNNING', 'VALIDATION_RUNNING']);
  for (const record of records) {
    const hasInitiationEvidence = record.attempts.some(attempt => hasEvidence(attempt.initiationEvidence));
    const hasTerminalEvidence = record.attempts.some(attempt => hasEvidence(attempt.terminalEvidence));
    const runningClaim = record.executionStarted || runningStatuses.has(record.workflowStatus);
    const completeClaim = record.executionCompleted;
    if (record.executionStarted) executionStartClaimsInspected++;
    if (record.executionCompleted) executionCompleteClaimsInspected++;
    if (record.executionStarted && !hasInitiationEvidence) falseExecutionStartClaims++;
    if (record.executionCompleted && !hasTerminalEvidence) falseExecutionCompleteClaims++;
    if (runningClaim && !hasInitiationEvidence) runningWithoutEvidenceViolations++;
    if (record.workflowStatus === 'COMPLETE' && completeClaim && !hasTerminalEvidence) completeWithoutEvidenceViolations++;
  }
  return {workflowsInspected: records.length, executionStartClaimsInspected, executionCompleteClaimsInspected, falseExecutionStartClaims, falseExecutionCompleteClaims, runningWithoutEvidenceViolations, completeWithoutEvidenceViolations, totalFalseExecutionViolations: falseExecutionStartClaims + falseExecutionCompleteClaims};
}
