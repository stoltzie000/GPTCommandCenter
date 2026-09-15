import { RegistryFreshness, RegistryReconciliationStatus, Runtime, RuntimeStatus } from './domain.js';
import { DiscoveredSpecialist, SpecialistInventoryProvider, SpecialistInventoryResult } from './specialist-inventory.js';

export interface ApprovedRegistrySpecialist {
  specialistId: string;
  displayName: string;
  chatgptUrl?: string;
  runtime?: Runtime;
  inventoryIdentity?: string;
}

export interface ReconciliationOutcome {
  status: RegistryReconciliationStatus;
  specialistId?: string;
  approvedSpecialistId?: string;
  discovered?: DiscoveredSpecialist;
  routable: boolean;
  ownership: 'ASSIGNED'|'UNASSIGNED';
  capabilities: 'VERIFIED'|'UNVERIFIED';
  exclusions: 'VERIFIED'|'UNVERIFIED';
  runtime: RuntimeStatus;
  reviewRequired: boolean;
}

export interface RegistryReconciliation {
  freshness: RegistryFreshness;
  outcomes: readonly ReconciliationOutcome[];
  approvedRegistryChanged: false;
  approvedRegistrySnapshot: Readonly<Record<string, ApprovedRegistrySpecialist>>;
}

const normalized = (value: string) => value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
const sameMetadata = (approved: ApprovedRegistrySpecialist, discovered: DiscoveredSpecialist) =>
  approved.displayName === discovered.displayName && approved.chatgptUrl === discovered.chatgptUrl;
const unreviewed = (status: RegistryReconciliationStatus, discovered: DiscoveredSpecialist, approvedSpecialistId?: string): ReconciliationOutcome => ({
  status, specialistId: discovered.specialistId, approvedSpecialistId, discovered,
  routable: false, ownership: 'UNASSIGNED', capabilities: 'UNVERIFIED', exclusions: 'UNVERIFIED', runtime: 'UNVERIFIED', reviewRequired: true
});

export function reconcileRegistry(approvedRegistry: Readonly<Record<string, ApprovedRegistrySpecialist>>, inventory: SpecialistInventoryResult): RegistryReconciliation {
  const snapshot = Object.freeze(Object.fromEntries(Object.entries(approvedRegistry).map(([id, specialist]) => [id, Object.freeze({ ...specialist, runtime: specialist.runtime && Object.freeze({ ...specialist.runtime }) })])));
  if (inventory.status === 'UNAVAILABLE') return {
    freshness: 'UNVERIFIED',
    outcomes: [{ status: 'PROVIDER_UNAVAILABLE', routable: false, ownership: 'UNASSIGNED', capabilities: 'UNVERIFIED', exclusions: 'UNVERIFIED', runtime: 'UNVERIFIED', reviewRequired: true }],
    approvedRegistryChanged: false,
    approvedRegistrySnapshot: snapshot
  };

  const discovered = inventory.specialists;
  const idCounts = new Map<string, number>();
  const nameCounts = new Map<string, number>();
  for (const item of discovered) {
    if (item.specialistId) idCounts.set(item.specialistId, (idCounts.get(item.specialistId) ?? 0) + 1);
    nameCounts.set(normalized(item.displayName), (nameCounts.get(normalized(item.displayName)) ?? 0) + 1);
  }
  const outcomes: ReconciliationOutcome[] = [];
  const seenApproved = new Set<string>();
  for (const item of discovered) {
    const duplicate = (item.specialistId && (idCounts.get(item.specialistId) ?? 0) > 1) || (nameCounts.get(normalized(item.displayName)) ?? 0) > 1;
    const approved = item.specialistId ? approvedRegistry[item.specialistId] : undefined;
    if (duplicate) outcomes.push(unreviewed('DUPLICATE_OR_AMBIGUOUS', item, approved?.specialistId));
    else if (approved) {
      seenApproved.add(approved.specialistId);
      outcomes.push({ status: sameMetadata(approved, item) ? 'MATCHED' : 'METADATA_CHANGED', specialistId: approved.specialistId, approvedSpecialistId: approved.specialistId, discovered: item, routable: approved.runtime?.status === 'ACTIVE', ownership: 'ASSIGNED', capabilities: 'VERIFIED', exclusions: 'VERIFIED', runtime: approved.runtime?.status ?? 'UNVERIFIED', reviewRequired: false });
    } else {
      const possible = Object.values(approvedRegistry).find(candidate =>
        (item.previousSpecialistId && candidate.specialistId === item.previousSpecialistId) ||
        (item.identityKey && candidate.inventoryIdentity === item.identityKey) ||
        (item.chatgptUrl && candidate.chatgptUrl === item.chatgptUrl));
      outcomes.push(unreviewed(possible ? 'POSSIBLE_RENAME' : 'NEW_UNREVIEWED', item, possible?.specialistId));
    }
  }
  for (const approved of Object.values(approvedRegistry)) if (!seenApproved.has(approved.specialistId)) outcomes.push({ status: 'MISSING_FROM_INVENTORY', specialistId: approved.specialistId, approvedSpecialistId: approved.specialistId, routable: approved.runtime?.status === 'ACTIVE', ownership: 'ASSIGNED', capabilities: 'VERIFIED', exclusions: 'VERIFIED', runtime: approved.runtime?.status ?? 'UNVERIFIED', reviewRequired: false });
  return { freshness: 'VERIFIED', outcomes, approvedRegistryChanged: false, approvedRegistrySnapshot: snapshot };
}

export async function reconcileSpecialistInventory(provider: SpecialistInventoryProvider, approvedRegistry: Readonly<Record<string, ApprovedRegistrySpecialist>>): Promise<RegistryReconciliation> {
  try { return reconcileRegistry(approvedRegistry, await provider.discover()); }
  catch (error) { return reconcileRegistry(approvedRegistry, { status: 'UNAVAILABLE', source: 'provider', observedAt: new Date().toISOString(), reason: error instanceof Error ? error.message : 'INVENTORY_PROVIDER_FAILED' }); }
}

export interface PublicRegistryReconciliationStatus {
  freshness: RegistryFreshness;
  approvedRegistryChanged: false;
  outcomes: readonly {
    status: RegistryReconciliationStatus;
    specialistId?: string;
    approvedSpecialistId?: string;
    routable: boolean;
    runtime: RuntimeStatus;
    reviewRequired: boolean;
  }[];
}

export function publicRegistryReconciliationStatus(
  reconciliation: RegistryReconciliation
): PublicRegistryReconciliationStatus {
  return {
    freshness: reconciliation.freshness,
    approvedRegistryChanged: reconciliation.approvedRegistryChanged,
    outcomes: reconciliation.outcomes.map(outcome => ({
      status: outcome.status,
      specialistId: outcome.specialistId,
      approvedSpecialistId: outcome.approvedSpecialistId,
      routable: outcome.routable,
      runtime: outcome.runtime,
      reviewRequired: outcome.reviewRequired
    }))
  };
}
