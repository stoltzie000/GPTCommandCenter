import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PgStore } from '../src/pg-store.js';
import { persistResolvedRouting } from '../src/routing.js';
import type { RoutingResolution, SelectedCandidate } from '../src/domain.js';

const url=process.env.PG_TEST_URL;

function candidate(id:string,rank=1):SelectedCandidate {
  return {
    specialistId:id,
    rank,
    matchReason:'Task 22K routing evidence',
    evidence:{
      specialistId:id,
      registryVersion:'1.0.0',
      ownershipMatches:['architecture'],
      capabilityMatches:['architecture review'],
      workflowRelationship:'none',
      exclusionResult:'eligible',
      specificity:3,
      runtimeStatus:'ACTIVE',
      matchReason:'Task 22K routing evidence'
    }
  };
}

async function unrouted(store:PgStore){
  return store.createWorkflow({
    requestId:randomUUID(),
    workflowType:'non_code',
    logicalSpecialistId:null,
    runtimeId:undefined,
    validationRequired:false,
    effectiveClassification:'PUBLIC',
    objective:'Task 22K route this workflow',
    context:{},
    requiresImplementation:false
  },'task22k','create');
}

test('Task 22K CLEAR routing atomically projects specialist and ROUTED state',{skip:!url},async()=>{
  const store=new PgStore(url);
  try{
    const workflow=await unrouted(store);
    assert.equal(workflow.status,'CREATED');
    assert.equal(workflow.logicalSpecialistId,null);

    const resolution:RoutingResolution={
      routingConfidence:'CLEAR',
      selectedSpecialistId:'architecture-security-advisor',
      routingReason:'clear ownership',
      candidates:[candidate('architecture-security-advisor')],
      requiresClarification:false
    };

    const result=await persistResolvedRouting(store,workflow.id,resolution);

    assert.equal(result.workflow.status,'ROUTED');
    assert.equal(result.workflow.logicalSpecialistId,'architecture-security-advisor');

    const persisted=await store.getWorkflow(workflow.id);
    assert.equal(persisted?.status,'ROUTED');
    assert.equal(persisted?.logicalSpecialistId,'architecture-security-advisor');

    const events=await store.getEvents(workflow.id);
    assert.equal(events.some(e=>e.eventType==='WORKFLOW_ROUTED'),true);
  }finally{
    await store.pool.end();
  }
});

test('Task 22K AMBIGUOUS routing leaves specialist unset and awaits clarification',{skip:!url},async()=>{
  const store=new PgStore(url);
  try{
    const workflow=await unrouted(store);

    const resolution:RoutingResolution={
      routingConfidence:'AMBIGUOUS',
      selectedSpecialistId:null,
      routingReason:'ownership unresolved',
      candidates:[
        candidate('architecture-security-advisor',1),
        candidate('other-specialist',2)
      ],
      requiresClarification:true,
      clarificationQuestion:'Which specialist should own this task?'
    };

    const result=await persistResolvedRouting(store,workflow.id,resolution);

    assert.equal(result.workflow.status,'AWAITING_CLARIFICATION');
    assert.equal(result.workflow.logicalSpecialistId,null);
    assert.equal(result.clarification?.status,'PENDING');

    const persisted=await store.getWorkflow(workflow.id);
    assert.equal(persisted?.status,'AWAITING_CLARIFICATION');
    assert.equal(persisted?.logicalSpecialistId,null);
  }finally{
    await store.pool.end();
  }
});

test('Task 22K NO_MATCH persists routing evidence without inventing authority',{skip:!url},async()=>{
  const store=new PgStore(url);
  try{
    const workflow=await unrouted(store);

    const resolution:RoutingResolution={
      routingConfidence:'NO_MATCH',
      selectedSpecialistId:null,
      routingReason:'no registered specialist matches',
      candidates:[],
      requiresClarification:false
    };

    const result=await persistResolvedRouting(store,workflow.id,resolution);

    assert.equal(result.workflow.status,'CREATED');
    assert.equal(result.workflow.logicalSpecialistId,null);

    const decision=await store.getLatestRoutingDecision(workflow.id);
    assert.equal(decision?.routingConfidence,'NO_MATCH');
    assert.equal(decision?.selectedSpecialistId,null);

    const persisted=await store.getWorkflow(workflow.id);
    assert.equal(persisted?.logicalSpecialistId,null);
  }finally{
    await store.pool.end();
  }
});
