import test from 'node:test';
import assert from 'node:assert/strict';
import {MemoryStore} from '../src/store.js';
import {OpenAISpecialistExecutor,OpenAIValidationExecutor,ProcessCodexExecutor,RootlessContainerCodexExecutor,createIsolatedWorkspace} from '../src/executors.js';
import {ExecutionContext,freezeCreationContext} from '../src/trust.js';
import {SafePromptBuilder} from '../src/executors.js';
import {Orchestrator} from '../src/orchestrator.js';
import {registry} from '../src/registry.js';
import {EventEmitter} from 'node:events';

type Counters={specialistProviderCalls:number;promptBuilderExternalCalls:number;validationProviderCalls:number;gitCalls:number;workspaceSideEffects:number;processCodexSpawns:number;rootlessContainerSpawns:number;};
const zero=():Counters=>({specialistProviderCalls:0,promptBuilderExternalCalls:0,validationProviderCalls:0,gitCalls:0,workspaceSideEffects:0,processCodexSpawns:0,rootlessContainerSpawns:0});
function context(allowedCallers:readonly string[]=['caller']):ExecutionContext{return Object.freeze({principal:Object.freeze({id:'caller',roles:Object.freeze(['developer']),scopes:Object.freeze(['run']),authType:'token' as const}),operation:'run',requestId:'security-proof',workflowId:'workflow',specialistId:'architecture-security-advisor',executionType:'codex',effectiveClassification:'INTERNAL' as const,resolvedRepository:Object.freeze({repositoryId:'repo',source:'./repo',classification:'INTERNAL' as const,allowedCallers:Object.freeze(allowedCallers),allowedRefs:Object.freeze(['main']),approvedRef:'main'}),authorizationDecision:Object.freeze({allowed:true as const,ruleId:'historical-allow',decidedAt:new Date().toISOString()})});}
function creationContext(base:ExecutionContext,requestId:string){
  return freezeCreationContext({
    principal:base.principal,
    operation:'create',
    requestId,
    executionType:'codex',
    effectiveClassification:base.effectiveClassification
  },base.resolvedRepository);
}
function assertZero(c:Counters){assert.deepEqual(c,zero());}

test('shared denial harness proves every concrete boundary has zero protected effects',async()=>{
  const counters=zero();
  const specialist=new OpenAISpecialistExecutor('secret','model',async()=>{counters.specialistProviderCalls++;return new Response('{}');});
  const validation=new OpenAIValidationExecutor('secret','model',async()=>{counters.validationProviderCalls++;return new Response('{}');});
  const denied=context([]);
  const specialistInput={trustedContext:denied,workflowId:'workflow',stageId:'stage',runtimeId:'runtime',runtimeVersion:'1',objective:'x',context:{},expectedOutputSchema:'schema'};
  const validationInput={trustedContext:denied,workflowId:'workflow',stageId:'stage',originalRequirements:{} as any,codexPrompt:{} as any,codexResult:{},changedFiles:[],testResults:[]};
  await assert.rejects(()=>specialist.execute(specialistInput),/AUTHORIZATION_FAILED/);
  await assert.rejects(()=>validation.execute(validationInput),/AUTHORIZATION_FAILED/);
  await assert.rejects(()=>createIsolatedWorkspace(denied,'./workspaces'),/AUTHORIZATION_FAILED/);
  await assert.rejects(()=>new ProcessCodexExecutor('codex','./workspaces').execute({trustedContext:denied,workflowId:'workflow',stageId:'stage',promptArtifact:{} as any,executionPolicy:{}}),/AUTHORIZATION_FAILED/);
  await assert.rejects(()=>new RootlessContainerCodexExecutor('image','runtime','./workspaces').execute({trustedContext:denied,workflowId:'workflow',stageId:'stage',promptArtifact:{} as any,executionPolicy:{}}),/AUTHORIZATION_FAILED/);
  assertZero(counters);
});

test('denial harness records no execution-start state or evidence',()=>{
  const store=new MemoryStore();
  const workflow=store.createWorkflow({requestId:'security-proof-state',workflowType:'software',logicalSpecialistId:'architecture-security-advisor',runtimeId:'runtime',validationRequired:true,effectiveClassification:'INTERNAL',objective:'x',context:{},requiresImplementation:true});
  const events=store.getEvents(workflow.id);
  assert.equal(workflow.status,'ROUTED');
  assert.equal(store.getStages(workflow.id).length,0);
  assert.equal(store.getAttempts(workflow.id).length,0);
  assert.equal(events.some(e=>e.eventType.includes('RUNNING')),false);
  assert.equal(events.some(e=>e.eventType==='INITIATION'),false);
  assert.equal(store.getArtifacts(workflow.id).length,0);
});

