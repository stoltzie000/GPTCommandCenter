import { readFile } from 'node:fs/promises';
import { RoutingConfidence, Specialist, ROUTING_CONFIDENCES } from './domain.js';
import { registry as canonicalRegistry } from './registry.js';

export const ROUTING_CORPUS_SCHEMA_VERSION = 1 as const;
export const ROUTING_CORPUS_CATEGORIES = ['CURATED', 'HOLDOUT'] as const;
export type RoutingCorpusCategory = typeof ROUTING_CORPUS_CATEGORIES[number];

export type ExpectedRoutingOutcome =
  | { outcome: 'SPECIFIC_SPECIALIST'; specialistId: string; confidence?: Exclude<RoutingConfidence, 'AMBIGUOUS'|'NO_MATCH'> }
  | { outcome: 'APPROVED_EQUIVALENT_SET'; specialistIds: string[]; confidence?: Exclude<RoutingConfidence, 'AMBIGUOUS'|'NO_MATCH'> }
  | { outcome: 'AMBIGUOUS'; confidence?: 'AMBIGUOUS'; clarificationRequired?: true }
  | { outcome: 'NO_MATCH'; confidence?: 'NO_MATCH' };

export interface RoutingEvaluationCase {
  schemaVersion: typeof ROUTING_CORPUS_SCHEMA_VERSION;
  id: string;
  title: string;
  request: string;
  expected: ExpectedRoutingOutcome;
  category: RoutingCorpusCategory;
  tags: string[];
  notes?: string;
}

export interface RoutingEvaluationCorpus {
  schemaVersion: typeof ROUTING_CORPUS_SCHEMA_VERSION;
  cases: RoutingEvaluationCase[];
}

export class RoutingCorpusValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'RoutingCorpusValidationError'; }
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isConfidence = (value: unknown): value is RoutingConfidence => (ROUTING_CONFIDENCES as readonly string[]).includes(value as string);
const caseError = (id: unknown, field: string, reason: string) => new RoutingCorpusValidationError(`case ${typeof id === 'string' && id ? id : '<unknown>'}: ${field} ${reason}`);
const assertKeys = (value: Record<string, unknown>, allowed: readonly string[], id: unknown, field: string) => {
  const unexpected = Object.keys(value).find(key => !allowed.includes(key));
  if (unexpected) throw caseError(id, field, `contains unsupported field ${unexpected}`);
};

function validateExpected(value: unknown, id: unknown): ExpectedRoutingOutcome {
  if (!isRecord(value)) throw caseError(id, 'expected', 'must be an object');
  if (typeof value.outcome !== 'string') throw caseError(id, 'expected.outcome', 'is required');
  if (value.confidence !== undefined && !isConfidence(value.confidence)) throw caseError(id, 'expected.confidence', 'must be a known routing confidence');
  switch (value.outcome) {
    case 'SPECIFIC_SPECIALIST':
      assertKeys(value, ['outcome', 'specialistId', 'confidence'], id, 'expected');
      if (!isText(value.specialistId)) throw caseError(id, 'expected.specialistId', 'is required for SPECIFIC_SPECIALIST');
      if (value.confidence === 'AMBIGUOUS' || value.confidence === 'NO_MATCH') throw caseError(id, 'expected.confidence', 'contradicts SPECIFIC_SPECIALIST');
      return { outcome: value.outcome, specialistId: value.specialistId.trim(), ...(value.confidence ? {confidence: value.confidence} : {}) };
    case 'APPROVED_EQUIVALENT_SET':
      assertKeys(value, ['outcome', 'specialistIds', 'confidence'], id, 'expected');
      if (!Array.isArray(value.specialistIds) || value.specialistIds.length === 0) throw caseError(id, 'expected.specialistIds', 'requires at least one specialist');
      if (value.specialistIds.some(item => !isText(item))) throw caseError(id, 'expected.specialistIds', 'must contain only non-empty strings');
      const specialistIds = value.specialistIds.map(item => (item as string).trim());
      if (new Set(specialistIds).size !== specialistIds.length) throw caseError(id, 'expected.specialistIds', 'must not contain duplicates');
      if (value.confidence === 'AMBIGUOUS' || value.confidence === 'NO_MATCH') throw caseError(id, 'expected.confidence', 'contradicts APPROVED_EQUIVALENT_SET');
      return { outcome: value.outcome, specialistIds, ...(value.confidence ? {confidence: value.confidence} : {}) };
    case 'AMBIGUOUS':
      assertKeys(value, ['outcome', 'confidence', 'clarificationRequired', 'specialistId', 'specialistIds'], id, 'expected');
      if (value.specialistId !== undefined || value.specialistIds !== undefined) throw caseError(id, 'expected', 'AMBIGUOUS cannot require a selected specialist');
      if (value.confidence !== undefined && value.confidence !== 'AMBIGUOUS') throw caseError(id, 'expected.confidence', 'must be AMBIGUOUS for an AMBIGUOUS oracle');
      if (value.clarificationRequired === false) throw caseError(id, 'expected.clarificationRequired', 'cannot be false for an AMBIGUOUS oracle');
      return { outcome: value.outcome, ...(value.confidence ? {confidence: value.confidence} : {}), ...(value.clarificationRequired ? {clarificationRequired: true} : {}) };
    case 'NO_MATCH':
      assertKeys(value, ['outcome', 'confidence', 'specialistId', 'specialistIds'], id, 'expected');
      if (value.specialistId !== undefined || value.specialistIds !== undefined) throw caseError(id, 'expected', 'NO_MATCH cannot require a selected specialist');
      if (value.confidence !== undefined && value.confidence !== 'NO_MATCH') throw caseError(id, 'expected.confidence', 'must be NO_MATCH for a NO_MATCH oracle');
      return { outcome: value.outcome, ...(value.confidence ? {confidence: value.confidence} : {}) };
    default:
      throw caseError(id, 'expected.outcome', `has unknown outcome ${value.outcome}`);
  }
}

