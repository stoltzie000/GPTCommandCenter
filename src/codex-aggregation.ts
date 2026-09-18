import { Artifact, MultiSpecialistContext, OrchestrationPlan, OrchestrationPlanStage, SoftwareOutput, validSoftwareOutput, Workflow } from './domain.js';

const MAX_AGGREGATE_BYTES = 1024 * 1024;

export function buildMultiSpecialistContext(workflow: Workflow, plan: OrchestrationPlan, stages: readonly OrchestrationPlanStage[], artifacts: readonly Artifact[]): MultiSpecialistContext {
  if (plan.workflowId !== workflow.id || plan.status !== 'COMPLETE') throw new Error('MULTI_SPECIALIST_PLAN_NOT_COMPLETE');
  const ordered = [...stages].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const contributions = ordered.map(stage => {
    if (stage.workflowId !== workflow.id || stage.planId !== plan.id || stage.status !== 'COMPLETE' || !stage.outputArtifactId) throw new Error('MULTI_SPECIALIST_REQUIRED_OUTPUT_MISSING');
    const artifact = artifacts.find(item => item.id === stage.outputArtifactId);
    if (!artifact || artifact.workflowId !== workflow.id || artifact.planId !== plan.id || artifact.planStageId !== stage.id) throw new Error('MULTI_SPECIALIST_ARTIFACT_MISMATCH');
    return {artifactId:artifact.id, planStageId:stage.id, specialistId:stage.specialistId, purpose:stage.purpose, artifactType:artifact.artifactType, content:artifact.contentJson};
  });
  const primary = contributions.map(item => item.content).find(validSoftwareOutput);
  if (!primary) throw new Error('MULTI_SPECIALIST_REQUIREMENTS_MISSING');
  const context: MultiSpecialistContext = {planId:plan.id, planVersion:plan.version, workflowId:workflow.id, objective:workflow.objective, contributions, primaryRequirements:primary};
  if (Buffer.byteLength(JSON.stringify(context), 'utf8') > MAX_AGGREGATE_BYTES) throw new Error('MULTI_SPECIALIST_CONTEXT_TOO_LARGE');
  return context;
}

export function readMultiSpecialistContext(artifact: Artifact): MultiSpecialistContext {
  if (artifact.artifactType !== 'multi_specialist_context' || !artifact.planId) throw new Error('MULTI_SPECIALIST_CONTEXT_INVALID');
  const context = artifact.contentJson as MultiSpecialistContext;
  if (!context || context.planId !== artifact.planId || !context.workflowId || !Array.isArray(context.contributions) || !validSoftwareOutput(context.primaryRequirements)) throw new Error('MULTI_SPECIALIST_CONTEXT_INVALID');
  if (Buffer.byteLength(JSON.stringify(context), 'utf8') > MAX_AGGREGATE_BYTES) throw new Error('MULTI_SPECIALIST_CONTEXT_TOO_LARGE');
  return context;
}
