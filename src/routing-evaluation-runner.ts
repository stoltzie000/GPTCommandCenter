import { join } from 'node:path';
import { loadRoutingCorpus } from './routing-evaluation-corpus.js';
import { evaluateCorpora, formatEvaluationReport } from './routing-evaluation.js';

const root = process.cwd();
const curated = await loadRoutingCorpus(join(root, 'tests/fixtures/routing-curated-corpus.json'));
const holdout = await loadRoutingCorpus(join(root, 'tests/fixtures/routing-holdout-corpus.json'));
const report = await evaluateCorpora(curated, holdout);
console.log(formatEvaluationReport(report));
if (report.gates.routingQualityGate !== 'PASS') process.exitCode = 1;
