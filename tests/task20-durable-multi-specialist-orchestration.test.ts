import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { MemoryStore } from '../src/store.js';
import { Orchestrator } from '../src/orchestrator.js';
import { SafePromptBuilder, UnavailableCodex, UnavailableSpecialist, UnavailableValidation } from '../src/executors.js';
import { contextFromWorkflow, freezeCreationContext } from '../src/trust.js';
import { registry } from '../src/registry.js';
import { buildOrchestrationPlan } from '../src/orchestration-plan.js';
import { buildDynamicSpecialist } from '../src/specialist-catalog.js';
import { SelectedCandidate, TaskInterpretation } from '../src/domain.js';

const repository={repositoryId:'task20-repo',source:'./task20-repo',classification:'PUBLIC' as const,allowedCallers:['task20-user'],allowedExecutionTypes:['specialist' as const]};
const principal={id:'task20-user',roles:['developer'] as const,scopes:['workflow:create','run'] as const,authType:'local' as const};
const candidate=(specialistId:string,rank:number):SelectedCandidate=>({specialistId,rank,matchReason:`coverage from ${specialistId}`,evidence:{specialistId,registryVersion:'1.0.0',ownershipMatches:['coverage'],capabilityMatches:['coverage'],workflowRelationship:'none',exclusionResult:'eligible',specificity:2,runtimeStatus:'UNVERIFIED',matchReason:`coverage from ${specialistId}`}});
const activate=(specialist:any)=>{const old={runtimeStatus:specialist.runtimeStatus,runtimeId:specialist.runtimeId,runtime:specialist.runtime};specialist.runtimeStatus='ACTIVE';specialist.runtimeId=`${specialist.id}-runtime`;specialist.runtime={status:'ACTIVE',type:'openai_agent',runtimeId:specialist.runtimeId,version:'1',instructionRef:'task20',outputSchema:'task20',timeoutSeconds:30,maxAttempts:1};return ()=>{specialist.runtimeStatus=old.runtimeStatus;specialist.runtimeId=old.runtimeId;specialist.runtime=old.runtime;};};
const seedCollective=(store:MemoryStore)=>{const interpretation:TaskInterpretation={intent:'security review',requestedOutcome:'security review',taskCategories:['security review'],requiredCapabilities:['security analysis'],excludedCapabilities:[],inputTypes:[],expectedOutputTypes:[],workflowContext:{},requiresCurrentInformation:false,requiresExecutableRuntime:false};const dynamic=buildDynamicSpecialist(interpretation,'task20-seed');dynamic.primaryOwnership=['security review'];dynamic.capabilities=['security analysis'];void store.createDynamicSpecialist(dynamic);return dynamic;};

test('collective coverage creates a durable plan without dynamic creation',async()=>{
  const store=new MemoryStore();seedCollective(store);
  const app=new Orchestrator(store,new UnavailableSpecialist(),new SafePromptBuilder(),new UnavailableCodex(),new UnavailableValidation());
  const context=freezeCreationContext({principal,operation:'create',requestId:'task20-plan',executionType:'specialist',effectiveClassification:'PUBLIC'},repository);
  const workflow=await app.create({context,workflowInput:{request_id:'task20-plan',objective:'review security architecture',workflow_type:'non_code'}});
  const plan=await store.getOrchestrationPlan(workflow.id);
  assert.ok(plan);
  assert.equal(plan?.status,'PLANNED');
  assert.equal((await store.getOrchestrationPlanStages(plan!.id)).length,2);
  assert.equal(store.dynamicSpecialists.size,1);
  assert.equal((await store.getEvents(workflow.id)).some(event=>event.eventType==='ORCHESTRATION_PLAN_CREATED'),true);
});

test('plan execution is ordered, hands off bounded predecessor artifacts, and is duplicate-safe',async()=>{
  const store=new MemoryStore();const dynamic=seedCollective(store);
  const restoreA=activate(registry['architecture-security-advisor']);
  const restoreB=activate(dynamic);
  try{
    const contexts:any[]=[];let calls=0;
    const specialist={execute:async(input:any)=>{calls++;contexts.push(input.context);return {kind:'success',output:{producer:input.trustedContext.specialistId},externalExecutionId:`attempt-${calls}`};}};
    const app=new Orchestrator(store,specialist as any,new SafePromptBuilder(),new UnavailableCodex(),new UnavailableValidation(),{'task20-repo':repository});
    const context=freezeCreationContext({principal,operation:'create',requestId:'task20-execute',executionType:'specialist',effectiveClassification:'PUBLIC'},repository);
    const workflow=await app.create({context,workflowInput:{request_id:'task20-execute',objective:'review security architecture',workflow_type:'non_code'}});
    const runContext=contextFromWorkflow(workflow,'run','specialist',principal,{'task20-repo':repository});
    await app.run(workflow.id,runContext,'task20-worker');
    await app.run(workflow.id,runContext,'task20-worker');
    const plan=await store.getOrchestrationPlan(workflow.id);assert.ok(plan);
    const stages=await store.getOrchestrationPlanStages(plan!.id);
    assert.equal(calls,2);assert.ok(contexts[1].predecessorArtifacts.length===1);assert.equal(stages.every(stage=>stage.status==='COMPLETE'),true);
    assert.equal((await store.getArtifacts(workflow.id)).filter(artifact=>artifact.planId===plan!.id).length,2);
    assert.equal((await store.getWorkflow(workflow.id))?.status,'COMPLETE');
  }finally{restoreA();restoreB();}
});

