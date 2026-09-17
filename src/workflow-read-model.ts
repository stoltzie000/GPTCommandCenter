import { Workflow, RuntimeStatus } from './domain.js';
import { resolveRoutableSpecialist } from './registry.js';
import { PersistenceStore, RoutingHistoryStore } from './store.js';

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
  clarificationRequired: boolean;
  approvalRequired: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function readWorkflow(store: PersistenceStore & Partial<RoutingHistoryStore>, workflow: Workflow): Promise<WorkflowReadModel> {
  const latest = await store.getLatestRoutingDecision?.(workflow.id);
  const selectedSpecialistId = latest ? latest.selectedSpecialistId : workflow.logicalSpecialistId;
  const specialist = selectedSpecialistId ? resolveRoutableSpecialist(selectedSpecialistId) : undefined;
  const runtimeStatus = specialist?.runtimeStatus ?? specialist?.runtime?.status ?? null;
  const attempts = await store.getAttempts(workflow.id);
  const started = attempts.some(attempt => attempt.initiationEvidence !== undefined && attempt.initiationEvidence !== null);
  const completed = workflow.status === 'COMPLETE' || attempts.some(attempt => attempt.state === 'SUCCEEDED');
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
    clarificationRequired: workflow.status === 'AWAITING_CLARIFICATION',
    approvalRequired: workflow.status === 'AWAITING_APPROVAL',
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt
  };
}