function validateCase(value: unknown, index: number, approvedRegistry: Readonly<Record<string, Specialist>>): RoutingEvaluationCase {
  if (!isRecord(value)) throw caseError(`index-${index}`, 'case', 'must be an object');
  const id = value.id;
  if (!isText(id) || !/^[a-z0-9][a-z0-9._-]*$/.test(id)) throw caseError(id, 'id', 'must be a non-empty lowercase identifier');
  assertKeys(value, ['schemaVersion', 'id', 'title', 'request', 'expected', 'category', 'tags', 'notes'], id, 'case');
  if (value.schemaVersion !== ROUTING_CORPUS_SCHEMA_VERSION) throw caseError(id, 'schemaVersion', `must equal ${ROUTING_CORPUS_SCHEMA_VERSION}`);
  if (!isText(value.title)) throw caseError(id, 'title', 'must be non-empty');
  if (!isText(value.request)) throw caseError(id, 'request', 'must be non-empty');
  if (!(ROUTING_CORPUS_CATEGORIES as readonly string[]).includes(value.category as string)) throw caseError(id, 'category', 'must be CURATED or HOLDOUT');
  if (!Array.isArray(value.tags) || value.tags.some(tag => !isText(tag)) || new Set(value.tags).size !== value.tags.length) throw caseError(id, 'tags', 'must be a unique array of non-empty strings');
  if (value.notes !== undefined && typeof value.notes !== 'string') throw caseError(id, 'notes', 'must be a string');
  const expected = validateExpected(value.expected, id);
  const expectedIds = expected.outcome === 'SPECIFIC_SPECIALIST' ? [expected.specialistId] : expected.outcome === 'APPROVED_EQUIVALENT_SET' ? expected.specialistIds : [];
  for (const specialistId of expectedIds) {
    const specialist = approvedRegistry[specialistId];
    if (!specialist) throw caseError(id, 'expected specialistId', `references unknown specialist ${specialistId}`);
    if (specialist.status !== 'ACTIVE') throw caseError(id, 'expected specialistId', `references non-approved specialist ${specialistId}`);
  }
  return {schemaVersion: ROUTING_CORPUS_SCHEMA_VERSION,id,title:value.title.trim(),request:value.request.trim(),expected,category:value.category as RoutingCorpusCategory,tags:value.tags.map(tag => (tag as string).trim()),...(value.notes !== undefined ? {notes:value.notes} : {})};
}

export function validateRoutingCorpus(value: unknown, approvedRegistry: Readonly<Record<string, Specialist>> = canonicalRegistry): RoutingEvaluationCorpus {
  if (!isRecord(value)) throw new RoutingCorpusValidationError('corpus: document must be an object');
  assertKeys(value, ['schemaVersion', 'cases'], '<document>', 'corpus');
  if (value.schemaVersion !== ROUTING_CORPUS_SCHEMA_VERSION) throw new RoutingCorpusValidationError(`corpus: schemaVersion must equal ${ROUTING_CORPUS_SCHEMA_VERSION}`);
  if (!Array.isArray(value.cases)) throw new RoutingCorpusValidationError('corpus: cases must be an array');
  const cases = value.cases.map((item, index) => validateCase(item, index, approvedRegistry));
  const ids = new Set<string>();
  for (const item of cases) { if (ids.has(item.id)) throw caseError(item.id, 'id', 'is duplicated'); ids.add(item.id); }
  cases.sort((a, b) => a.id.localeCompare(b.id));
  return {schemaVersion: ROUTING_CORPUS_SCHEMA_VERSION, cases};
}

export async function loadRoutingCorpus(path: string, approvedRegistry: Readonly<Record<string, Specialist>> = canonicalRegistry): Promise<RoutingEvaluationCorpus> {
  if (!isText(path)) throw new RoutingCorpusValidationError('corpus source: path must be non-empty');
  let parsed: unknown;
  try { parsed = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { throw new RoutingCorpusValidationError(`corpus source ${path}: could not parse JSON (${error instanceof Error ? error.message : 'invalid JSON'})`); }
  return validateRoutingCorpus(parsed, approvedRegistry);
}

export function selectRoutingCorpusCategory(corpus: RoutingEvaluationCorpus, category: RoutingCorpusCategory): RoutingEvaluationCase[] {
  return corpus.cases.filter(item => item.category === category).map(item => ({...item, tags:[...item.tags]}));
}
