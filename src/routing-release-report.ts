import { RoutingEvaluationReport, RoutingEvaluationResult } from './routing-evaluation.js';
import { ExecutionTruthSnapshot, MetricCoverageStatus, RoutingMetricSnapshot } from './routing-execution-metrics.js';

export type ReleaseReadiness = 'PASS' | 'FAIL';

export function releaseReportExitCode(releaseReadiness: ReleaseReadiness): 0 | 1 {
  return releaseReadiness === 'PASS' ? 0 : 1;
}

export interface ReleaseFailure {
  caseId: string;
  category: 'CURATED' | 'HOLDOUT';
  classification: 'MISSED_EXPECTED_ROUTE' | 'WRONG_AUTOMATIC_ROUTE' | 'AMBIGUOUS_AUTO_ROUTE' | 'NO_MATCH_FORCED_ROUTE' | 'CONFIDENCE_MISMATCH';
  expectedOutcome: RoutingEvaluationResult['expectedOutcome'];
  expectedConfidence?: string;
  expectedSpecialistId?: string;
  expectedSpecialistIds?: string[];
  actualConfidence: string;
  actualSelectedSpecialistId: string | null;
}

export interface ReportCoverageEntry {
  total: number;
  status: MetricCoverageStatus;
}

export interface RoutingReleaseReport {
  schemaVersion: 1;
  implementationValidation: 'PASS' | 'FAIL';
  routingQuality: {
    curatedRoutingGate: string;
    holdoutClearGate: string;
    holdoutNoMatchGate: string;
    routingQualityGate: 'PASS' | 'FAIL';
    fullFourStateCoverage: 'YES' | 'NO';
  };
  coverage: {
    curated: {
      outcomes: Record<string, ReportCoverageEntry>;
      confidence: Record<string, ReportCoverageEntry>;
    };
    holdout: {
      outcomes: Record<string, ReportCoverageEntry>;
      confidence: Record<string, ReportCoverageEntry>;
    };
  };
  routingMetrics: {
    curated: RoutingMetricSnapshot;
    holdout: RoutingMetricSnapshot;
  };
  knownFailures: ReleaseFailure[];
  executionTruth: ExecutionTruthSnapshot & {
    gate: 'PASS' | 'FAIL';
    coverageStatus: 'EVALUATED' | 'NOT_EVALUATED_NO_CASES';
  };
  releaseReadiness: ReleaseReadiness;
}

function classifyFailure(result: RoutingEvaluationResult): ReleaseFailure['classification'] {
  if ((result.expectedOutcome === 'SPECIFIC_SPECIALIST' || result.expectedOutcome === 'APPROVED_EQUIVALENT_SET') && result.actualSelectedSpecialistId === null) return 'MISSED_EXPECTED_ROUTE';
  if (result.expectedOutcome === 'AMBIGUOUS' && result.actualSelectedSpecialistId !== null) return 'AMBIGUOUS_AUTO_ROUTE';
  if (result.expectedOutcome === 'NO_MATCH' && result.actualSelectedSpecialistId !== null) return 'NO_MATCH_FORCED_ROUTE';
  if (result.expectedOutcome === 'SPECIFIC_SPECIALIST' && result.actualSelectedSpecialistId === result.expectedSpecialistId && result.expectedConfidence !== result.actualConfidence) return 'CONFIDENCE_MISMATCH';
  if (result.expectedOutcome === 'APPROVED_EQUIVALENT_SET' && result.expectedSpecialistIds?.includes(result.actualSelectedSpecialistId ?? '') && result.expectedConfidence !== result.actualConfidence) return 'CONFIDENCE_MISMATCH';
  if (result.expectedOutcome === 'SPECIFIC_SPECIALIST' || result.expectedOutcome === 'APPROVED_EQUIVALENT_SET') return 'WRONG_AUTOMATIC_ROUTE';
  return 'CONFIDENCE_MISMATCH';
}

function failureFromResult(result: RoutingEvaluationResult): ReleaseFailure {
  return {caseId: result.caseId, category: result.category, classification: classifyFailure(result), expectedOutcome: result.expectedOutcome, ...(result.expectedConfidence ? {expectedConfidence: result.expectedConfidence} : {}), ...(result.expectedSpecialistId ? {expectedSpecialistId: result.expectedSpecialistId} : {}), ...(result.expectedSpecialistIds ? {expectedSpecialistIds: [...result.expectedSpecialistIds]} : {}), actualConfidence: result.actualConfidence, actualSelectedSpecialistId: result.actualSelectedSpecialistId};
}

function allCoverageEvaluated(metrics: RoutingMetricSnapshot): boolean { return Object.values(metrics.coverage).every(entry => entry.status === 'EVALUATED') && Object.values(metrics.confidenceCoverage).every(entry => entry.status === 'EVALUATED'); }

