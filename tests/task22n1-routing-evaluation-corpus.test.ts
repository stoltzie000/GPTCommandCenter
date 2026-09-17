import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadRoutingCorpus, selectRoutingCorpusCategory, validateRoutingCorpus, RoutingCorpusValidationError } from '../src/routing-evaluation-corpus.js';
import { registry } from '../src/registry.js';

const fixture = join(process.cwd(), 'tests/fixtures/task22n1-corpus.json');
const base = (expected: unknown, overrides: Record<string, unknown> = {}) => ({schemaVersion:1,id:'case-one',title:'Test case',request:'Review the architecture',expected,category:'CURATED',tags:['clear'],...overrides});
const document = (cases: unknown[]) => ({schemaVersion:1,cases});
const assertInvalid = (value: unknown, pattern: RegExp, approvedRegistry = registry) => assert.throws(() => validateRoutingCorpus(value, approvedRegistry), (error: unknown) => error instanceof RoutingCorpusValidationError && pattern.test(error.message));

test('22N1-01 loads valid corpus with deterministic ordering and no routing execution', async () => {
  const corpus = await loadRoutingCorpus(fixture);
  assert.deepEqual(corpus.cases.map(item => item.id), ['curated-no-match','holdout-specific-owner']);
  assert.equal(corpus.cases[1].expected.outcome, 'SPECIFIC_SPECIALIST');
});

test('22N1-02 validates and preserves a specific approved specialist oracle', () => {
  const corpus = validateRoutingCorpus(document([base({outcome:'SPECIFIC_SPECIALIST',specialistId:'architecture-security-advisor',confidence:'PROBABLE'})]));
  assert.deepEqual(corpus.cases[0].expected,{outcome:'SPECIFIC_SPECIALIST',specialistId:'architecture-security-advisor',confidence:'PROBABLE'});
});

test('22N1-03 validates equivalent sets and rejects duplicates or unknown IDs', () => {
  const approved={...registry,second:{...registry['architecture-security-advisor'],id:'second',specialistId:'second',displayName:'Second'}};
  const valid=validateRoutingCorpus(document([base({outcome:'APPROVED_EQUIVALENT_SET',specialistIds:['architecture-security-advisor','second']})]),approved);
  assert.equal(valid.cases[0].expected.outcome,'APPROVED_EQUIVALENT_SET');
  assert.deepEqual(valid.cases[0].expected.specialistIds,['architecture-security-advisor','second']);
  assertInvalid(document([base({outcome:'APPROVED_EQUIVALENT_SET',specialistIds:['architecture-security-advisor','architecture-security-advisor']})]),/duplicates/);
  assertInvalid(document([base({outcome:'APPROVED_EQUIVALENT_SET',specialistIds:['missing']})]),/unknown specialist/);
});

test('22N1-04 validates an ambiguous oracle without permitting automatic authority', () => {
  const corpus=validateRoutingCorpus(document([base({outcome:'AMBIGUOUS',confidence:'AMBIGUOUS',clarificationRequired:true})]));
  assert.deepEqual(corpus.cases[0].expected,{outcome:'AMBIGUOUS',confidence:'AMBIGUOUS',clarificationRequired:true});
  assertInvalid(document([base({outcome:'AMBIGUOUS',specialistId:'architecture-security-advisor'})]),/cannot require a selected specialist/);
});

test('22N1-05 validates NO_MATCH separately from ambiguity', () => {
  const corpus=validateRoutingCorpus(document([base({outcome:'NO_MATCH',confidence:'NO_MATCH'})]));
  assert.equal(corpus.cases[0].expected.outcome,'NO_MATCH');
  assertInvalid(document([base({outcome:'NO_MATCH',specialistId:'architecture-security-advisor'})]),/cannot require a selected specialist/);
});

test('22N1-06 preserves deterministic CURATED and HOLDOUT category filtering', async () => {
  const corpus=await loadRoutingCorpus(fixture);assert.deepEqual(selectRoutingCorpusCategory(corpus,'CURATED').map(item=>item.id),['curated-no-match']);assert.deepEqual(selectRoutingCorpusCategory(corpus,'HOLDOUT').map(item=>item.id),['holdout-specific-owner']);
});

test('22N1-07 rejects duplicate case IDs', () => {
  assertInvalid(document([base({outcome:'NO_MATCH'}),base({outcome:'NO_MATCH'})]),/id is duplicated/);
});

test('22N1-08 rejects invalid oracle combinations and malformed required fields', () => {
  assertInvalid(document([base({outcome:'SPECIFIC_SPECIALIST'})]),/specialistId is required/);
  assertInvalid(document([base({outcome:'APPROVED_EQUIVALENT_SET',specialistIds:[]})]),/at least one specialist/);
  assertInvalid(document([base({outcome:'NO_MATCH',specialistId:'architecture-security-advisor'})]),/cannot require a selected specialist/);
  assertInvalid(document([base({outcome:'AMBIGUOUS',confidence:'CLEAR'})]),/contradicts|must be AMBIGUOUS/);
  assertInvalid(document([base({outcome:'NO_MATCH',confidence:'CLEAR'})]),/must be NO_MATCH/);
});

test('22N1-09 registry-aware validation rejects unknown and non-approved expected owners', () => {
  assertInvalid(document([base({outcome:'SPECIFIC_SPECIALIST',specialistId:'missing-owner'})]),/unknown specialist/);
  const inactive={...registry,inactive:{...registry['architecture-security-advisor'],id:'inactive',specialistId:'inactive',status:'DEPRECATED' as const}};
  assertInvalid(document([base({outcome:'SPECIFIC_SPECIALIST',specialistId:'inactive'})]),/non-approved specialist/, inactive);
});

test('22N1-10 loading and validation are side-effect free and do not mutate registry', async () => {
  const before=await readFile(fixture,'utf8');const registryBefore=JSON.stringify(registry);const corpus=await loadRoutingCorpus(fixture);assert.ok(corpus.cases.length>0);assert.equal(await readFile(fixture,'utf8'),before);assert.equal(JSON.stringify(registry),registryBefore);
});
