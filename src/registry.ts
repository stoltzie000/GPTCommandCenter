import { Specialist, RUNTIME_STATUSES, SPECIALIST_ROLES, SPECIALIST_STATUSES, SpecialistRole } from './domain.js';

const reviewedAt = '2026-09-11T00:00:00.000Z';
const noRuntime = (role: SpecialistRole, primaryOwnership: string[], capabilities: string[], routingApproved = true): Specialist => ({
  id: '', specialistId: '', displayName: '', description: '', primaryOwnership, capabilities,
  exclusions: [], overlapsWith: [], upstreamSpecialists: [], downstreamSpecialists: [],
  status: role === 'UNKNOWN_PENDING_REVIEW' ? 'INACTIVE' : 'ACTIVE', runtimeStatus: 'UNVERIFIED',
  runtimeId: null, registryVersion: '1.0.0', lastReviewedAt: reviewedAt, canValidateCodex: false,
  role, canonical: true, routingApproved
});
const entry = (id: string, displayName: string, description: string, role: SpecialistRole, ownership: string[], capabilities: string[], routingApproved = true): Specialist => ({
  ...noRuntime(role, ownership, capabilities, routingApproved), id, specialistId: id, displayName, description
});

const architectureRuntime = process.env.OPENAI_API_KEY ? { status:'ACTIVE' as const, type:'openai_agent' as const, runtimeId:'architecture-security-advisor-api', version:'1.0.0', instructionRef:'specialists/architecture-security-advisor/v1.md', outputSchema:'architecture-output-v1', timeoutSeconds:180, maxAttempts:2 } : { status:'UNVERIFIED' as const, type:'openai_agent' as const, runtimeId:'architecture-security-advisor-api', version:'1.0.0', instructionRef:'specialists/architecture-security-advisor/v1.md', outputSchema:'architecture-output-v1', timeoutSeconds:180, maxAttempts:2 };