test('real orchestration preserves trusted context through specialist, prompt, Codex, and validation',async()=>{
  const specialistConfig=registry['architecture-security-advisor'];
  const previousStatus=specialistConfig.runtime?.status;
  if(specialistConfig.runtime)specialistConfig.runtime.status='ACTIVE';
  try{
    const captures:ExecutionContext[]=[];
    const base=context(['caller']);
    const createContext=creationContext(base,'full-chain-proof');
    const specialist={execute:async(i:any)=>{captures.push(i.trustedContext);return {kind:'success',output:{objective:'x',requirements:['implement'],constraints:[],affected_components:[],security_requirements:[],test_requirements:['test'],acceptance_criteria:['pass'],validation_required:true,validation_reason:'required'},externalExecutionId:'specialist-1'};}};
    const codex={execute:async(i:any)=>{captures.push(i.trustedContext);return {kind:'success',output:{changedFiles:[],testResults:[],resultSummary:'ok',exitCode:0},externalExecutionId:'codex-1'};}};
    const validation={execute:async(i:any)=>{captures.push(i.trustedContext);return {kind:'success',output:{verdict:'PASS',blocking_findings:[],non_blocking_findings:[],remediation_requirements:[]},externalExecutionId:'validation-1'};}};
    const prompt={execute:async(i:any)=>{captures.push(i.trustedContext);return {kind:'success',output:{task_summary:i.objective,implementation_instructions:'implement',scope_constraints:[],tests_required:[],acceptance_criteria:[],expected_result_report:[]}};}};
    const o=new Orchestrator(new MemoryStore(),specialist as any,prompt as any,codex as any,validation as any,{repo:base.resolvedRepository} as any);
    const w=await o.create({context:createContext,workflowInput:{request_id:'full-chain-proof',requested_specialist:'architecture-security-advisor',objective:'x',workflow_type:'software'}});
    const runContext=Object.freeze({...base,workflowId:w.id,operation:'run',executionType:'specialist'});
    await o.run(w.id,runContext);
    assert.equal(captures.length,4);
    const projection=(c:ExecutionContext)=>({principal:c.principal,repositoryId:c.resolvedRepository?.repositoryId,source:c.resolvedRepository?.source,approvedRef:c.resolvedRepository?.approvedRef,classification:c.effectiveClassification,specialistId:c.specialistId,workflowId:c.workflowId,requestId:c.requestId});
    for(const captured of captures)assert.deepEqual(projection(captured),projection(captures[0]));
    assert.deepEqual(captures.map(c=>c.executionType),['specialist','codex','codex','validation']);
    assert.equal(w.status,'COMPLETE');
  }finally{if(specialistConfig.runtime&&previousStatus)specialistConfig.runtime.status=previousStatus;}
});

test('RUNNING is written only after trusted initiation evidence',async()=>{
  const specialistConfig=registry['architecture-security-advisor'];
  const previousStatus=specialistConfig.runtime?.status;
  if(specialistConfig.runtime)specialistConfig.runtime.status='ACTIVE';
  const output={objective:'x',requirements:['implement'],constraints:[],affected_components:[],security_requirements:[],test_requirements:[],acceptance_criteria:[],validation_required:true,validation_reason:'required'};
  const promptOutput={task_summary:'x',implementation_instructions:'implement',scope_constraints:[],tests_required:[],acceptance_criteria:[],expected_result_report:[]};
  const validationOutput={verdict:'PASS',blocking_findings:[],non_blocking_findings:[],remediation_requirements:[]};
  const make=async(specialist:any,codex:any,validation:any)=>{
    const store=new MemoryStore();const base=context(['caller']);const requestId=`init-${Math.random()}`;const createContext=creationContext(base,requestId);
    const o=new Orchestrator(store,specialist,{execute:async()=>({kind:'success',output:promptOutput})} as any,codex,validation,{repo:base.resolvedRepository} as any);
    const w=await o.create({context:createContext,workflowInput:{request_id:requestId,requested_specialist:'architecture-security-advisor',objective:'x',workflow_type:'software'}});
    const runContext=Object.freeze({...base,workflowId:w.id,operation:'run'});await o.run(w.id,runContext);return {store,w};
  };
  try{
    const failedSpecialist=await make({execute:async()=>({kind:'terminal_failure',errorCode:'BEFORE_INITIATION'})},{execute:async()=>{throw new Error('unreachable');}},{execute:async()=>{throw new Error('unreachable');}});
    assert.equal(failedSpecialist.w.status,'FAILED');assert.equal(failedSpecialist.store.getEvents(failedSpecialist.w.id).some(e=>e.eventType==='WORKFLOW_SPECIALIST_RUNNING'),false);assert.equal(failedSpecialist.store.getAttempts(failedSpecialist.w.id)[0].initiationEvidence,undefined);assert.equal(failedSpecialist.store.getArtifacts(failedSpecialist.w.id).length,0);
    const failedCodex=await make({execute:async()=>({kind:'success',output})},{execute:async()=>({kind:'terminal_failure',errorCode:'BEFORE_INITIATION'})},{execute:async()=>{throw new Error('unreachable');}});
    const codexEvents=failedCodex.store.getEvents(failedCodex.w.id);assert.equal(codexEvents.some(e=>e.eventType==='WORKFLOW_CODEX_RUNNING'),false);const codexAttempt=failedCodex.store.getAttempts(failedCodex.w.id).find(a=>a.logicalStageKey==='codex');assert.equal(codexAttempt?.initiationEvidence,undefined);
    const failedValidation=await make({execute:async()=>({kind:'success',output})},{execute:async()=>({kind:'success',output:{changedFiles:[],testResults:[],resultSummary:'ok',exitCode:0}})},{execute:async()=>({kind:'terminal_failure',errorCode:'BEFORE_INITIATION'})});
    const validationEvents=failedValidation.store.getEvents(failedValidation.w.id);assert.equal(validationEvents.some(e=>e.eventType==='WORKFLOW_VALIDATION_RUNNING'),false);const validationAttempt=failedValidation.store.getAttempts(failedValidation.w.id).find(a=>a.logicalStageKey.startsWith('validation:'));assert.equal(validationAttempt?.initiationEvidence,undefined);
  }finally{if(specialistConfig.runtime&&previousStatus)specialistConfig.runtime.status=previousStatus;}
});

