import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registry } from '../src/registry.js';
import { Orchestrator } from '../src/orchestrator.js';
import { MemoryStore } from '../src/store.js';
import { persistResolvedRouting } from '../src/routing.js';
import { freezeContext, Principal } from '../src/trust.js';

const principal:Principal={id:'task22l-user',roles:['developer'],scopes:['workflow:create','workflow:run'],authType:'local',maxClassification:'RESTRICTED'};
const repo={repositoryId:'repo',source:'./repo',classification:'PUBLIC' as const,allowedCallers:['task22l-user'],allowedSpecialists:['architecture-security-advisor','task22l-override','task22l-stale'],allowedExecutionTypes:['specialist'],allowedRefs:['main'],approvedRef:'main'};
const specialistOutput={objective:'x',requirements:[],constraints:[],affected_components:[],security_requirements:[],test_requirements:[],acceptance_criteria:[],validation_required:false,validation_reason:''};
const noOp={execute:async()=>({kind:'success' as const,output:specialistOutput,externalExecutionId:'task22l-specialist'})};
const unused:any={execute:async()=>({kind:'success' as const,output:{},externalExecutionId:'unused'})};
const context=(requestId:string,specialistId:string)=>freezeContext({principal,operation:'run',requestId,workflowId:'workflow',specialistId,executionType:'specialist',effectiveClassification:'PUBLIC'},repo);
const ambiguous=(store:MemoryStore,objective='security architecture')=>store.createWorkflow({requestId:`task22l-${Math.random()}`,workflowType:'non_code',logicalSpecialistId:null,runtimeId:undefined,validationRequired:false,effectiveClassification:'PUBLIC',objective,context:{principal,resolvedRepository:repo},requiresImplementation:false});
const candidate=(id:string,rank:number)=>({specialistId:id,rank,matchReason:'ambiguous evidence',evidence:{specialistId:id,registryVersion:'1.0.0',ownershipMatches:['security'],capabilityMatches:[],workflowRelationship:'none' as const,exclusionResult:'eligible' as const,specificity:1,runtimeStatus:'ACTIVE' as const,matchReason:'ambiguous evidence'}});

test('22L-01/02 clarification ignores caller routing and persists server-selected authority before execution',async()=>{
  const oldStatus=registry['architecture-security-advisor'].runtime?.status;registry['architecture-security-advisor'].runtime!.status='ACTIVE';
  const store=new MemoryStore();const workflow=ambiguous(store);const initial=await persistResolvedRouting(store,workflow.id,{routingConfidence:'AMBIGUOUS',selectedSpecialistId:null,routingReason:'ambiguous',candidates:[candidate('architecture-security-advisor',1),candidate('forged-specialist',2)],requiresClarification:true,clarificationQuestion:'Which specialist owns this?' });
  const clarification=initial.clarification!;let captured:string|undefined;const specialist={execute:async(input:any)=>{captured=input.trustedContext.specialistId;return {kind:'success' as const,output:specialistOutput,externalExecutionId:'clarification-execution'};}};
  const app=new Orchestrator(store,specialist,unused,unused,unused,{'repo':repo});
  const resumed=await app.resumeClarification(workflow.id,clarification.id,'Focus on security architecture',principal);
  assert.equal(resumed.workflow.logicalSpecialistId,'architecture-security-advisor');
  assert.equal(resumed.decision.selectedSpecialistId,'architecture-security-advisor');
  assert.equal((await store.getLatestRoutingDecision(workflow.id))?.id,resumed.decision.id);
  const runContext=freezeContext({...context(workflow.requestId,'architecture-security-advisor'),workflowId:workflow.id},repo);
  await app.run(workflow.id,runContext,'task22l-owner');
  assert.equal(captured,'architecture-security-advisor');
  assert.equal((await store.getAttempts(workflow.id)).length,1);
  registry['architecture-security-advisor'].runtime!.status=oldStatus!;
});

