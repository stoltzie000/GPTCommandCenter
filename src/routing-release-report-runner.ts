import { join } from 'node:path';
import { loadRoutingCorpus } from './routing-evaluation-corpus.js';
import { evaluateCorpora } from './routing-evaluation.js';
import { collectExecutionTruthMetrics, collectRoutingMetrics } from './routing-execution-metrics.js';
import { buildRoutingReleaseReport, releaseReportExitCode, renderRoutingReleaseReport, serializeRoutingReleaseReport } from './routing-release-report.js';

try {
  const root = process.cwd();
  const curated = await loadRoutingCorpus(join(root, 'tests/fixtures/routing-curated-corpus.json'));
  const holdout = await loadRoutingCorpus(join(root, 'tests/fixtures/routing-holdout-corpus.json'));
  const evaluation = await evaluateCorpora(curated, holdout);
  const curatedMetrics = collectRoutingMetrics(evaluation.curated.results, 'CURATED');
  const holdoutMetrics = collectRoutingMetrics(evaluation.holdout.results, 'HOLDOUT');
  const executionTruth = collectExecutionTruthMetrics([]);
  const report = buildRoutingReleaseReport(evaluation, curatedMetrics, holdoutMetrics, executionTruth);
  const output = process.argv.includes('--json') ? serializeRoutingReleaseReport(report) : renderRoutingReleaseReport(report);
  await new Promise<void>((resolve, reject) => process.stdout.write(`${output}\n`, error => error ? reject(error) : resolve()));
  process.exitCode = releaseReportExitCode(report.releaseReadiness);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
