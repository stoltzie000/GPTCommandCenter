import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { MemoryStore } from '../src/store.js';
import { Orchestrator } from '../src/orchestrator.js';
import { SafePromptBuilder, UnavailableCodex, UnavailableSpecialist, UnavailableValidation } from '../src/executors.js';
import { contextFromWorkflow, freezeCreationContext } from '../src/trust.js';
import { buildOrchestrationPlan } from '../src/orchestration-plan.js';
import { registry } from '../src/registry.js';
import { readWorkflow } from '../src/workflow-read-model.js';

const repository={repositoryId:'task27-repo',source:'./task27-repo',classification:'PUBLIC' as const,allowedCallers:['task27-user'],allowedExecutionTypes:['specialist' as const]};
const principal={id:'task27-user',roles:['developer'] as const,scopes:['workflow:create','run'] as const,authType:'local' as const};
const output={summary:'manual security review',findings:['preserve repository authorization']};
const activate=(specialist:any)=>{const old={runtimeStatus:specialist.runtimeStatus,runtimeId:specialist.runtimeId,runtime:specialist.runtime};specialist.runtimeStatus='ACTIVE';specialist.runtimeId=`${specialist.id}-task27-runtime`;specialist.runtime={status:'ACTIVE',type:'openai_agent',runtimeId:specialist.runtimeId,version:'1',instructionRef:'task27',outputSchema:'task27',timeoutSeconds:30,maxAttempts:1};return ()=>{specialist.runtimeStatus=old.runtimeStatus;specialist.runtimeId=old.runtimeId;specialist.runtime=old.runtime;};};

async function manualPlan(){
  const architecture=registry['architecture-security-advisor'];const old={runtimeStatus:architecture.runtimeStatus,chatgptUrl:architecture.chatgptUrl};architecture.runtimeStatus='MANUAL_ONLY';architecture.chatgptUrl='https://chatgpt.com/g/g-task27-security';
  const store=new MemoryStore();const requestId=randomUUID();const context=freezeCreationContext({principal,operation:'create',requestId,executionType:'specialist',effectiveClassification:'PUBLIC'},repository);
  const app=new Orchestrator(store,new UnavailableSpecialist(),new SafePromptBuilder(),new UnavailableCodex(),new UnavailableValidation(),{'task27-repo':repository});
  const workflow=await store.createWorkflow({requestId,workflowType:'non_code',logicalSpecialistId:'architecture-security-advisor',runtimeId:undefined,validationRequired:false,effectiveClassification:'PUBLIC',objective:'security and repository review',context,requiresImplementation:false});
  const built=buildOrchestrationPlan(workflow.id,[{specialistId:'architecture-security-advisor',rank:1,matchReason:'security ownership',evidence:{} as any},{specialistId:'github-oracle',rank:2,matchReason:'repository context',evidence:{} as any}],registry);
  await store.createOrchestrationPlan(built.plan,built.stages);const plan=await store.getOrchestrationPlan(workflow.id)!;const stages=await store.getOrchestrationPlanStages(plan!.id);await store.updateOrchestrationPlanStage(plan!.id,stages[0].id,'MANUAL_HANDOFF_REQUIRED');await store.updateOrchestrationPlan(plan!.id,'MANUAL_HANDOFF_REQUIRED');workflow.status='MANUAL_HANDOFF_REQUIRED';assert.equal((await store.getWorkflow(workflow.id))?.status,'MANUAL_HANDOFF_REQUIRED');
  return {store,app,workflow,plan:plan!,stage:stages[0],architecture,old};
}