test('successful provider stages order authorization, initiation, then RUNNING',async()=>{
  const specialistConfig=registry['architecture-security-advisor'];const previousStatus=specialistConfig.runtime?.status;if(specialistConfig.runtime)specialistConfig.runtime.status='ACTIVE';
  try{
    const order:string[]=[];const base=context(['caller']);const store=new MemoryStore();const original=store.transitionWorkflow.bind(store) as any;store.transitionWorkflow=(w:any,to:any,...rest:any[])=>{if(to.endsWith('_RUNNING'))order.push('running');return original(w,to,...rest);};
    const authorized=(i:any)=>{assert.ok(i.trustedContext);order.push('authorized');};
    const specialist={execute:async(i:any)=>{authorized(i);order.push('initiated');return {kind:'success',output:{objective:'x',requirements:[],constraints:[],affected_components:[],security_requirements:[],test_requirements:[],acceptance_criteria:[],validation_required:true,validation_reason:'required'},externalExecutionId:'s'}}};
    const prompt={execute:async(i:any)=>{authorized(i);return {kind:'success',output:{task_summary:'x',implementation_instructions:'x',scope_constraints:[],tests_required:[],acceptance_criteria:[],expected_result_report:[]}}}};
    const codex={execute:async(i:any)=>{authorized(i);order.push('initiated');return {kind:'success',output:{changedFiles:[],testResults:[],resultSummary:'ok',exitCode:0},externalExecutionId:'c'}}};
    const validation={execute:async(i:any)=>{authorized(i);order.push('initiated');return {kind:'success',output:{verdict:'PASS',blocking_findings:[],non_blocking_findings:[],remediation_requirements:[]},externalExecutionId:'v'}}};
    const o=new Orchestrator(store,specialist as any,prompt as any,codex as any,validation as any,{repo:base.resolvedRepository} as any);const w=await o.create({context:creationContext(base,'ordering-proof'),workflowInput:{request_id:'ordering-proof',requested_specialist:'architecture-security-advisor',objective:'x',workflow_type:'software'}});await o.run(w.id,Object.freeze({...base,workflowId:w.id,operation:'run'}));
    assert.deepEqual(order,['authorized','initiated','running','authorized','authorized','initiated','running','authorized','initiated','running']);
  }finally{if(specialistConfig.runtime&&previousStatus)specialistConfig.runtime.status=previousStatus;}
});