test('runtime-unavailable plan produces manual handoff without execution',async()=>{
  const store=new MemoryStore();seedCollective(store);let calls=0;
  const app=new Orchestrator(store,{execute:async()=>{calls++;return {kind:'success',output:{}};}} as any,new SafePromptBuilder(),new UnavailableCodex(),new UnavailableValidation());
  const context=freezeCreationContext({principal,operation:'create',requestId:'task20-unavailable',executionType:'specialist',effectiveClassification:'PUBLIC'},repository);
  const workflow=await app.create({context,workflowInput:{request_id:'task20-unavailable',objective:'review security architecture',workflow_type:'non_code'}});
  const runContext=contextFromWorkflow(workflow,'run','specialist',principal,{'task20-repo':repository});
  await app.run(workflow.id,runContext);
  assert.equal(calls,0);assert.equal((await store.getWorkflow(workflow.id))?.status,'MANUAL_HANDOFF_REQUIRED');
  const plan=await store.getOrchestrationPlan(workflow.id);assert.equal((await store.getOrchestrationPlanStages(plan!.id))[0].status,'MANUAL_HANDOFF_REQUIRED');
});

test('invalid orchestration dependencies are rejected before persistence',async()=>{
  const store=new MemoryStore();const workflow=store.createWorkflow({requestId:'task20-invalid',workflowType:'non_code',logicalSpecialistId:'architecture-security-advisor',runtimeId:undefined,validationRequired:false,effectiveClassification:'PUBLIC',objective:'invalid plan',context:{},requiresImplementation:false});
  const plan={id:randomUUID(),workflowId:workflow.id,version:1,status:'PLANNED' as const,reason:'test',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  const a={id:randomUUID(),planId:plan.id,workflowId:workflow.id,specialistId:'architecture-security-advisor',purpose:'a',dependencies:[] as string[],status:'PENDING' as const,order:0};
  const b={id:randomUUID(),planId:plan.id,workflowId:workflow.id,specialistId:'github-oracle',purpose:'b',dependencies:[a.id],status:'PENDING' as const,order:1};
  a.dependencies=[b.id];
  await assert.rejects(()=>store.createOrchestrationPlan(plan,[a,b]),/ORCHESTRATION_PLAN_CYCLE/);
  assert.equal(await store.getOrchestrationPlan(workflow.id),undefined);
});

test('plan-scoped artifacts require a matching plan stage',async()=>{
  const store=new MemoryStore();const dynamic=seedCollective(store);const workflow=store.createWorkflow({requestId:'task20-artifact',workflowType:'non_code',logicalSpecialistId:'architecture-security-advisor',runtimeId:undefined,validationRequired:false,effectiveClassification:'PUBLIC',objective:'artifact',context:{},requiresImplementation:false});
  const built=buildOrchestrationPlan(workflow.id,[candidate('architecture-security-advisor',1),candidate(dynamic.id,2)],store.getEffectiveSpecialistsSync());
  await store.createOrchestrationPlan(built.plan,built.stages);
  assert.throws(()=>store.addArtifact(workflow.id,'orchestration_specialist_output',{ok:true},{planId:built.plan.id,planStageId:randomUUID()}),/ARTIFACT_PLAN_STAGE/);
  assert.throws(()=>store.addArtifact(workflow.id,'orchestration_specialist_output',{ok:true},{planStageId:built.stages[0].id}),/ARTIFACT_PLAN_REQUIRED/);
});

test('plan builder produces a valid sequential topology',()=>{
  const result=buildOrchestrationPlan('workflow', [candidate('architecture-security-advisor',1),candidate('github-oracle',2)], registry);
  assert.equal(result.stages[0].dependencies.length,0);assert.deepEqual(result.stages[1].dependencies,[result.stages[0].id]);
});
