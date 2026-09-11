import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryStore} from '../src/store.js';
import {Orchestrator} from '../src/orchestrator.js';
import {UnavailableSpecialist,SafePromptBuilder,UnavailableCodex,UnavailableValidation,OpenAISpecialistExecutor,OpenAIValidationExecutor,createIsolatedWorkspace} from '../src/executors.js';
import {contextFromWorkflow,ExecutionContext} from '../src/trust.js';

function trusted(workflowId='w'):ExecutionContext{return Object.freeze({principal:Object.freeze({id:'caller',roles:Object.freeze(['developer']),scopes:Object.freeze(['run']),authType:'token' as const}),operation:'run',requestId:'r',workflowId,specialistId:'architecture-security-advisor',executionType:'specialist',effectiveClassification:'INTERNAL' as const,resolvedRepository:Object.freeze({repositoryId:'repo',source:'./repo',classification:'INTERNAL' as const,allowedRefs:Object.freeze(['main']),approvedRef:'main'}),authorizationDecision:Object.freeze({allowed:true as const,ruleId:'test',decidedAt:new Date().toISOString()})});}

test('malformed or denied run stops before any executor boundary',async()=>{let specialistCalls=0,codexCalls=0,validatorCalls=0;const specialist={execute:async()=>{specialistCalls++;return {kind:'terminal_failure'};}};const codex={execute:async()=>{codexCalls++;return {kind:'terminal_failure'};}};const validation={execute:async()=>{validatorCalls++;return {kind:'terminal_failure'};}};const o=new Orchestrator(new MemoryStore(),specialist as any,new SafePromptBuilder(),codex as any,validation as any);await assert.rejects(()=>o.run('w',undefined as any),/AUTHORIZATION_FAILED/);assert.deepEqual({specialistCalls,codexCalls,validatorCalls},{specialistCalls:0,codexCalls:0,validatorCalls:0});});

test('removed repository and revoked ref fail before orchestration',()=>{const workflow={id:'w',requestId:'r',logicalSpecialistId:'architecture-security-advisor',effectiveClassification:'INTERNAL' as const,context:{principal:trusted().principal,resolvedRepository:{repositoryId:'repo',source:'./old',classification:'INTERNAL' as const,allowedRefs:['main'],approvedRef:'main'}}};assert.throws(()=>contextFromWorkflow(workflow,'run','specialist',workflow.context.principal,{}),/REPOSITORY_NOT_ALLOWED/);assert.throws(()=>contextFromWorkflow(workflow,'run','specialist',workflow.context.principal,{repo:{source:'./current',classification:'INTERNAL' as const,allowedRefs:['dev']}} as any),/REPOSITORY_REF_NOT_ALLOWED/);});

test('current policy strengthening is authorization input, not historical authorization',()=>{const t=trusted();const workflow={id:'w',requestId:'r',logicalSpecialistId:t.specialistId,effectiveClassification:'INTERNAL' as const,context:{principal:t.principal,resolvedRepository:t.resolvedRepository}};const current={repo:{...t.resolvedRepository,classification:'CONFIDENTIAL' as const,allowedCallers:[]}};assert.throws(()=>contextFromWorkflow(workflow,'run','specialist',t.principal,current as any),/AUTHORIZATION_FAILED/);});

test('provider and workspace boundaries reject missing or denied context before I/O',async()=>{
  let specialistFetches=0,validationFetches=0;
  const fetchStub=async()=>{specialistFetches++;return new Response('{}',{status:200});};
  const specialist=new OpenAISpecialistExecutor('sentinel','model',fetchStub as any);
  const validation=new OpenAIValidationExecutor('sentinel','model',async()=>{validationFetches++;return new Response('{}',{status:200});});
  await assert.rejects(()=>specialist.execute(undefined as any),/AUTHORIZATION_FAILED|trustedContext/);
  await assert.rejects(()=>validation.execute(undefined as any),/AUTHORIZATION_FAILED|trustedContext/);
  const denied=trusted();
  const deniedContext=Object.freeze({...denied,resolvedRepository:Object.freeze({...denied.resolvedRepository,allowedCallers:Object.freeze([])})});
  await assert.rejects(()=>specialist.execute({trustedContext:deniedContext as any,workflowId:'w',stageId:'s',runtimeId:'r',runtimeVersion:'1',objective:'x',context:{},expectedOutputSchema:'x'}),/AUTHORIZATION_FAILED/);
  await assert.rejects(()=>validation.execute({trustedContext:deniedContext as any,workflowId:'w',stageId:'s',originalRequirements:{} as any,codexPrompt:{} as any,codexResult:{},changedFiles:[],testResults:[]}),/AUTHORIZATION_FAILED/);
  await assert.rejects(()=>createIsolatedWorkspace(undefined as any,'./workspaces'),/AUTHORIZATION_FAILED/);
  assert.equal(specialistFetches,0);
  assert.equal(validationFetches,0);
});

test('orchestration ignores historical allow after current policy denial',async()=>{
  const store=new MemoryStore();
  const historical=trusted();
  const workflow=store.createWorkflow({requestId:'historical-allow',workflowType:'software',logicalSpecialistId:historical.specialistId,runtimeId:'runtime',validationRequired:true,effectiveClassification:historical.effectiveClassification,objective:'x',context:historical,requiresImplementation:true});
  let specialistCalls=0,codexCalls=0,validationCalls=0;
  const o=new Orchestrator(store,{execute:async()=>{specialistCalls++;return {kind:'success'};}} as any,new SafePromptBuilder,{execute:async()=>{codexCalls++;return {kind:'success'};}} as any,{execute:async()=>{validationCalls++;return {kind:'success'};}} as any,{repo:{...historical.resolvedRepository,allowedCallers:Object.freeze([])}} as any);
  await assert.rejects(()=>o.run(workflow.id,historyContext(historical,workflow.id), 'worker'),/AUTHORIZATION_FAILED/);
  assert.deepEqual({specialistCalls,codexCalls,validationCalls},{specialistCalls:0,codexCalls:0,validationCalls:0});
  assert.equal(workflow.status,'ROUTED');
  assert.equal(store.getStages(workflow.id).length,0);
  assert.equal(store.getAttempts(workflow.id).length,0);
});

test('specialist runtime identity mismatch fails before provider I/O',async()=>{
  let calls=0;const executor=new OpenAISpecialistExecutor('secret','model',async()=>{calls++;return new Response('{}');});
  const base={trustedContext:trusted(),workflowId:'w',stageId:'s',runtimeId:'architecture-security-advisor-api',runtimeVersion:'1.0.0',objective:'x',context:{},expectedOutputSchema:'architecture-output-v1'};
  await assert.rejects(()=>executor.execute({...base,runtimeId:'other-runtime'}),/AUTHORIZATION_FAILED/);
  await assert.rejects(()=>executor.execute({...base,runtimeVersion:'9.9.9'}),/AUTHORIZATION_FAILED/);
  await assert.rejects(()=>executor.execute({...base,expectedOutputSchema:'untrusted-schema'}),/AUTHORIZATION_FAILED/);
  assert.equal(calls,0);
});

function historyContext(value:ExecutionContext,workflowId:string):ExecutionContext{return Object.freeze({...value,operation:'run',workflowId});}
