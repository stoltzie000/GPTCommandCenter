import { ApprovalRequest } from './domain.js';

/**
 * Child records supplied to a workflow route must remain bound to that route's
 * already-authorized parent workflow.
 */
export function assertApprovalBelongsToWorkflow(workflowId: string, approval: ApprovalRequest | undefined): ApprovalRequest {
  if (!approval || approval.workflowId !== workflowId) throw new Error('APPROVAL_NOT_FOUND');
  return approval;
}