test('authorized stage return is exact, durable, externally attributed, and idempotent',async()=>{
  const fixture=await manualPlan();try{
    const pending=await readWorkflow(fixture.store,fixture.workflow,await fixture.app.getSpecialistCatalog());const stage=pending.orchestrationPlan?.stages[0];assert.equal(stage?.manualHandoff?.available,true);assert.match(stage?.manualHandoff?.returnEndpoint??'',/plans\/.*\/stages\/.*\/handoff-response/);
    const accepted=await fixture.app.acceptManualStageHandoff(fixture.workflow.id,fixture.plan.id,fixture.stage.id,output,principal);assert.equal(accepted.status,'SPECIALIST_RUNNING');
    const stored=await fixture.store.getArtifacts(fixture.workflow.id);const artifact=stored.find(item=>item.planStageId===fixture.stage.id);assert.equal(artifact?.artifactType,'manual_specialist_output');assert.equal(artifact?.planId,fixture.plan.id);assert.equal(artifact?.specialistId,fixture.stage.specialistId);
    assert.equal((await fixture.store.getOrchestrationPlanStages(fixture.plan.id))[0].status,'COMPLETE');
    const repeated=await fixture.app.acceptManualStageHandoff(fixture.workflow.id,fixture.plan.id,fixture.stage.id,output,principal);assert.equal(repeated.id,accepted.id);assert.equal((await fixture.store.getArtifacts(fixture.workflow.id)).filter(item=>item.planStageId===fixture.stage.id).length,1);
    await assert.rejects(()=>fixture.app.acceptManualStageHandoff(fixture.workflow.id,fixture.plan.id,fixture.stage.id,{summary:'conflict'},principal),/MANUAL_STAGE_HANDOFF_ALREADY_ACCEPTED/);
  }finally{fixture.architecture.runtimeStatus=fixture.old.runtimeStatus;fixture.architecture.chatgptUrl=fixture.old.chatgptUrl;}
});

test('stage return preserves principal and exact plan/stage boundaries',async()=>{
  const fixture=await manualPlan();try{
    await assert.rejects(()=>fixture.app.acceptManualStageHandoff(fixture.workflow.id,fixture.plan.id,fixture.stage.id,output,{...principal,id:'other-user'}),/AUTHORIZATION_FAILED/);
    await assert.rejects(()=>fixture.app.acceptManualStageHandoff(fixture.workflow.id,randomUUID(),fixture.stage.id,output,principal),/MANUAL_STAGE_HANDOFF_PLAN_MISMATCH/);
    await assert.rejects(()=>fixture.app.acceptManualStageHandoff(fixture.workflow.id,fixture.plan.id,randomUUID(),output,principal),/MANUAL_STAGE_HANDOFF_STAGE_MISMATCH|MANUAL_STAGE_HANDOFF_STAGE_NOT_READY/);
    assert.equal((await fixture.store.getArtifacts(fixture.workflow.id)).length,0);
  }finally{fixture.architecture.runtimeStatus=fixture.old.runtimeStatus;fixture.architecture.chatgptUrl=fixture.old.chatgptUrl;}
});

test('eligible dependent stage continues only after manual stage completion',async()=>{
  const fixture=await manualPlan();const restore=activate(registry['github-oracle']);fixture.app.specialist={execute:async()=>({kind:'success',output:{summary:'repository context'}})} as any;try{
    await fixture.app.acceptManualStageHandoff(fixture.workflow.id,fixture.plan.id,fixture.stage.id,output,principal);
    const runContext=contextFromWorkflow(await fixture.store.getWorkflow(fixture.workflow.id)!, 'run','specialist',principal,{'task27-repo':repository});
    await fixture.app.run(fixture.workflow.id,runContext,'task27-worker');
    const stages=await fixture.store.getOrchestrationPlanStages(fixture.plan.id);assert.deepEqual(stages.map(stage=>stage.status),['COMPLETE','COMPLETE'],JSON.stringify({workflow:await fixture.store.getWorkflow(fixture.workflow.id),events:await fixture.store.getEvents(fixture.workflow.id)}));assert.equal((await fixture.store.getWorkflow(fixture.workflow.id))?.status,'COMPLETE');
  }finally{restore();fixture.architecture.runtimeStatus=fixture.old.runtimeStatus;fixture.architecture.chatgptUrl=fixture.old.chatgptUrl;}
});
