export type WorkflowType = 'software' | 'non_code';
export type WorkflowStatus = 'CREATED'|'ROUTED'|'AWAITING_CLARIFICATION'|'AWAITING_APPROVAL'|'SPECIALIST_RUNNING'|'SPECIALIST_COMPLETE'|'CODEX_PROMPT_READY'|'CODEX_RUNNING'|'CODEX_COMPLETE'|'VALIDATION_RUNNING'|'COMPLETE'|'FAILED'|'MANUAL_HANDOFF_REQUIRED';
export type StageType = 'specialist'|'prompt_builder'|'codex'|'validation';
export type AttemptState = 'CLAIMED'|'STARTING'|'RUNNING'|'SUCCEEDED'|'FAILED_TO_START'|'FAILED'|'TIMED_OUT'|'CANCELLED'|'STATUS_UNKNOWN';
export type OrchestrationPlanStatus = 'PLANNED'|'RUNNING'|'COMPLETE'|'FAILED'|'MANUAL_HANDOFF_REQUIRED';
export type OrchestrationPlanStageStatus = 'PENDING'|'RUNNING'|'COMPLETE'|'FAILED'|'MANUAL_HANDOFF_REQUIRED';
export type RuntimeStatus = 'ACTIVE'|'MANUAL_ONLY'|'UNVERIFIED'|'DISABLED';
export type RegistryReconciliationStatus = 'MATCHED'|'NEW_UNREVIEWED'|'POSSIBLE_RENAME'|'METADATA_CHANGED'|'MISSING_FROM_INVENTORY'|'DUPLICATE_OR_AMBIGUOUS'|'PROVIDER_UNAVAILABLE';
export type RegistryFreshness = 'VERIFIED'|'UNVERIFIED';
export const RUNTIME_STATUSES = ['ACTIVE','MANUAL_ONLY','UNVERIFIED','DISABLED'] as const;
export type SpecialistStatus = 'ACTIVE'|'INACTIVE'|'DEPRECATED';
export const SPECIALIST_STATUSES = ['ACTIVE','INACTIVE','DEPRECATED'] as const;
export const SPECIALIST_ROLES = ['ORCHESTRATOR','ROUTABLE_SPECIALIST','BUILDER_OR_WORKFLOW_UTILITY','UNKNOWN_PENDING_REVIEW'] as const;
export type SpecialistRole = typeof SPECIALIST_ROLES[number];
export type ResultKind = 'success'|'retryable_failure'|'terminal_failure';
export interface Runtime { status: RuntimeStatus; type: 'openai_agent'; runtimeId: string; version: string; instructionRef: string; outputSchema: string; timeoutSeconds: number; maxAttempts: number; }
export const ROUTING_CONFIDENCES = ['CLEAR','PROBABLE','AMBIGUOUS','NO_MATCH'] as const;
export type RoutingConfidence = typeof ROUTING_CONFIDENCES[number];
export const ROUTING_DECISION_TYPES = ['INITIAL','POST_CLARIFICATION','USER_OVERRIDE','DOWNSTREAM_ROUTE','FALLBACK'] as const;
export type RoutingDecisionType = typeof ROUTING_DECISION_TYPES[number];
export interface RoutingDecision { id:string; workflowId:string; selectedSpecialistId:string|null; routingConfidence:RoutingConfidence; routingReason:string; decisionType:RoutingDecisionType; supersedesDecisionId:string|null; createdAt:string; }
export interface RoutingCandidate { id:string; routingDecisionId:string; specialistId:string; rank:number; matchReason:string; }
export interface TaskInterpretation { intent:string; requestedOutcome:string; taskCategories:string[]; requiredCapabilities:string[]; excludedCapabilities:string[]; inputTypes:string[]; expectedOutputTypes:string[]; workflowContext:{currentSpecialistId?:string; stageKey?:string; routeType?:RoutingDecisionType}; repositoryContext?:{repositoryId?:string; ref?:string}; requiresCurrentInformation:boolean; requiresExecutableRuntime:boolean; explicitSpecialistRequest?:string; }
export interface CandidateEvidence { specialistId:string; registryVersion:string; ownershipMatches:string[]; capabilityMatches:string[]; workflowRelationship:'upstream'|'downstream'|'current'|'none'; exclusionResult:'eligible'; specificity:number; runtimeStatus:RuntimeStatus; matchReason:string; }
export interface SelectedCandidate { specialistId:string; rank:number; matchReason:string; evidence:CandidateEvidence; }
export interface RoutingResolution { routingConfidence:RoutingConfidence; selectedSpecialistId:string|null; routingReason:string; candidates:SelectedCandidate[]; requiresClarification:boolean; clarificationQuestion?:string; }
export const ROUTING_CLARIFICATION_STATUSES = ['PENDING','ANSWERED','SUPERSEDED'] as const;
export type RoutingClarificationStatus = typeof ROUTING_CLARIFICATION_STATUSES[number];
export interface RoutingClarification { id:string; workflowId:string; routingDecisionId:string; question:string; status:RoutingClarificationStatus; response:string|null; createdAt:string; answeredAt:string|null; }
export const APPROVAL_STATUSES = ['PENDING','APPROVED','REJECTED'] as const;
export type ApprovalStatus = typeof APPROVAL_STATUSES[number];
export interface ApprovalRequest { id:string; workflowId:string; protectedActionId:string; scopeFingerprint:string; reason:string; categories:MaterialApprovalCategory[]; status:ApprovalStatus; decisionReason:string|null; decidedBy:string|null; createdAt:string; decidedAt:string|null; }
export const MATERIAL_APPROVAL_CATEGORIES = ['SCOPE','AUTHORITY','COST','EXTERNAL_ACCESS','SECURITY_PRIVACY','EXECUTION_RISK'] as const;
export type MaterialApprovalCategory = typeof MATERIAL_APPROVAL_CATEGORIES[number];
export type NoMatchFallbackStep = 'NO_MATCH'|'FOCUSED_CLARIFICATION'|'APPROVED_GENERAL_FALLBACK'|'EXPLICIT_NO_OWNER_RESULT';
export const NO_MATCH_FALLBACK_ORDER: readonly NoMatchFallbackStep[] = ['NO_MATCH','FOCUSED_CLARIFICATION','APPROVED_GENERAL_FALLBACK','EXPLICIT_NO_OWNER_RESULT'];
export type SpecialistOrigin = 'BUILTIN'|'DYNAMIC';
export interface SpecialistCreationProvenance { sourceWorkflowId?: string; capabilityGap: string; creationMechanism: 'GAP_DRIVEN'; humanApproved: boolean; }
export interface Specialist { id: string; specialistId: string; displayName: string; description:string; primaryOwnership:string[]; capabilities:string[]; exclusions:string[]; overlapsWith:string[]; upstreamSpecialists:string[]; downstreamSpecialists:string[]; status:SpecialistStatus; runtimeStatus:RuntimeStatus; runtimeId:string|null; registryVersion:string; lastReviewedAt:string; chatgptUrl?: string; runtime?: Runtime; canValidateCodex: boolean; inventoryIdentity?: string; role?: SpecialistRole; canonical?: boolean; routingApproved?: boolean; origin?: SpecialistOrigin; createdAt?: string; creationProvenance?: SpecialistCreationProvenance; }
export interface SoftwareOutput { objective:string; requirements:string[]; constraints:string[]; affected_components:string[]; security_requirements:string[]; test_requirements:string[]; acceptance_criteria:string[]; validation_required:boolean; validation_reason:string; }
export interface CodexPrompt { task_summary:string; implementation_instructions:string; scope_constraints:string[]; tests_required:string[]; acceptance_criteria:string[]; expected_result_report:string[]; }
export interface ValidationOutput { verdict:'PASS'|'PASS_WITH_CHANGES'|'FAIL'; blocking_findings:string[]; non_blocking_findings:string[]; remediation_requirements:string[]; }
export interface Stage { id:string; workflowId:string; stageType:StageType; logicalStageKey:string; runtimeId?:string; status:'PENDING'|'RUNNING'|'COMPLETE'|'FAILED'; attempt:number; externalExecutionId?:string; outputArtifactId?:string; evidence?:unknown; }
export interface Attempt { id:string; workflowId:string; stageId:string; logicalStageKey:string; attemptNumber:number; ownerId:string; state:AttemptState; initiationEvidence?:unknown; terminalEvidence?:unknown; }
export interface Artifact { id:string; workflowId:string; artifactType:string; contentType:string; contentJson:unknown; contentHash:string; planId?:string; planStageId?:string; specialistId?:string; }
export interface OrchestrationPlan { id:string; workflowId:string; version:number; status:OrchestrationPlanStatus; reason:string; createdAt:string; updatedAt:string; }
export interface OrchestrationPlanStage { id:string; planId:string; workflowId:string; specialistId:string; purpose:string; dependencies:string[]; status:OrchestrationPlanStageStatus; order:number; outputArtifactId?:string; }
export interface Workflow { id:string; requestId:string; workflowType:WorkflowType; workflowDefinitionId?:'SOFTWARE_DELIVERY'; logicalSpecialistId:string|null; runtimeId?:string; status:WorkflowStatus; validationRequired?:boolean; effectiveClassification?:'PUBLIC'|'INTERNAL'|'CONFIDENTIAL'|'RESTRICTED'; objective:string; context:unknown; requiresImplementation:boolean; failureCode?:string; failureMessage?:string; version:number; createdAt:string; updatedAt:string; }
export const LEGAL: Record<WorkflowStatus, WorkflowStatus[]> = {
  CREATED:['ROUTED','AWAITING_CLARIFICATION'], ROUTED:['AWAITING_CLARIFICATION','AWAITING_APPROVAL','SPECIALIST_RUNNING','MANUAL_HANDOFF_REQUIRED','FAILED'], AWAITING_CLARIFICATION:['ROUTED','FAILED','MANUAL_HANDOFF_REQUIRED'], AWAITING_APPROVAL:['ROUTED','FAILED','MANUAL_HANDOFF_REQUIRED'], SPECIALIST_RUNNING:['SPECIALIST_COMPLETE','FAILED','MANUAL_HANDOFF_REQUIRED'], SPECIALIST_COMPLETE:['CODEX_PROMPT_READY','COMPLETE','FAILED'], CODEX_PROMPT_READY:['CODEX_RUNNING','FAILED'], CODEX_RUNNING:['CODEX_COMPLETE','FAILED','MANUAL_HANDOFF_REQUIRED'], CODEX_COMPLETE:['VALIDATION_RUNNING','COMPLETE','FAILED'], VALIDATION_RUNNING:['COMPLETE','FAILED','MANUAL_HANDOFF_REQUIRED'], COMPLETE:[], FAILED:[], MANUAL_HANDOFF_REQUIRED:[]
};
export function assertTransition(from:WorkflowStatus,to:WorkflowStatus) { if (!LEGAL[from].includes(to)) throw new Error('INVALID_STATE_TRANSITION'); }
export function isObject(v:unknown): v is Record<string,unknown> { return !!v && typeof v === 'object' && !Array.isArray(v); }
export function validSoftwareOutput(v:unknown): v is SoftwareOutput { return isObject(v) && typeof v.objective==='string' && Array.isArray(v.requirements) && Array.isArray(v.constraints) && Array.isArray(v.affected_components) && Array.isArray(v.security_requirements) && Array.isArray(v.test_requirements) && Array.isArray(v.acceptance_criteria) && typeof v.validation_required==='boolean' && typeof v.validation_reason==='string'; }
export function validCodexPrompt(v:unknown): v is CodexPrompt { return isObject(v) && typeof v.task_summary==='string' && typeof v.implementation_instructions==='string' && Array.isArray(v.scope_constraints) && Array.isArray(v.tests_required) && Array.isArray(v.acceptance_criteria) && Array.isArray(v.expected_result_report); }
export function validValidation(v:unknown): v is ValidationOutput { return isObject(v) && ['PASS','PASS_WITH_CHANGES','FAIL'].includes(v.verdict as string) && Array.isArray(v.blocking_findings) && Array.isArray(v.non_blocking_findings) && Array.isArray(v.remediation_requirements); }
