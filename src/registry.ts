import { Specialist } from './domain.js';
export const registry: Record<string, Specialist> = {
  'architecture-security-advisor': { specialistId:'architecture-security-advisor', displayName:'Architecture & Security Advisor', chatgptUrl:process.env.ARCHITECTURE_SECURITY_CHATGPT_URL, canValidateCodex:true, runtime: process.env.OPENAI_API_KEY ? { status:'ACTIVE', type:'openai_agent', runtimeId:'architecture-security-advisor-api', version:'1.0.0', instructionRef:'specialists/architecture-security-advisor/v1.md', outputSchema:'architecture-output-v1', timeoutSeconds:180, maxAttempts:2 } : { status:'UNVERIFIED', type:'openai_agent', runtimeId:'architecture-security-advisor-api', version:'1.0.0', instructionRef:'specialists/architecture-security-advisor/v1.md', outputSchema:'architecture-output-v1', timeoutSeconds:180, maxAttempts:2 }
  }
};
export function resolveSpecialist(id:string) { return registry[id]; }
