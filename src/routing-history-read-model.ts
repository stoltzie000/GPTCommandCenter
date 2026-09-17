import { RoutingDecision } from './domain.js';
import { PersistenceStore, RoutingHistoryStore } from './store.js';

export interface RoutingDecisionReadModel {
  id: string;
  workflowId: string;
  decisionType: RoutingDecision['decisionType'];
  routingConfidence: RoutingDecision['routingConfidence'];
  selectedSpecialistId: string | null;
  explanation: string;
  supersedesDecisionId: string | null;
  current: boolean;
  createdAt: string;
}

function explanationFor(decision: RoutingDecision): string {
  if (decision.decisionType === 'USER_OVERRIDE') return 'A user override selected the specialist for this workflow.';
  if (decision.decisionType === 'POST_CLARIFICATION') {
    return decision.selectedSpecialistId ? 'Routing was updated after clarification.' : 'Clarification did not establish a specialist.';
  }
  if (decision.decisionType === 'DOWNSTREAM_ROUTE') return 'Routing followed an approved downstream workflow transition.';
  if (decision.routingConfidence === 'AMBIGUOUS') return 'Multiple possible owners remained; clarification was required.';
  if (decision.routingConfidence === 'NO_MATCH' || !decision.selectedSpecialistId) return 'No approved specialist matched the request.';
  if (decision.decisionType === 'FALLBACK') return 'Fallback routing selected the persisted specialist.';
  return 'The selected specialist was established by the initial routing decision.';
}

export async function readRoutingDecisions(
  store: PersistenceStore & Partial<RoutingHistoryStore>,
  workflowId: string
): Promise<RoutingDecisionReadModel[]> {
  if (!store.getRoutingHistory) throw new Error('ROUTING_HISTORY_PERSISTENCE_UNAVAILABLE');
  const decisions = await store.getRoutingHistory(workflowId);
  const superseded = new Set(decisions.map(decision => decision.supersedesDecisionId).filter((id): id is string => Boolean(id)));
  return decisions.map(decision => ({
    id: decision.id,
    workflowId: decision.workflowId,
    decisionType: decision.decisionType,
    routingConfidence: decision.routingConfidence,
    selectedSpecialistId: decision.selectedSpecialistId,
    explanation: explanationFor(decision),
    supersedesDecisionId: decision.supersedesDecisionId,
    current: !superseded.has(decision.id),
    createdAt: decision.createdAt
  }));
}
