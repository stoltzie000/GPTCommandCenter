import { RegistryFreshness } from './domain.js';

/** Facts returned by an authoritative, configured inventory source. */
export interface DiscoveredSpecialist {
  specialistId?: string;
  displayName: string;
  chatgptUrl?: string;
  description?: string;
  navigationMetadata?: Readonly<Record<string, unknown>>;
  identityKey?: string;
  previousSpecialistId?: string;
}

export interface SpecialistInventoryAvailable {
  status: 'AVAILABLE';
  source: string;
  observedAt: string;
  specialists: readonly DiscoveredSpecialist[];
}

export interface SpecialistInventoryUnavailable {
  status: 'UNAVAILABLE';
  source: string;
  observedAt: string;
  reason: string;
}

export type SpecialistInventoryResult = SpecialistInventoryAvailable | SpecialistInventoryUnavailable;

export interface SpecialistInventoryProvider {
  discover(): Promise<SpecialistInventoryResult>;
}

export class UnavailableSpecialistInventoryProvider implements SpecialistInventoryProvider {
  constructor(private readonly reason = 'NO_SUPPORTED_INVENTORY_PROVIDER') {}

  async discover(): Promise<SpecialistInventoryUnavailable> {
    return { status: 'UNAVAILABLE', source: 'none', observedAt: new Date().toISOString(), reason: this.reason };
  }
}

export function createSpecialistInventoryProvider(provider: 'none'): SpecialistInventoryProvider {
  return new UnavailableSpecialistInventoryProvider();
}

export function inventoryFreshness(result: SpecialistInventoryResult): RegistryFreshness {
  return result.status === 'AVAILABLE' ? 'VERIFIED' : 'UNVERIFIED';
}
