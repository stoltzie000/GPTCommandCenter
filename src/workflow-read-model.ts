import { CodexPrompt, OrchestrationPlan, OrchestrationPlanStage, Workflow, RuntimeStatus } from './domain.js';
import { resolveRoutableSpecialist } from './registry.js';
import { registry as builtInRegistry } from './registry.js';
import { Specialist } from './domain.js';
import { readSpecialist } from './specialist-read-model.js';
import { OrchestrationPlanStore, PersistenceStore, RoutingHistoryStore } from './store.js';

export interface WorkflowReadModel {
  id: string;
  requestId: string;
  workflowType: Workflow['workflowType'];
  objective: string;
  status: Workflow['status'];
  routingConfidence: string | null;
  selectedSpecialistId: string | null;
  runtime: {
    status: RuntimeStatus | null;
    runtimeId: string | null;
    executable: boolean;
  };
  execution: {
    started: boolean;
    completed: boolean;
    manualHandoffRequired: boolean;
  };
  manualHandoff?: { available:boolean; specialistId:string|null; task?:{objective:string;workflowType:Workflow['workflowType'];requiresImplementation:boolean}; expectedOutput?:string; navigationUrl?:string; instructions?:string; returnEndpoint?:string };
  codexHandoff?: { available:boolean; reason:string; artifactId?:string; planId?:string; task?:CodexPrompt; instructions?:string; expectedOutput?:string; returnEndpoint?:string; submitted?:boolean };
  clarificationRequired: boolean;
  approvalRequired: boolean;
  createdAt: string;
  updatedAt: string;
  orchestrationPlan?: { plan: OrchestrationPlan; stages: Array<OrchestrationPlanStage & { manualHandoff?: { available:boolean; specialistId:string; specialistName:string; expectedOutput?:string; navigationUrl?:string; instructions?:string; returnEndpoint?:string } }> };
}