export const registry: Record<string, Specialist> = {
  'gpt-command-center': entry('gpt-command-center', 'GPT Command Center', 'Orchestration, request intake, routing coordination, workflow coordination, and GPT ecosystem audit.', 'ORCHESTRATOR', ['orchestration','request intake','routing coordination','workflow coordination','GPT ecosystem audit'], ['orchestration','routing coordination'], false),
  'node-link-graph-architect': entry('node-link-graph-architect', 'Node-Link Graph Architect', 'Node-link and graph-system design specialist.', 'ROUTABLE_SPECIALIST', ['graph design','graph system design'], ['graph design','graph-system design']),
  'resume-gatekeeper': entry('resume-gatekeeper', 'Resume Gatekeeper', 'Resume and job-application materials specialist.', 'ROUTABLE_SPECIALIST', ['resume','job application materials'], ['resume review','job application materials']),
  'tuner-pro-oracle': entry('tuner-pro-oracle', 'Tuner Pro Oracle', 'TunerPro-related specialist.', 'ROUTABLE_SPECIALIST', ['tunerpro'], ['tunerpro']),
  'business-idea-validator': entry('business-idea-validator', 'Business Idea Validator', 'Business idea validation specialist.', 'ROUTABLE_SPECIALIST', ['business idea validation'], ['business idea validation']),
  'logic-machine': entry('logic-machine', 'Logic Machine', 'Formal reasoning and logical consistency specialist.', 'ROUTABLE_SPECIALIST', ['formal reasoning','logical consistency'], ['formal reasoning','logical consistency']),
  'architecture-security-advisor': { ...entry('architecture-security-advisor', 'Architecture & Security Advisor', 'The currently configured architecture and security specialist.', 'ROUTABLE_SPECIALIST', ['architecture'], ['architecture review','security review']), primaryOwnership:['architecture-security-advisor'], canValidateCodex:true, runtimeStatus:architectureRuntime.status, runtimeId:architectureRuntime.runtimeId, runtime:architectureRuntime, chatgptUrl:process.env.ARCHITECTURE_SECURITY_CHATGPT_URL },
  'project-folder-forge': entry('project-folder-forge', 'Project Folder Forge', 'ChatGPT Project setup and project/folder structure utility.', 'BUILDER_OR_WORKFLOW_UTILITY', ['project folder structure','ChatGPT Project setup'], ['project structure','folder structure']),
  'github-oracle': entry('github-oracle', 'GitHub Oracle', 'GitHub repository, pull request, and CI specialist.', 'ROUTABLE_SPECIALIST', ['GitHub repositories','pull requests','CI workflows'], ['repository analysis','GitHub workflows']),
  'python-oracle': entry('python-oracle', 'Python Oracle', 'Python engineering specialist.', 'ROUTABLE_SPECIALIST', ['Python engineering'], ['Python engineering']),
  'military-job-school-finder': entry('military-job-school-finder', 'Military Job & School Finder', 'Military jobs and schools lookup specialist.', 'ROUTABLE_SPECIALIST', ['military jobs and schools'], ['military lookup']),
  'windows-senior-support-engineer': entry('windows-senior-support-engineer', 'Windows Senior Support Engineer', 'Windows troubleshooting and support specialist.', 'ROUTABLE_SPECIALIST', ['Windows troubleshooting'], ['Windows support']),
  'senior-software-project-manager': entry('senior-software-project-manager', 'Senior Software Project Manager', 'Software delivery planning and project-management specialist.', 'ROUTABLE_SPECIALIST', ['software delivery planning','project management'], ['software project management']),
  'everyday-nutritionist': entry('everyday-nutritionist', 'Everyday Nutritionist', 'Nutrition planning specialist.', 'ROUTABLE_SPECIALIST', ['nutrition planning'], ['nutrition planning']),
  'csharp-quant-engine': entry('csharp-quant-engine', 'C# Quant Engine', 'Quantitative analysis and implementation in C#/.NET specialist.', 'ROUTABLE_SPECIALIST', ['C#/.NET quantitative analysis'], ['quantitative C# implementation']),
  'local-ai-qa-repair-lab': entry('local-ai-qa-repair-lab', 'Local AI QA & Repair Lab', 'Local AI evaluation, QA, and repair specialist.', 'ROUTABLE_SPECIALIST', ['local AI evaluation','local AI QA','AI repair'], ['local AI evaluation','AI QA']),
  'product-definition-forge': entry('product-definition-forge', 'Product Definition Forge', 'Product definition, requirements, and scope specialist.', 'ROUTABLE_SPECIALIST', ['product definition','product requirements'], ['product scope','requirements']),
  'mvp-forge': entry('mvp-forge', 'MVP Forge', 'MVP specification and build-planning specialist.', 'ROUTABLE_SPECIALIST', ['MVP definition','MVP build planning'], ['MVP specification','build planning']),
  'travel-agent': entry('travel-agent', 'Travel Agent', 'Travel and lodging specialist.', 'ROUTABLE_SPECIALIST', ['travel and lodging'], ['travel planning']),
  'vehicle-repair-assistant': entry('vehicle-repair-assistant', 'Vehicle Repair Assistant', 'Vehicle-specific repair specialist.', 'ROUTABLE_SPECIALIST', ['vehicle repair'], ['vehicle repair']),
  'gpt-builder': entry('gpt-builder', 'GPT Builder', 'GPT construction and configuration utility.', 'BUILDER_OR_WORKFLOW_UTILITY', ['GPT construction','GPT configuration'], ['GPT construction','GPT configuration']),
  'codex-prompt-builder': entry('codex-prompt-builder', 'Codex Prompt Builder', 'Codex prompt and implementation handoff preparation utility.', 'BUILDER_OR_WORKFLOW_UTILITY', ['Codex prompt preparation'], ['Codex prompt preparation']),
  'treasure-hunter': entry('treasure-hunter', 'Treasure Hunter', 'Ownership pending review; not approved for automatic routing.', 'UNKNOWN_PENDING_REVIEW', [], [], false),
  'policy-document-reviewer': entry('policy-document-reviewer', 'Policy Document Reviewer', 'Auto-insurance policy document review specialist.', 'ROUTABLE_SPECIALIST', ['auto-insurance policy review'], ['policy document review']),
  'equipment-repair-assistant': entry('equipment-repair-assistant', 'Equipment & Repair Assistant', 'Equipment and appliance repair specialist.', 'ROUTABLE_SPECIALIST', ['equipment and appliance repair'], ['equipment repair'])
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
    if (specialist.role !== undefined && !(SPECIALIST_ROLES as readonly string[]).includes(specialist.role)) throw new Error('INVALID_SPECIALIST_ROLE');
    if (specialist.canonical !== undefined && typeof specialist.canonical !== 'boolean') throw new Error('INVALID_CANONICAL_FLAG');
    if (specialist.routingApproved !== undefined && typeof specialist.routingApproved !== 'boolean') throw new Error('INVALID_ROUTING_APPROVAL');
    if (specialist.role === 'ORCHESTRATOR' && specialist.routingApproved === true) throw new Error('ORCHESTRATOR_CANNOT_BE_ROUTING_APPROVED');
    if (specialist.role === 'UNKNOWN_PENDING_REVIEW' && (specialist.routingApproved === true || specialist.status === 'ACTIVE')) throw new Error('PENDING_SPECIALIST_CANNOT_BE_ROUTING_APPROVED');
    if ((specialist.role === 'ROUTABLE_SPECIALIST' || specialist.role === 'BUILDER_OR_WORKFLOW_UTILITY') && specialist.routingApproved === false) throw new Error('APPROVED_ROLE_CANNOT_BE_ROUTING_DISABLED');
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
