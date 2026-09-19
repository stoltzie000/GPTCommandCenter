import { Artifact, Attempt, CodexPrompt, SoftwareOutput, Stage, StageType, Workflow, WorkflowStatus } from './domain.js';

export type SoftwareDeliveryStage = 'SPECIALIST_ANALYSIS' | 'PROMPT_BUILD' | 'CODEX_EXECUTION' | 'VALIDATION' | 'COMPLETE';

export interface SoftwareDeliveryStageDefinition {
  key: SoftwareDeliveryStage;
  stageType?: StageType;
  owner: 'workflow-specialist' | 'codex-prompt-builder' | 'codex-runtime' | 'workflow-specialist-validator' | 'none';
  next: SoftwareDeliveryStage | null;
  transition: 'AUTOMATIC' | 'TERMINAL';
  approval: 'NOT_REQUIRED_WITHIN_AUTHORIZED_SCOPE' | 'NOT_APPLICABLE';
  requiredArtifactType?: string;
}

export const SOFTWARE_DELIVERY_WORKFLOW = {
  id: 'SOFTWARE_DELIVERY',
  name: 'Software Delivery',
  workflowType: 'software',
  stages: [
    {key: 'SPECIALIST_ANALYSIS', stageType: 'specialist', owner: 'workflow-specialist', next: 'PROMPT_BUILD', transition: 'AUTOMATIC', approval: 'NOT_REQUIRED_WITHIN_AUTHORIZED_SCOPE', requiredArtifactType: 'specialist_output'},
    {key: 'PROMPT_BUILD', stageType: 'prompt_builder', owner: 'codex-prompt-builder', next: 'CODEX_EXECUTION', transition: 'AUTOMATIC', approval: 'NOT_REQUIRED_WITHIN_AUTHORIZED_SCOPE', requiredArtifactType: 'codex_prompt'},
    {key: 'CODEX_EXECUTION', stageType: 'codex', owner: 'codex-runtime', next: 'VALIDATION', transition: 'AUTOMATIC', approval: 'NOT_REQUIRED_WITHIN_AUTHORIZED_SCOPE', requiredArtifactType: 'codex_result'},
    {key: 'VALIDATION', stageType: 'validation', owner: 'workflow-specialist-validator', next: 'COMPLETE', transition: 'AUTOMATIC', approval: 'NOT_REQUIRED_WITHIN_AUTHORIZED_SCOPE', requiredArtifactType: 'validation_result'},
    {key: 'COMPLETE', owner: 'none', next: null, transition: 'TERMINAL', approval: 'NOT_APPLICABLE'}
  ] satisfies SoftwareDeliveryStageDefinition[]
} as const;

export interface StageHandoffContext<T> {
  workflowDefinitionId: typeof SOFTWARE_DELIVERY_WORKFLOW.id;
  from: SoftwareDeliveryStage;
  to: SoftwareDeliveryStage;
  payload: T;
}

export function softwareDeliveryDefinitionFor(workflow: Pick<Workflow, 'workflowDefinitionId'>) {
  return workflow.workflowDefinitionId === SOFTWARE_DELIVERY_WORKFLOW.id ? SOFTWARE_DELIVERY_WORKFLOW : undefined;
}

export function assertSoftwareDeliveryTransition(from: SoftwareDeliveryStage, to: SoftwareDeliveryStage): void {
  const current = SOFTWARE_DELIVERY_WORKFLOW.stages.find(stage => stage.key === from);
  if (!current || current.next !== to) throw new Error('PREDEFINED_WORKFLOW_TRANSITION_NOT_APPROVED');
}

function evidenceComplete(stageType: StageType, stages: Stage[], attempts: Attempt[], artifacts: Artifact[]): boolean {
  const stage = stages.find(candidate => candidate.stageType === stageType);
  if (!stage || stage.status !== 'COMPLETE' || !stage.outputArtifactId) return false;
  const attempt = attempts.find(candidate => candidate.stageId === stage.id && candidate.state === 'SUCCEEDED');
  if (!attempt?.terminalEvidence) return false;
  return artifacts.some(artifact => artifact.id === stage.outputArtifactId);
}

export function assertSoftwareDeliveryActivation(workflow: Workflow, target: Exclude<SoftwareDeliveryStage, 'COMPLETE'>, stages: Stage[], attempts: Attempt[], artifacts: Artifact[]): void {
  if (!softwareDeliveryDefinitionFor(workflow)) throw new Error('PREDEFINED_WORKFLOW_NOT_APPLICABLE');
  const expected: Record<Exclude<SoftwareDeliveryStage, 'COMPLETE'>, {status: WorkflowStatus; prior?: StageType}> = {
    SPECIALIST_ANALYSIS: {status: 'ROUTED'},
    PROMPT_BUILD: {status: 'SPECIALIST_COMPLETE', prior: 'specialist'},
    CODEX_EXECUTION: {status: 'CODEX_PROMPT_READY', prior: 'prompt_builder'},
    VALIDATION: {status: 'CODEX_COMPLETE', prior: 'codex'}
  };
  const rule = expected[target];
  if (target === 'PROMPT_BUILD' && workflow.status === 'SPECIALIST_COMPLETE' && artifacts.some(artifact => artifact.artifactType === 'manual_specialist_output')) return;
  const targetIndex = SOFTWARE_DELIVERY_WORKFLOW.stages.findIndex(stage => stage.key === target);
  const priorDefinition = targetIndex > 0 ? SOFTWARE_DELIVERY_WORKFLOW.stages[targetIndex - 1] : undefined;
  if (priorDefinition) assertSoftwareDeliveryTransition(priorDefinition.key, target);
  if (workflow.status !== rule.status || (rule.prior && !evidenceComplete(rule.prior, stages, attempts, artifacts))) throw new Error('PREDEFINED_WORKFLOW_STAGE_NOT_EVIDENCE_READY');
}

export function specialistToPromptHandoff(workflow: Workflow, requirements: SoftwareOutput): StageHandoffContext<{objective: string; requirements: SoftwareOutput}> {
  return {workflowDefinitionId: SOFTWARE_DELIVERY_WORKFLOW.id, from: 'SPECIALIST_ANALYSIS', to: 'PROMPT_BUILD', payload: {objective: workflow.objective, requirements}};
}

export function promptToCodexHandoff(promptArtifact: CodexPrompt): StageHandoffContext<{promptArtifact: CodexPrompt; executionPolicy: {noMerge: true; noDeploy: true}}> {
  return {workflowDefinitionId: SOFTWARE_DELIVERY_WORKFLOW.id, from: 'PROMPT_BUILD', to: 'CODEX_EXECUTION', payload: {promptArtifact, executionPolicy: {noMerge: true, noDeploy: true}}};
}

export function codexToValidationHandoff(originalRequirements: SoftwareOutput, codexPrompt: CodexPrompt, codexResult: {changedFiles: string[]; testResults: unknown[]}): StageHandoffContext<{originalRequirements: SoftwareOutput; codexPrompt: CodexPrompt; codexResult: typeof codexResult; changedFiles: string[]; testResults: unknown[]}> {
  return {workflowDefinitionId: SOFTWARE_DELIVERY_WORKFLOW.id, from: 'CODEX_EXECUTION', to: 'VALIDATION', payload: {originalRequirements, codexPrompt, codexResult, changedFiles: codexResult.changedFiles, testResults: codexResult.testResults}};
}
