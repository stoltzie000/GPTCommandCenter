import { Specialist, RUNTIME_STATUSES, SPECIALIST_STATUSES } from './domain.js';
export const registry: Record<string, Specialist> = {
  'architecture-security-advisor': { id:'architecture-security-advisor', specialistId:'architecture-security-advisor', displayName:'Architecture & Security Advisor', description:'The currently configured architecture and security specialist.', primaryOwnership:['architecture-security-advisor'], capabilities:['architecture review','security review'], exclusions:[], overlapsWith:[], upstreamSpecialists:[], downstreamSpecialists:[], status:'ACTIVE', runtimeStatus:process.env.OPENAI_API_KEY?'ACTIVE':'UNVERIFIED', runtimeId:'architecture-security-advisor-api', registryVersion:'1.0.0', lastReviewedAt:'2026-09-11T00:00:00.000Z', chatgptUrl:process.env.ARCHITECTURE_SECURITY_CHATGPT_URL, canValidateCodex:true, runtime: process.env.OPENAI_API_KEY ? { status:'ACTIVE', type:'openai_agent', runtimeId:'architecture-security-advisor-api', version:'1.0.0', instructionRef:'specialists/architecture-security-advisor/v1.md', outputSchema:'architecture-output-v1', timeoutSeconds:180, maxAttempts:2 } : { status:'UNVERIFIED', type:'openai_agent', runtimeId:'architecture-security-advisor-api', version:'1.0.0', instructionRef:'specialists/architecture-security-advisor/v1.md', outputSchema:'architecture-output-v1', timeoutSeconds:180, maxAttempts:2 }
  }
};
export function resolveSpecialist(id:string) { return registry[id]; }

const textArrayFields = ['primaryOwnership','capabilities','exclusions'] as const;
const isText = (value:unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isIsoDate = (value:unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && !Number.isNaN(Date.parse(value));

export function validateRegistry(input: Record<string, Specialist>): void {
  const entries = Object.entries(input);
  const ids = new Set<string>();
  const runtimeIds = new Set<string>();
  for (const [key, specialist] of entries) {
    if (!specialist || key !== specialist.id || !isText(specialist.id) || ids.has(specialist.id)) throw new Error('INVALID_REGISTRY_DUPLICATE_SPECIALIST_ID');
    ids.add(specialist.id);
    if (!isText(specialist.displayName) || !isText(specialist.description)) throw new Error('INVALID_SPECIALIST_METADATA');
    if (!(SPECIALIST_STATUSES as readonly string[]).includes(specialist.status)) throw new Error('INVALID_SPECIALIST_STATUS');
    if (!(RUNTIME_STATUSES as readonly string[]).includes(specialist.runtimeStatus)) throw new Error('INVALID_RUNTIME_STATUS');
    if (!/^\d+(?:\.\d+){1,2}$/.test(specialist.registryVersion)) throw new Error('INVALID_REGISTRY_VERSION');
    if (!isIsoDate(specialist.lastReviewedAt)) throw new Error('INVALID_LAST_REVIEWED_AT');
    for (const field of textArrayFields) {
      if (!Array.isArray(specialist[field]) || specialist[field].some(value => !isText(value)) || new Set(specialist[field]).size !== specialist[field].length) throw new Error(`INVALID_${field.toUpperCase()}`);
    }
    for (const field of ['overlapsWith','upstreamSpecialists','downstreamSpecialists'] as const) {
      const values = specialist[field];
      if (!Array.isArray(values) || values.some(value => !isText(value)) || new Set(values).size !== values.length) throw new Error(`INVALID_${field.toUpperCase()}`);
      if (values.includes(specialist.id)) throw new Error(`INVALID_SELF_REFERENCE_${field.toUpperCase()}`);
    }
    if (specialist.status === 'ACTIVE' && specialist.primaryOwnership.length === 0) throw new Error('ACTIVE_SPECIALIST_REQUIRES_PRIMARY_OWNERSHIP');
    if (specialist.runtimeId !== null) {
      if (!isText(specialist.runtimeId) || runtimeIds.has(specialist.runtimeId)) throw new Error('INVALID_DUPLICATE_RUNTIME_ID');
      runtimeIds.add(specialist.runtimeId);
      if (!specialist.runtime || specialist.runtime.runtimeId !== specialist.runtimeId) throw new Error('RUNTIME_ID_MISMATCH');
    }
  }
  for (const specialist of Object.values(input)) for (const field of ['overlapsWith','upstreamSpecialists','downstreamSpecialists'] as const) for (const ref of specialist[field]) if (!ids.has(ref)) throw new Error('INVALID_SPECIALIST_REFERENCE');
}

validateRegistry(registry);