export function buildRoutingReleaseReport(evaluation: RoutingEvaluationReport, curatedMetrics: RoutingMetricSnapshot, holdoutMetrics: RoutingMetricSnapshot, executionTruth: ExecutionTruthSnapshot, implementationValidation: 'PASS'|'FAIL' = 'PASS'): RoutingReleaseReport {
  const knownFailures = [...evaluation.curated.results, ...evaluation.holdout.results].filter(result => !result.passed).map(failureFromResult).sort((a, b) => a.category.localeCompare(b.category) || a.caseId.localeCompare(b.caseId));
  const executionGate = executionTruth.totalFalseExecutionViolations === 0 ? 'PASS' : 'FAIL';
  const executionCoverage = executionTruth.workflowsInspected > 0 ? 'EVALUATED' : 'NOT_EVALUATED_NO_CASES';
  const releaseReadiness = implementationValidation === 'PASS' && evaluation.gates.routingQualityGate === 'PASS' && executionGate === 'PASS' && evaluation.gates.fullFourStateCoverage === 'YES' && allCoverageEvaluated(curatedMetrics) && allCoverageEvaluated(holdoutMetrics) ? 'PASS' : 'FAIL';
  return {schemaVersion: 1, implementationValidation, routingQuality: {curatedRoutingGate: evaluation.gates.curatedRoutingGate, holdoutClearGate: evaluation.gates.holdoutClearGate, holdoutNoMatchGate: evaluation.gates.holdoutNoMatchGate, routingQualityGate: evaluation.gates.routingQualityGate, fullFourStateCoverage: evaluation.gates.fullFourStateCoverage}, coverage: {curated: {outcomes: curatedMetrics.coverage, confidence: curatedMetrics.confidenceCoverage}, holdout: {outcomes: holdoutMetrics.coverage, confidence: holdoutMetrics.confidenceCoverage}}, routingMetrics: {curated: curatedMetrics, holdout: holdoutMetrics}, knownFailures, executionTruth: {...executionTruth, gate: executionGate, coverageStatus: executionCoverage}, releaseReadiness};
}

export function serializeRoutingReleaseReport(report: RoutingReleaseReport): string { return JSON.stringify(report); }

function coverageLine(scope: string, coverage: Record<string, ReportCoverageEntry>): string { return `${scope}: ${Object.entries(coverage).map(([name, entry]) => `${name}=${entry.total > 0 ? entry.total : entry.status}`).join(' ')}`; }

export function renderRoutingReleaseReport(report: RoutingReleaseReport): string {
  const c = report.routingMetrics.curated;
  const h = report.routingMetrics.holdout;
  const failures = report.knownFailures.length ? report.knownFailures.map(failure => `${failure.category}:${failure.caseId} ${failure.classification}`).join('\n') : 'none';
  return [
    'ROUTING QUALITY',
    `CURATED ${c.passedCases}/${c.totalEvaluatedCases} passed gate=${report.routingQuality.curatedRoutingGate}`,
    `HOLDOUT ${h.passedCases}/${h.totalEvaluatedCases} passed clearGate=${report.routingQuality.holdoutClearGate} noMatchGate=${report.routingQuality.holdoutNoMatchGate}`,
    `ROUTING_QUALITY_GATE=${report.routingQuality.routingQualityGate}`,
    'COVERAGE',
    coverageLine('CURATED OUTCOMES', report.coverage.curated.outcomes),
    coverageLine('CURATED CONFIDENCE', report.coverage.curated.confidence),
    coverageLine('HOLDOUT OUTCOMES', report.coverage.holdout.outcomes),
    coverageLine('HOLDOUT CONFIDENCE', report.coverage.holdout.confidence),
    `FULL_FOUR_STATE_COVERAGE=${report.routingQuality.fullFourStateCoverage}`,
    'ROUTING METRICS',
    `CURATED automatic=${c.automaticRouteCount} wrongAutomatic=${c.wrongAutomaticRouteCount} missedExpected=${c.missedExpectedRouteCount} ambiguityViolations=${c.ambiguousAutoRouteViolationCount} noMatchForced=${c.noMatchForcedRouteViolationCount} confidenceMismatches=${c.confidenceMismatchCount}`,
    `HOLDOUT automatic=${h.automaticRouteCount} wrongAutomatic=${h.wrongAutomaticRouteCount} missedExpected=${h.missedExpectedRouteCount} ambiguityViolations=${h.ambiguousAutoRouteViolationCount} noMatchForced=${h.noMatchForcedRouteViolationCount} confidenceMismatches=${h.confidenceMismatchCount}`,
    'EXECUTION TRUTH',
    `inspected=${report.executionTruth.workflowsInspected} falseStart=${report.executionTruth.falseExecutionStartClaims} falseComplete=${report.executionTruth.falseExecutionCompleteClaims} runningWithoutEvidence=${report.executionTruth.runningWithoutEvidenceViolations} completeWithoutEvidence=${report.executionTruth.completeWithoutEvidenceViolations} total=${report.executionTruth.totalFalseExecutionViolations}`,
    `EXECUTION_TRUTH_GATE=${report.executionTruth.gate} EXECUTION_TRUTH_COVERAGE=${report.executionTruth.coverageStatus}`,
    'KNOWN FAILURES',
    failures,
    `IMPLEMENTATION_VALIDATION=${report.implementationValidation}`,
    `RELEASE_READINESS=${report.releaseReadiness}`
  ].join('\n');
}
