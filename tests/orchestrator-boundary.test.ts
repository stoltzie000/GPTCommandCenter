import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryStore} from '../src/store.js';
import {Orchestrator} from '../src/orchestrator.js';
import {
  UnavailableSpecialist,
  SafePromptBuilder,
  UnavailableCodex,
  UnavailableValidation
} from '../src/executors.js';
import {freezeCreationContext,freezeContext} from '../src/trust.js';

const principal={
  id:'local',
  roles:[] as readonly string[],
  scopes:[] as readonly string[],
  authType:'local' as const
};

const repo={
  repositoryId:'repo',
  source:'./repo',
  classification:'PUBLIC' as const
};

const createContext=(requestId='boundary-request')=>freezeCreationContext({
  principal,
  operation:'create',
  requestId,
  executionType:'codex',
  effectiveClassification:'PUBLIC'
},repo);

const runContext=(requestId:string,workflowId:string)=>freezeContext({
  principal,
  operation:'run',
  requestId,
  workflowId,
  specialistId:'architecture-security-advisor',
  executionType:'specialist',
  effectiveClassification:'PUBLIC'
},repo);

test('workflow creation requires a trusted context and ignores raw caller channels',async()=>{
  const o=new Orchestrator(
    new MemoryStore(),
    new UnavailableSpecialist(),
    new SafePromptBuilder(),
    new UnavailableCodex(),
    new UnavailableValidation()
  );

  const input={
    request_id:'boundary-request',
    workflow_type:'software' as const,
    requested_specialist:'architecture-security-advisor',
    objective:'x'
  };

  await assert.rejects(
    ()=>(o as any).create(input,'forged-caller'),
    /AUTHORIZATION_FAILED/
  );

  const w=await o.create({
    context:createContext(input.request_id),
    workflowInput:input
  });

  assert.equal(w.context&&typeof w.context,'object');
});

test('run requires a context bound to the current workflow',async()=>{
  const o=new Orchestrator(
    new MemoryStore(),
    new UnavailableSpecialist(),
    new SafePromptBuilder(),
    new UnavailableCodex(),
    new UnavailableValidation()
  );

  const input={
    request_id:'boundary-request-2',
    workflow_type:'software' as const,
    requested_specialist:'architecture-security-advisor',
    objective:'x'
  };

  const w=await o.create({
    context:createContext(input.request_id),
    workflowInput:input
  });

  await assert.rejects(
    ()=>o.run(w.id,runContext(w.requestId,'different-workflow')),
    /AUTHORIZATION_FAILED/
  );
});

test('create rejects an unauthorized operation before persistence',async()=>{
  let writes=0;
  const store=new MemoryStore();
  const original=store.createWorkflow.bind(store);

  (store as any).createWorkflow=(...args:any[])=>{
    writes++;
    return (original as any)(...args);
  };

  const o=new Orchestrator(
    store,
    new UnavailableSpecialist(),
    new SafePromptBuilder(),
    new UnavailableCodex(),
    new UnavailableValidation()
  );

  const input={
    request_id:'boundary-request-3',
    workflow_type:'software' as const,
    requested_specialist:'architecture-security-advisor',
    objective:'x'
  };

  await assert.rejects(
    ()=>o.create({
      context:{...createContext(input.request_id),operation:'admin-delete'} as any,
      workflowInput:input
    }),
    /AUTHORIZATION_FAILED/
  );

  assert.equal(writes,0);
});
