import { createHash } from 'node:crypto';
import { Specialist, SpecialistOrigin, TaskInterpretation } from './domain.js';
import { isCanonicalRoutableSpecialist, registry as builtInRegistry, validateRegistry } from './registry.js';
import { SelectedCandidate } from './domain.js';

export type SpecialistCatalog = Record<string, Specialist>;
export type GapDecision =
  | { kind: 'EXISTING'; specialistId: string }
  | { kind: 'ORCHESTRATE'; specialistIds: string[] }
  | { kind: 'CLARIFY'; reason: string }
  | { kind: 'NO_MATCH'; reason: string }
  | { kind: 'CREATE'; capabilityGap: string };

export function mergeSpecialistCatalog(dynamic: readonly Specialist[] = []): SpecialistCatalog {
  const result: SpecialistCatalog = { ...builtInRegistry };
  for (const specialist of dynamic) {
    if (builtInRegistry[specialist.id]) throw new Error('DYNAMIC_SPECIALIST_COLLIDES_WITH_BUILTIN');
    if (result[specialist.id]) throw new Error('DUPLICATE_DYNAMIC_SPECIALIST');
    result[specialist.id] = specialist;
  }
  validateRegistry(result);
  return result;
}

export function normalizeGap(interpretation: TaskInterpretation): string {
  return [...interpretation.taskCategories, ...interpretation.requiredCapabilities]
    .map(value => value.trim().toLowerCase())
    .filter(Boolean)
    .sort()
    .filter((value, index, values) => values.indexOf(value) === index)
    .join('|');
}

export function dynamicSpecialistId(interpretation: TaskInterpretation): string {
  const digest = createHash('sha256').update(normalizeGap(interpretation)).digest('hex').slice(0, 20);
  return `dynamic-${digest}`;
}

export function assessSpecialistCoverage(interpretation: TaskInterpretation, candidates: readonly SelectedCandidate[]): GapDecision {
  if (interpretation.explicitSpecialistRequest && candidates.length === 0) return { kind: 'NO_MATCH', reason: 'The requested specialist is not available in the effective catalog.' };
  if (!interpretation.requiredCapabilities.length && !interpretation.taskCategories.length) return { kind: 'CLARIFY', reason: 'The task does not identify a stable capability gap.' };
  if (candidates.length === 1) return { kind: 'EXISTING', specialistId: candidates[0].specialistId };
  if (candidates.length > 1) {
    const covered = new Set(candidates.flatMap(candidate => candidate.evidence.capabilityMatches));
    const needed = new Set(interpretation.requiredCapabilities.map(value => value.toLowerCase()));
    if (needed.size > 1 && [...needed].every(value => covered.has(value) || [...covered].some(item => item.includes(value) || value.includes(item)))) {
      return { kind: 'ORCHESTRATE', specialistIds: candidates.slice(0, 3).map(candidate => candidate.specialistId) };
    }
    return { kind: 'CLARIFY', reason: 'Multiple existing specialists have materially comparable ownership evidence.' };
  }
  return { kind: 'CREATE', capabilityGap: normalizeGap(interpretation) || interpretation.intent.slice(0, 240) };
}

export function buildDynamicSpecialist(interpretation: TaskInterpretation, sourceWorkflowId: string): Specialist {
  const id = dynamicSpecialistId(interpretation);
  const ownership = interpretation.taskCategories.length ? interpretation.taskCategories : [interpretation.intent.slice(0, 120)];
  const capabilities = interpretation.requiredCapabilities.length ? interpretation.requiredCapabilities : ownership;
  return {
    id, specialistId: id, displayName: `Specialist: ${ownership[0]}`,
    description: `Dynamically created specialist for ${ownership.join(', ')}.`,
    primaryOwnership: ownership, capabilities, exclusions: [], overlapsWith: [],
    upstreamSpecialists: [], downstreamSpecialists: [], status: 'ACTIVE', runtimeStatus: 'UNVERIFIED',
    runtimeId: null, registryVersion: '1.0.0', lastReviewedAt: new Date().toISOString(),
    canValidateCodex: false, role: 'ROUTABLE_SPECIALIST', canonical: true, routingApproved: true,
    origin: 'DYNAMIC' satisfies SpecialistOrigin, createdAt: new Date().toISOString(),
    creationProvenance: { sourceWorkflowId, capabilityGap: normalizeGap(interpretation), creationMechanism: 'GAP_DRIVEN', humanApproved: false }
  };
}

export function assertCatalogSpecialist(catalog: SpecialistCatalog, id: string): Specialist {
  const specialist = catalog[id];
  if (!isCanonicalRoutableSpecialist(specialist)) throw new Error('INVALID_ROUTING_TARGET');
  return specialist;
}
