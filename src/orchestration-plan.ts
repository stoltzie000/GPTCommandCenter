import { randomUUID } from 'node:crypto';
import { OrchestrationPlan, OrchestrationPlanStage, SelectedCandidate, Specialist } from './domain.js';
import { isCanonicalRoutableSpecialist } from './registry.js';

export function validateOrchestrationPlan(plan: OrchestrationPlan, stages: readonly OrchestrationPlanStage[], catalog: Record<string, Specialist>): void {
  if (!plan.id || !plan.workflowId || plan.version < 1 || !['PLANNED','RUNNING','COMPLETE','FAILED','MANUAL_HANDOFF_REQUIRED'].includes(plan.status)) throw new Error('INVALID_ORCHESTRATION_PLAN');
  const ids = new Set<string>();
  const stageIds = new Set(stages.map(stage => stage.id));
  for (const stage of stages) {
    if (stage.planId !== plan.id || stage.workflowId !== plan.workflowId || ids.has(stage.id) || !stage.specialistId || !isCanonicalRoutableSpecialist(catalog[stage.specialistId])) throw new Error('INVALID_ORCHESTRATION_PLAN_STAGE');
    ids.add(stage.id);
    if (stage.dependencies.includes(stage.id) || stage.dependencies.some(dependency => !stageIds.has(dependency))) throw new Error('INVALID_ORCHESTRATION_DEPENDENCY');
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error('ORCHESTRATION_PLAN_CYCLE');
    if (visited.has(id)) return;
    visiting.add(id);
    const stage = stages.find(candidate => candidate.id === id)!;
    stage.dependencies.forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  stages.forEach(stage => visit(stage.id));
}

export function buildOrchestrationPlan(workflowId: string, candidates: readonly SelectedCandidate[], catalog: Record<string, Specialist>, reason = 'collective specialist capability coverage'): { plan: OrchestrationPlan; stages: OrchestrationPlanStage[] } {
  const now = new Date().toISOString();
  const plan: OrchestrationPlan = { id: randomUUID(), workflowId, version: 1, status: 'PLANNED', reason, createdAt: now, updatedAt: now };
  const stages: OrchestrationPlanStage[] = candidates.slice(0, 3).map((candidate, index) => ({
    id: randomUUID(), planId: plan.id, workflowId, specialistId: candidate.specialistId,
    purpose: candidate.matchReason || `Contribute ${candidate.specialistId} analysis`,
    dependencies: [], status: 'PENDING' as const, order: index
  }));
  // Replace the temporary predecessor references after IDs exist; this keeps creation deterministic and explicit.
  stages.forEach((stage, index) => { stage.dependencies = index ? [stages[index - 1].id] : []; });
  validateOrchestrationPlan(plan, stages, catalog);
  return { plan, stages };
}