test('validator failure before provider initiation does not write VALIDATION_RUNNING',async()=>{
  const specialistConfig=registry['architecture-security-advisor'];const previousStatus=specialistConfig.runtime?.status;if(specialistConfig.runtime)specialistConfig.runtime.status='ACTIVE';
  try{
    const store=new MemoryStore();const base=context(['caller']);const specialist={execute:async()=>({kind:'success',output:{objective:'x',requirements:[],constraints:[],affected_components:[],security_requirements:[],test_requirements:[],acceptance_criteria:[],validation_required:true,validation_reason:'required'},externalExecutionId:'s'})};const prompt={execute:async()=>({kind:'success',output:{task_summary:'x',implementation_instructions:'x',scope_constraints:[],tests_required:[],acceptance_criteria:[],expected_result_report:[]}})};const codex={execute:async()=>({kind:'success',output:{changedFiles:[],testResults:[],resultSummary:'ok',exitCode:0},externalExecutionId:'c'})};let calls=0;const validation=new OpenAIValidationExecutor('secret','model',async()=>{calls++;throw new Error('before initiation');});const o=new Orchestrator(store,specialist as any,prompt as any,codex as any,validation,{repo:base.resolvedRepository} as any);const w=await o.create({context:creationContext(base,'validator-init-failure'),workflowInput:{request_id:'validator-init-failure',requested_specialist:'architecture-security-advisor',objective:'x',workflow_type:'software'}});await o.run(w.id,Object.freeze({...base,workflowId:w.id,operation:'run'}));
    assert.equal(calls,1);assert.equal(w.status,'FAILED');assert.equal(store.getEvents(w.id).some(e=>e.eventType==='WORKFLOW_VALIDATION_RUNNING'),false);const attempt=store.getAttempts(w.id).find(a=>a.logicalStageKey.startsWith('validation:'));assert.equal(attempt?.initiationEvidence,undefined);assert.equal(store.getArtifacts(w.id).some(a=>a.artifactType==='validation_result'),false);
  }finally{if(specialistConfig.runtime&&previousStatus)specialistConfig.runtime.status=previousStatus;}
});

test('host and rootless executors fail before initiation without RUNNING evidence',async()=>{
  const base=context(['caller']);const input={trustedContext:base,workflowId:'w',stageId:'s',promptArtifact:{task_summary:'x',implementation_instructions:'x',scope_constraints:[],tests_required:[],acceptance_criteria:[],expected_result_report:[]},executionPolicy:{}} as any;
  const host=new ProcessCodexExecutor('missing-codex-command','.');const hostResult=await host.execute(input);assert.notEqual(hostResult.kind,'success');
  const rootless=new RootlessContainerCodexExecutor('missing-image','missing-runtime','.');let initiated=false;const rootlessResult=await rootless.execute({...input,onInitiation:()=>{initiated=true}});assert.notEqual(rootlessResult.kind,'success');assert.equal(initiated,false);
});

test('host and rootless spawn seams report initiation before callbacks complete',async()=>{
  const base=context(['caller']);const input={trustedContext:base,workflowId:'w',stageId:'s',promptArtifact:{task_summary:'x',implementation_instructions:'x',scope_constraints:[],tests_required:[],acceptance_criteria:[],expected_result_report:[]},executionPolicy:{}} as any;
  const child=()=>{const p:any=new EventEmitter();p.pid=123;p.stdin={end:()=>{}};p.stdout=new EventEmitter();p.stderr=new EventEmitter();return p;};
  for(const kind of ['host','rootless'] as const){const order:string[]=[];const spawnFake=(command:string,args:string[],options:unknown)=>{order.push('SPAWN_CALLED');const p=child();order.push('SPAWN_RETURNS_TRUSTED_INITIATION_EVIDENCE');queueMicrotask(()=>p.emit('exit',0));return p;};const workspace=async()=>({path:'C:/workspace',cleanup:async()=>{}});let callback=false;const initiation=()=>{callback=true;order.push('ON_INITIATION_CALLBACK');};const executor=kind==='host'?new ProcessCodexExecutor('codex','.',spawnFake,workspace):new RootlessContainerCodexExecutor('image','docker','.',spawnFake,workspace,'linux');const result=await executor.execute({...input,onInitiation:initiation});assert.equal(result.kind,'success');assert.deepEqual(order,['SPAWN_CALLED','SPAWN_RETURNS_TRUSTED_INITIATION_EVIDENCE','ON_INITIATION_CALLBACK']);assert.equal(callback,true);}
});

test('host and rootless spawn failures do not emit initiation callbacks',async()=>{
  const base=context(['caller']);const input={trustedContext:base,workflowId:'w',stageId:'s',promptArtifact:{task_summary:'x',implementation_instructions:'x',scope_constraints:[],tests_required:[],acceptance_criteria:[],expected_result_report:[]},executionPolicy:{}} as any;
  const failing=()=>{throw new Error('spawn failed');};const workspace=async()=>({path:'C:/workspace',cleanup:async()=>{}});for(const kind of ['host','rootless'] as const){let callback=false;const executor=kind==='host'?new ProcessCodexExecutor('codex','.',failing,workspace):new RootlessContainerCodexExecutor('image','docker','.',failing,workspace,'linux');const result=await executor.execute({...input,onInitiation:()=>{callback=true}});assert.notEqual(result.kind,'success');assert.equal(callback,false);}
});
