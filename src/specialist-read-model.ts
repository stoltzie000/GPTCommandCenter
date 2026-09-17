import { Specialist, RuntimeStatus } from './domain.js';

export interface SpecialistReadModel {
  id: string;
  displayName: string;
  description: string;
  ownership: string[];
  capabilities: string[];
  exclusions: string[];
  routingEligible: boolean;
  runtime: {
    status: RuntimeStatus;
    executable: boolean;
  };
  manualHandoff: {
    available: boolean;
    navigationUrl?: string;
  };
}

export function readSpecialist(specialist: Specialist): SpecialistReadModel {
  const runtimeStatus = specialist.runtime?.status ?? specialist.runtimeStatus;
  const manualHandoffAvailable = runtimeStatus === 'MANUAL_ONLY' && typeof specialist.chatgptUrl === 'string' && specialist.chatgptUrl.length > 0;
  return {
    id: specialist.specialistId,
    displayName: specialist.displayName,
    description: specialist.description,
    ownership: [...specialist.primaryOwnership],
    capabilities: [...specialist.capabilities],
    exclusions: [...specialist.exclusions],
    routingEligible: specialist.status === 'ACTIVE' && specialist.primaryOwnership.length > 0,
    runtime: {
      status: runtimeStatus,
      executable: specialist.status === 'ACTIVE' && runtimeStatus === 'ACTIVE' && specialist.runtime?.status === 'ACTIVE'
    },
    manualHandoff: {
      available: manualHandoffAvailable,
      ...(manualHandoffAvailable ? {navigationUrl: specialist.chatgptUrl} : {})
    }
  };
}

export function readSpecialists(source: Record<string, Specialist>): SpecialistReadModel[] {
  return Object.values(source)
    .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.specialistId.localeCompare(b.specialistId))
    .map(readSpecialist);
}