export async function readWorkflow(store: PersistenceStore & Partial<RoutingHistoryStore>, workflow: Workflow, catalog: Record<string, Specialist> = builtInRegistry): Promise<WorkflowReadModel> {
  const latest = await store.getLatestRoutingDecision?.(workflow.id);
  const selectedSpecialistId = latest ? latest.selectedSpecialistId : workflow.logicalSpecialistId;
  const specialist = selectedSpecialistId ? resolveRoutableSpecialist(selectedSpecialistId, catalog) : undefined;
  const runtimeStatus = specialist?.runtimeStatus ?? specialist?.runtime?.status ?? null;
  const attempts = await store.getAttempts(workflow.id);
  const started = attempts.some(attempt => attempt.initiationEvidence !== undefined && attempt.initiationEvidence !== null);
  const completed = workflow.status === 'COMPLETE' || attempts.some(attempt => attempt.state === 'SUCCEEDED');
  const planStore=store as PersistenceStore&Partial<OrchestrationPlanStore>;
  const plan=await planStore.getOrchestrationPlan?.(workflow.id);
  const planStages=plan?await planStore.getOrchestrationPlanStages!(plan.id):[];
  const orchestrationPlan=plan?{plan,stages:planStages.map(stage=>{const stageSpecialist=resolveRoutableSpecialist(stage.specialistId,catalog);const stageRead=stageSpecialist?readSpecialist(stageSpecialist):undefined;const available=workflow.status==='MANUAL_HANDOFF_REQUIRED'&&stage.status==='MANUAL_HANDOFF_REQUIRED'&&!!stageRead?.manualHandoff.available;return {...stage,...(stage.status==='MANUAL_HANDOFF_REQUIRED'?{manualHandoff:{available,specialistId:stage.specialistId,specialistName:stageSpecialist?.displayName??stage.specialistId,...(available?{expectedOutput:workflow.workflowType==='software'?'SoftwareOutput JSON: objective, requirements, constraints, affected_components, security_requirements, test_requirements, acceptance_criteria, validation_required, validation_reason.':'A bounded result summary or structured JSON object.',...(stageRead?.manualHandoff.navigationUrl?{navigationUrl:stageRead.manualHandoff.navigationUrl}:{}),instructions:`Complete the task with ${stageSpecialist?.displayName??stage.specialistId}, then submit the result for stage ${stage.id}.`,returnEndpoint:`/v1/workflows/${workflow.id}/plans/${plan.id}/stages/${stage.id}/handoff-response`}: {})}}: {})};})}:undefined;
  const specialistRead = specialist ? readSpecialist(specialist) : undefined;
  const handoffAvailable = workflow.status === 'MANUAL_HANDOFF_REQUIRED' && !!specialistRead?.manualHandoff.available && !orchestrationPlan;
  const codexPrompt = (await store.getArtifacts(workflow.id)).find(artifact=>artifact.artifactType==='codex_prompt');
  const manualCodexOutput = (await store.getArtifacts(workflow.id)).find(artifact=>artifact.artifactType==='manual_codex_output');
  const codexHandoffAvailable = workflow.status === 'MANUAL_HANDOFF_REQUIRED' && workflow.failureCode === 'CODEX_RUNTIME_UNAVAILABLE' && !!codexPrompt;
  return {
    id: workflow.id,
    requestId: workflow.requestId,
    workflowType: workflow.workflowType,
    objective: workflow.objective,
    status: workflow.status,
    routingConfidence: latest?.routingConfidence ?? null,
    selectedSpecialistId,
    runtime: {
      status: runtimeStatus,
      runtimeId: specialist?.runtime?.runtimeId ?? null,
      executable: runtimeStatus === 'ACTIVE'
    },
    execution: { started, completed, manualHandoffRequired: workflow.status === 'MANUAL_HANDOFF_REQUIRED' },
    ...(workflow.status === 'MANUAL_HANDOFF_REQUIRED' ? {manualHandoff:{available:handoffAvailable,specialistId:selectedSpecialistId,task:{objective:workflow.objective,workflowType:workflow.workflowType,requiresImplementation:workflow.requiresImplementation},...(handoffAvailable?{expectedOutput:workflow.workflowType==='software'?'SoftwareOutput JSON: objective, requirements, constraints, affected_components, security_requirements, test_requirements, acceptance_criteria, validation_required, validation_reason.':'A bounded result summary or structured JSON object.'}:{}),...(handoffAvailable&&specialistRead?.manualHandoff.navigationUrl?{navigationUrl:specialistRead.manualHandoff.navigationUrl}:{}),...(handoffAvailable?{instructions:`Complete the task with ${specialist?.displayName}, then submit the resulting structured output to the workflow return endpoint.`,returnEndpoint:`/v1/workflows/${workflow.id}/handoff-response`}: {})}} : {}),
    ...(workflow.status === 'MANUAL_HANDOFF_REQUIRED' && (workflow.failureCode === 'CODEX_RUNTIME_UNAVAILABLE' || manualCodexOutput) ? {codexHandoff:{available:codexHandoffAvailable,reason:workflow.failureCode==='CODEX_RUNTIME_UNAVAILABLE'?'The approved Codex runtime is unavailable. The generated task is ready for manual execution.':'Codex evidence was submitted externally and requires manual review.',...(codexPrompt?{artifactId:codexPrompt.id, ...(codexPrompt.planId?{planId:codexPrompt.planId}:{}),task:codexPrompt.contentJson as CodexPrompt}:{}),instructions:'Copy the generated Codex task into an approved Codex environment. Return a bounded execution report; GPTCC will label it as externally supplied and will not treat it as independently verified.',expectedOutput:'JSON with implementation_summary, changed_files, test_results, and optional execution_notes.',returnEndpoint:codexHandoffAvailable?`/v1/workflows/${workflow.id}/handoff-response`:undefined,submitted:!!manualCodexOutput}} : {}),
    clarificationRequired: workflow.status === 'AWAITING_CLARIFICATION',
    approvalRequired: workflow.status === 'AWAITING_APPROVAL',
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    ...(orchestrationPlan?{orchestrationPlan}: {})
  };
}
