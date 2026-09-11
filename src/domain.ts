export type WorkflowType = 'software' | 'non_code';
export type WorkflowStatus = 'CREATED'|'ROUTED'|'SPECIALIST_RUNNING'|'SPECIALIST_COMPLETE'|'CODEX_PROMPT_READY'|'CODEX_RUNNING'|'CODEX_COMPLETE'|'VALIDATION_RUNNING'|'COMPLETE'|'FAILED'|'MANUAL_HANDOFF_REQUIRED';
export type StageType = 'specialist'|'prompt_builder'|'codex'|'validation';
export type AttemptState = 'CLAIMED'|'STARTING'|'RUNNING'|'SUCCEEDED'|'FAILED_TO_START'|'FAILED'|'TIMED_OUT'|'CANCELLED'|'STATUS_UNKNOWN';
export type RuntimeStatus = 'ACTIVE'|'MANUAL_ONLY'|'UNVERIFIED'|'DISABLED';
export type ResultKind = 'success'|'retryable_failure'|'terminal_failure';
export interface Runtime { status: RuntimeStatus; type: 'openai_agent'; runtimeId: string; version: string; instructionRef: string; outputSchema: string; timeoutSeconds: number; maxAttempts: number; }
export interface Specialist { specialistId: string; displayName: string; chatgptUrl?: string; runtime?: Runtime; canValidateCodex: boolean; }
export interface SoftwareOutput { objective:string; requirements:string[]; constraints:string[]; affected_components:string[]; security_requirements:string[]; test_requirements:string[]; acceptance_criteria:string[]; validation_required:boolean; validation_reason:string; }
export interface CodexPrompt { task_summary:string; implementation_instructions:string; scope_constraints:string[]; tests_required:string[]; acceptance_criteria:string[]; expected_result_report:string[]; }
export interface ValidationOutput { verdict:'PASS'|'PASS_WITH_CHANGES'|'FAIL'; blocking_findings:string[]; non_blocking_findings:string[]; remediation_requirements:string[]; }
export interface Stage { id:string; workflowId:string; stageType:StageType; logicalStageKey:string; runtimeId?:string; status:'PENDING'|'RUNNING'|'COMPLETE'|'FAILED'; attempt:number; externalExecutionId?:string; outputArtifactId?:string; evidence?:unknown; }
export interface Attempt { id:string; workflowId:string; stageId:string; logicalStageKey:string; attemptNumber:number; ownerId:string; state:AttemptState; initiationEvidence?:unknown; terminalEvidence?:unknown; }
export interface Artifact { id:string; workflowId:string; artifactType:string; contentType:string; contentJson:unknown; contentHash:string; }
export interface Workflow { id:string; requestId:string; workflowType:WorkflowType; logicalSpecialistId:string; runtimeId?:string; status:WorkflowStatus; validationRequired?:boolean; effectiveClassification?:'PUBLIC'|'INTERNAL'|'CONFIDENTIAL'|'RESTRICTED'; objective:string; context:unknown; requiresImplementation:boolean; failureCode?:string; failureMessage?:string; version:number; createdAt:string; updatedAt:string; }
export const LEGAL: Record<WorkflowStatus, WorkflowStatus[]> = {
  CREATED:['ROUTED'], ROUTED:['SPECIALIST_RUNNING','MANUAL_HANDOFF_REQUIRED','FAILED'], SPECIALIST_RUNNING:['SPECIALIST_COMPLETE','FAILED','MANUAL_HANDOFF_REQUIRED'], SPECIALIST_COMPLETE:['CODEX_PROMPT_READY','COMPLETE','FAILED'], CODEX_PROMPT_READY:['CODEX_RUNNING','FAILED'], CODEX_RUNNING:['CODEX_COMPLETE','FAILED','MANUAL_HANDOFF_REQUIRED'], CODEX_COMPLETE:['VALIDATION_RUNNING','COMPLETE','FAILED'], VALIDATION_RUNNING:['COMPLETE','FAILED','MANUAL_HANDOFF_REQUIRED'], COMPLETE:[], FAILED:[], MANUAL_HANDOFF_REQUIRED:[]
};
export function assertTransition(from:WorkflowStatus,to:WorkflowStatus) { if (!LEGAL[from].includes(to)) throw new Error('INVALID_STATE_TRANSITION'); }
export function isObject(v:unknown): v is Record<string,unknown> { return !!v && typeof v === 'object' && !Array.isArray(v); }
export function validSoftwareOutput(v:unknown): v is SoftwareOutput { return isObject(v) && typeof v.objective==='string' && Array.isArray(v.requirements) && Array.isArray(v.constraints) && Array.isArray(v.affected_components) && Array.isArray(v.security_requirements) && Array.isArray(v.test_requirements) && Array.isArray(v.acceptance_criteria) && typeof v.validation_required==='boolean' && typeof v.validation_reason==='string'; }
export function validCodexPrompt(v:unknown): v is CodexPrompt { return isObject(v) && typeof v.task_summary==='string' && typeof v.implementation_instructions==='string' && Array.isArray(v.scope_constraints) && Array.isArray(v.tests_required) && Array.isArray(v.acceptance_criteria) && Array.isArray(v.expected_result_report); }
export function validValidation(v:unknown): v is ValidationOutput { return isObject(v) && ['PASS','PASS_WITH_CHANGES','FAIL'].includes(v.verdict as string) && Array.isArray(v.blocking_findings) && Array.isArray(v.non_blocking_findings) && Array.isArray(v.remediation_requirements); }
