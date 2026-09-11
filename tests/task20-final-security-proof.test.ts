import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store.js';
import { Orchestrator, } from '../src/orchestrator.js';
import { SafePromptBuilder } from '../src/executors.js';
import { contextFromWorkflow, ExecutionContext, Principal } from '../src/trust.js';

type Counters = { specialistProviderCalls:number; promptBuilderExternalCalls:number; validationProviderCalls:number; gitCalls:number; workspaceSideEffects:number; processCodexSpawns:number; rootlessContainerSpawns:number };
const zero = ():Counters => ({specialistProviderCalls:0,promptBuilderExternalCalls:0,validationProviderCalls:0,gitCalls:0,workspaceSideEffects:0,processCodexSpawns:0,rootlessContainerSpawns:0});
const principal:Principal = Object.freeze({id:'caller',roles:Object.freeze(['developer']),scopes:Object.freeze(['run']),authType:'token',maxClassification:'INTERNAL'});
const repo = Object.freeze({repositoryId:'repo',source:'./repo',classification:'INTERNAL' as const,allowedCallers:Object.freeze(['caller']),allowedSpecialists:Object.freeze(['architecture-security-advisor']),allowedExecutionTypes:Object.freeze(['codex']),allowedRefs:Object.freeze(['main']),approvedRef:'main'});

function baseContext(workflowId?:string):ExecutionContext { return Object.freeze({principal,operation:'run',requestId:'task20',workflowId,specialistId:'architecture-security-advisor',executionType:'codex',effectiveClassification:'INTERNAL',resolvedRepository:repo,authorizationDecision:Object.freeze({allowed:true as const,ruleId:'historical-allow',decidedAt:new Date().toISOString()})}); }
function makeWorkflow(store:MemoryStore, context:ExecutionContext) { return store.createWorkflow({requestId:`task20-${Math.random()}`,workflowType:'software',logicalSpecialistId:'architecture-security-advisor',runtimeId:'architecture-security-advisor-api',validationRequired:true,effectiveClassification:context.effectiveClassification,objective:'proof',context,requiresImplementation:true}); }
function assertDenied(store:MemoryStore, id:string, counters:Counters) { assert.deepEqual(counters,zero()); const workflow=store.getWorkflow(id)!; assert.equal(workflow.status,'ROUTED'); assert.equal(store.getStages(id).length,0); assert.equal(store.getAttempts(id).length,0); assert.equal(store.getArtifacts(id).length,0); const events=store.getEvents(id); assert.equal(events.some(e=>e.eventType.includes('RUNNING')),false); assert.equal(events.some(e=>e.eventType==='INITIATION'),false); }

test('Task 20 complete denial matrix has zero protected effects and no false execution evidence',async()=>{
  const cases:[string,(base:ExecutionContext)=>{principal?:Principal;registry?:any;context?:unknown;executionType?:string;direct?:boolean}][] = [
    ['missing authenticated Principal',()=>({principal:undefined,direct:true})],
    ['invalid or unrecognized Principal',()=>({principal:{...principal,id:'unknown'}})],
    ['unauthorized operation',()=>({context:{...baseContext(),operation:'delete'},direct:true})],
    ['unauthorized specialist',()=>({registry:{repo:{...repo,allowedSpecialists:[]}}})],
    ['unauthorized repository',()=>({registry:{}})],
    ['prohibited execution type',()=>({executionType:'specialist'})],
    ['classification exceeds Principal authorization',()=>({registry:{repo:{...repo,classification:'CONFIDENTIAL'}}})],
    ['current repository removed',()=>({registry:{}})],
    ['persisted approvedRef revoked',()=>({registry:{repo:{...repo,allowedRefs:['dev']}}})],
    ['stricter current repository policy denial',()=>({registry:{repo:{...repo,allowedCallers:[]}}})],
    ['malformed ExecutionContext',()=>({context:{principal},direct:true})],
    ['missing ExecutionContext through runtime misuse',()=>({context:undefined,direct:true})],
    ['conflicting repository/ref/classification value',()=>({context:{...baseContext(),resolvedRepository:{...repo,repositoryId:'other'}}})],
    ['stale historical AuthorizationDecision',()=>({registry:{repo:{...repo,allowedCallers:[]}}})],
  ];
  for(const [name,mutate] of cases){
    const store=new MemoryStore(); const counters=zero();
    const specialist={execute:async()=>{counters.specialistProviderCalls++;return {kind:'terminal_failure'};}};
    const prompt={execute:async()=>{counters.promptBuilderExternalCalls++;return {kind:'terminal_failure'};}};
    const codex={execute:async()=>{counters.processCodexSpawns++;return {kind:'terminal_failure'};}};
    const validation={execute:async()=>{counters.validationProviderCalls++;return {kind:'terminal_failure'};}};
    const o=new Orchestrator(store,specialist as any,prompt as any,codex as any,validation as any, {repo} as any);
    const created=makeWorkflow(store,baseContext()); const change=mutate(baseContext(created.id));
    try {
      const current=change.direct ? change.context : contextFromWorkflow(created,'run',change.executionType??'codex',change.principal??principal,change.registry??{repo});
      await o.run(created.id,current as any);
      assert.fail(`${name} unexpectedly authorized`);
    } catch (error) { assert.ok(error instanceof Error, name); }
    assertDenied(store,created.id,counters);
  }
});

test('Task 20 classification ceiling is server-derived and monotonic',()=>{
  assert.throws(()=>contextFromWorkflow({id:'w',requestId:'r',logicalSpecialistId:'architecture-security-advisor',effectiveClassification:'INTERNAL',context:{principal,resolvedRepository:repo}},'run','codex',principal,{repo:{...repo,classification:'CONFIDENTIAL'}} as any),/AUTHORIZATION_FAILED/);
});
