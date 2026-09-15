import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store.js';

test('Task 22K unrouted workflow remains CREATED without inventing specialist authority', () => {
  const store = new MemoryStore();

  const workflow = store.createWorkflow({
    requestId: 'task22k-unrouted-memory',
    workflowType: 'non_code',
    logicalSpecialistId: null,
    runtimeId: undefined,
    validationRequired: false,
    effectiveClassification: 'PUBLIC',
    objective: 'route this request',
    context: {},
    requiresImplementation: false
  });

  assert.equal(workflow.status, 'CREATED');
  assert.equal(workflow.logicalSpecialistId, null);

  const events = store.getEvents(workflow.id);
  assert.equal(events.some(event => event.eventType === 'WORKFLOW_ROUTED'), false);

  assert.throws(
    () => store.claimStage(
      workflow.id,
      'specialist',
      'specialist',
      undefined,
      'worker'
    ),
    /ROUTING_REQUIRED/
  );
});
