import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store.js';
import { persistResolvedRouting } from '../src/routing.js';
import type { RoutingResolution, SelectedCandidate } from '../src/domain.js';

function workflow(store:MemoryStore){
  return store.createWorkflow({
    requestId:`task22k-memory-${Math.random()}`,
    workflowType:'non_code',
    logicalSpecialistId:null,
    runtimeId:undefined,
    validationRequired:false,
    effectiveClassification:'PUBLIC',
    objective:'route locally',
    context:{},
    requiresImplementation:false
  });
}

function candidate():SelectedCandidate{
  return {
    specialistId:'architecture-security-advisor',
    rank:1,
    matchReason:'architecture ownership',
    evidence:{
      specialistId:'architecture-security-advisor',
      registryVersion:'1.0.0',
      ownershipMatches:['architecture'],
      capabilityMatches:['architecture review'],
      workflowRelationship:'none',
      exclusionResult:'eligible',
      specificity:3,
      runtimeStatus:'ACTIVE',
      matchReason:'architecture ownership'
    }
  };
}

test('Task 22K memory store projects CLEAR routing authority',async()=>{
  const store=new MemoryStore();
  const w=workflow(store);

  const resolution:RoutingResolution={
    routingConfidence:'CLEAR',
    selectedSpecialistId:'architecture-security-advisor',
    routingReason:'clear ownership',
    candidates:[candidate()],
    requiresClarification:false
  };

  const result=await persistResolvedRouting(store,w.id,resolution);

  assert.equal(result.workflow.status,'ROUTED');
  assert.equal(result.workflow.logicalSpecialistId,'architecture-security-advisor');
  assert.equal((await store.getLatestRoutingDecision(w.id))?.routingConfidence,'CLEAR');
});

test('Task 22K memory store preserves ambiguous workflow without specialist authority',async()=>{
  const store=new MemoryStore();
  const w=workflow(store);

  const first=candidate();
  const second={
    ...candidate(),
    specialistId:'competing-specialist',
    rank:2,
    evidence:{...candidate().evidence,specialistId:'competing-specialist'}
  };

  const resolution:RoutingResolution={
    routingConfidence:'AMBIGUOUS',
    selectedSpecialistId:null,
    routingReason:'ownership unresolved',
    candidates:[first,second],
    requiresClarification:true,
    clarificationQuestion:'Which specialist owns this task?'
  };

  const result=await persistResolvedRouting(store,w.id,resolution);

  assert.equal(result.workflow.status,'AWAITING_CLARIFICATION');
  assert.equal(result.workflow.logicalSpecialistId,null);
  assert.equal(result.clarification?.status,'PENDING');
});

test('Task 22K memory store preserves NO_MATCH as CREATED and unrouted',async()=>{
  const store=new MemoryStore();
  const w=workflow(store);

  const result=await persistResolvedRouting(store,w.id,{
    routingConfidence:'NO_MATCH',
    selectedSpecialistId:null,
    routingReason:'no match',
    candidates:[],
    requiresClarification:false
  });

  assert.equal(result.workflow.status,'CREATED');
  assert.equal(result.workflow.logicalSpecialistId,null);
  assert.equal((await store.getLatestRoutingDecision(w.id))?.routingConfidence,'NO_MATCH');
});