test('22L-03 valid override is persisted routing, not direct execution authority',async()=>{
  const alternate:any={id:'task22l-override',specialistId:'task22l-override',displayName:'Task 22L Override',description:'test',primaryOwnership:['security'],capabilities:['security review'],exclusions:[],overlapsWith:[],upstreamSpecialists:[],downstreamSpecialists:[],status:'ACTIVE',runtimeStatus:'ACTIVE',runtimeId:'task22l-override-runtime',registryVersion:'1.0.0',lastReviewedAt:'2026-09-11T00:00:00.000Z',canValidateCodex:false,runtime:{status:'ACTIVE',type:'openai_agent',runtimeId:'task22l-override-runtime',version:'1',instructionRef:'test',outputSchema:'test',timeoutSeconds:1,maxAttempts:1}};
  (registry as any)['task22l-override']=alternate;
  try{const store=new MemoryStore();const workflow=store.createWorkflow({requestId:`task22l-override-${Math.random()}`,workflowType:'non_code',logicalSpecialistId:'architecture-security-advisor',runtimeId:'architecture-security-advisor-api',validationRequired:false,effectiveClassification:'PUBLIC',objective:'security',context:{principal,resolvedRepository:repo},requiresImplementation:false});const initial={id:randomUUID(),workflowId:workflow.id,selectedSpecialistId:'architecture-security-advisor',routingConfidence:'CLEAR' as const,routingReason:'initial',decisionType:'INITIAL' as const,supersedesDecisionId:null,createdAt:new Date().toISOString()};await store.recordRoutingDecision(initial);let launched=0;const app=new Orchestrator(store,{execute:async()=>{launched++;return {kind:'success' as const,output:specialistOutput,externalExecutionId:'override'}}},unused,unused,unused,{'repo':repo});
    const result=await app.applyUserOverride(workflow.id,'task22l-override','intentional',principal,initial.id);
    assert.equal(result.workflow.logicalSpecialistId,'task22l-override');assert.equal(result.decision.decisionType,'USER_OVERRIDE');assert.equal((await store.getLatestRoutingDecision(workflow.id))?.selectedSpecialistId,'task22l-override');assert.equal(launched,0);
  }finally{delete (registry as any)['task22l-override'];}
});

test('22L-04 invalid override has zero execution or routing effects',async()=>{
  const store=new MemoryStore();const workflow=store.createWorkflow({requestId:`task22l-invalid-${Math.random()}`,workflowType:'non_code',logicalSpecialistId:'architecture-security-advisor',runtimeId:'architecture-security-advisor-api',validationRequired:false,effectiveClassification:'PUBLIC',objective:'security',context:{principal,resolvedRepository:repo},requiresImplementation:false});const initial={id:randomUUID(),workflowId:workflow.id,selectedSpecialistId:'architecture-security-advisor',routingConfidence:'CLEAR' as const,routingReason:'initial',decisionType:'INITIAL' as const,supersedesDecisionId:null,createdAt:new Date().toISOString()};await store.recordRoutingDecision(initial);const app=new Orchestrator(store,noOp,unused,unused,unused,{'repo':repo});await assert.rejects(()=>app.applyUserOverride(workflow.id,'does-not-exist','malicious',principal),/INVALID_OVERRIDE_TARGET/);assert.equal((await store.getLatestRoutingDecision(workflow.id))?.id,initial.id);assert.equal((await store.getAttempts(workflow.id)).length,0);assert.equal((await store.getArtifacts(workflow.id)).length,0);});

test('22L-05 stale caller specialist cannot re-enter execution after persisted override',async()=>{
  const alternate:any={id:'task22l-stale',specialistId:'task22l-stale',displayName:'Task 22L Stale Target',description:'test',primaryOwnership:['security'],capabilities:['security review'],exclusions:[],overlapsWith:[],upstreamSpecialists:[],downstreamSpecialists:[],status:'ACTIVE',runtimeStatus:'ACTIVE',runtimeId:'task22l-stale-runtime',registryVersion:'1.0.0',lastReviewedAt:'2026-09-11T00:00:00.000Z',canValidateCodex:false,runtime:{status:'ACTIVE',type:'openai_agent',runtimeId:'task22l-stale-runtime',version:'1',instructionRef:'test',outputSchema:'test',timeoutSeconds:1,maxAttempts:1}};
  (registry as any)['task22l-stale']=alternate;
  try{const store=new MemoryStore();const workflow=store.createWorkflow({requestId:`task22l-stale-${Math.random()}`,workflowType:'non_code',logicalSpecialistId:'architecture-security-advisor',runtimeId:'architecture-security-advisor-api',validationRequired:false,effectiveClassification:'PUBLIC',objective:'security',context:{principal,resolvedRepository:repo},requiresImplementation:false});const initial={id:randomUUID(),workflowId:workflow.id,selectedSpecialistId:'architecture-security-advisor',routingConfidence:'CLEAR' as const,routingReason:'initial',decisionType:'INITIAL' as const,supersedesDecisionId:null,createdAt:new Date().toISOString()};await store.recordRoutingDecision(initial);const app=new Orchestrator(store,noOp,unused,unused,unused,{'repo':repo});await app.applyUserOverride(workflow.id,'task22l-stale','intentional',principal,initial.id);await assert.rejects(()=>app.run(workflow.id,context(workflow.requestId,'architecture-security-advisor'), 'stale-owner'),/AUTHORIZATION_FAILED/);assert.equal((await store.getAttempts(workflow.id)).length,0);}finally{delete (registry as any)['task22l-stale'];}
});
