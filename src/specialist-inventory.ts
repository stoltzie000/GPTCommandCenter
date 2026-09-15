import { readFile } from 'node:fs/promises';
import { RegistryFreshness } from './domain.js';

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

export type SpecialistInventoryResult =
  | SpecialistInventoryAvailable
  | SpecialistInventoryUnavailable;

export interface SpecialistInventoryProvider {
  discover(): Promise<SpecialistInventoryResult>;
}

export class UnavailableSpecialistInventoryProvider
  implements SpecialistInventoryProvider {
  constructor(private readonly reason = 'NO_SUPPORTED_INVENTORY_PROVIDER') {}

  async discover(): Promise<SpecialistInventoryUnavailable> {
    return {
      status: 'UNAVAILABLE',
      source: 'none',
      observedAt: new Date().toISOString(),
      reason: this.reason
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseSpecialist(value: unknown): DiscoveredSpecialist {
  if (!isRecord(value) ||
      typeof value.displayName !== 'string' ||
      !value.displayName.trim()) {
    throw new Error('INVALID_SPECIALIST_INVENTORY');
  }

  const optionalStrings = [
    'specialistId',
    'chatgptUrl',
    'description',
    'identityKey',
    'previousSpecialistId'
  ] as const;

  for (const key of optionalStrings) {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
      throw new Error('INVALID_SPECIALIST_INVENTORY');
    }
  }

  if (value.navigationMetadata !== undefined &&
      !isRecord(value.navigationMetadata)) {
    throw new Error('INVALID_SPECIALIST_INVENTORY');
  }

  return {
    specialistId: value.specialistId as string | undefined,
    displayName: value.displayName.trim(),
    chatgptUrl: value.chatgptUrl as string | undefined,
    description: value.description as string | undefined,
    navigationMetadata:
      value.navigationMetadata as Readonly<Record<string, unknown>> | undefined,
    identityKey: value.identityKey as string | undefined,
    previousSpecialistId: value.previousSpecialistId as string | undefined
  };
}

export class FileSpecialistInventoryProvider
  implements SpecialistInventoryProvider {
  constructor(private readonly path: string) {}

  async discover(): Promise<SpecialistInventoryResult> {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed: unknown = JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        throw new Error('INVALID_SPECIALIST_INVENTORY');
      }

      const specialists = parsed.map(parseSpecialist);

      return {
        status: 'AVAILABLE',
        source: `file:${this.path}`,
        observedAt: new Date().toISOString(),
        specialists
      };
    } catch (error) {
      return {
        status: 'UNAVAILABLE',
        source: `file:${this.path}`,
        observedAt: new Date().toISOString(),
        reason:
          error instanceof Error
            ? error.message
            : 'SPECIALIST_INVENTORY_READ_FAILED'
      };
    }
  }
}

export function createSpecialistInventoryProvider(
  provider: 'none' | 'file',
  filePath?: string
): SpecialistInventoryProvider {
  if (provider === 'file') {
    if (!filePath) {
      return new UnavailableSpecialistInventoryProvider(
        'SPECIALIST_INVENTORY_FILE_REQUIRED'
      );
    }
    return new FileSpecialistInventoryProvider(filePath);
  }

  return new UnavailableSpecialistInventoryProvider();
}

export function inventoryFreshness(
  result: SpecialistInventoryResult
): RegistryFreshness {
  return result.status === 'AVAILABLE' ? 'VERIFIED' : 'UNVERIFIED';
}
