import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store.js';
import { Orchestrator } from '../src/orchestrator.js';
import {
  UnavailableSpecialist,
  SafePromptBuilder,
  UnavailableCodex,
  UnavailableValidation
} from '../src/executors.js';
import { freezeCreationContext } from '../src/trust.js';

const principal={
  id:'creator',
  roles:[] as readonly string[],
  scopes:[] as readonly string[],
  authType:'local' as const,
  maxClassification:'RESTRICTED' as const
};

function context(allowedSpecialists?:readonly string[]){
  return freezeCreationContext({
    principal,
    operation:'create',
    requestId:`task22k-${Math.random()}`,
    executionType:'specialist',
    effectiveClassification:'PUBLIC'
  },{
    repositoryId:'repo',
    source:'./repo',
    classification:'PUBLIC',
    allowedCallers:['creator'],
    allowedExecutionTypes:['specialist'],
    ...(allowedSpecialists?{allowedSpecialists}: {})
  });
}

function orchestrator(store=new MemoryStore()){
  return new Orchestrator(
    store,
    new UnavailableSpecialist(),
    new SafePromptBuilder(),
    new UnavailableCodex(),
    new UnavailableValidation()
  );
}

test('Task 22K creation routes objective before granting specialist authority',async()=>{
  const store=new MemoryStore();
  const app=orchestrator(store);
  const c=context();

  const workflow=await app.create({
    context:{...c,requestId:'task22k-authoritative-route'},
    workflowInput:{
      request_id:'task22k-authoritative-route',
      objective:'perform architecture and security review',
      workflow_type:'non_code'
    }
  });

  assert.equal(workflow.status,'ROUTED');
  assert.equal(workflow.logicalSpecialistId,'architecture-security-advisor');

  const decision=await store.getLatestRoutingDecision(workflow.id);
  assert.equal(decision?.selectedSpecialistId,'architecture-security-advisor');
});

test('Task 22K requested specialist is not trusted authority',async()=>{
  const store=new MemoryStore();
  const app=orchestrator(store);
  const c=context([]);

  const workflow=await app.create({
    context:{...c,requestId:'task22k-requested-not-authority'},
    workflowInput:{
      request_id:'task22k-requested-not-authority',
      requested_specialist:'architecture-security-advisor',
      objective:'perform architecture review',
      workflow_type:'non_code'
    }
  });

  assert.equal(workflow.status,'CREATED');
  assert.equal(workflow.logicalSpecialistId,null);

  const decision=await store.getLatestRoutingDecision(workflow.id);
  assert.equal(decision?.routingConfidence,'NO_MATCH');
  assert.equal(decision?.selectedSpecialistId,null);
});

test('Task 22K creation filters routing candidates through repository specialist policy',async()=>{
  const store=new MemoryStore();
  const app=orchestrator(store);
  const c=context(['python-oracle']);

  const workflow=await app.create({
    context:{...c,requestId:'task22k-policy-filter'},
    workflowInput:{
      request_id:'task22k-policy-filter',
      objective:'security architecture review',
      workflow_type:'non_code'
    }
  });

  assert.equal(workflow.status,'CREATED');
  assert.equal(workflow.logicalSpecialistId,null);

  const decision=await store.getLatestRoutingDecision(workflow.id);
  assert.equal(decision?.routingConfidence,'NO_MATCH');
});
