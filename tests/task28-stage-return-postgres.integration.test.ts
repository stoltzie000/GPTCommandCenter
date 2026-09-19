import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PgStore } from '../src/pg-store.js';
import { Orchestrator } from '../src/orchestrator.js';
import { SafePromptBuilder, UnavailableCodex, UnavailableSpecialist, UnavailableValidation } from '../src/executors.js';
import { freezeCreationContext } from '../src/trust.js';
import { buildOrchestrationPlan } from '../src/orchestration-plan.js';
import { registry } from '../src/registry.js';

const url=process.env.PG_TEST_URL;
const principal={id:'task28-user',roles:['developer'] as const,scopes:['workflow:create','run'] as const,authType:'local' as const};
const repository={repositoryId:'task28-repo',source:'./task28-repo',classification:'PUBLIC' as const,allowedCallers:['task28-user'],allowedExecutionTypes:['specialist' as const]};
const output={summary:'externally supplied security review',findings:['preserve authorization']};

async function fixture(store:PgStore){
  const requestId=randomUUID();
  const context=freezeCreationContext({principal,operation:'create',requestId,executionType:'specialist',effectiveClassification:'PUBLIC'},repository);
  const workflow=await store.createWorkflow({requestId,workflowType:'non_code',logicalSpecialistId:'architecture-security-advisor',runtimeId:undefined,validationRequired:false,effectiveClassification:'PUBLIC',objective:'certify stage handoff',context,requiresImplementation:false},principal.id,'create',requestId);
  const built=buildOrchestrationPlan(workflow.id,[{specialistId:'architecture-security-advisor',rank:1,matchReason:'security review',evidence:{} as any},{specialistId:'github-oracle',rank:2,matchReason:'repository context',evidence:{} as any}],registry);
  await store.createOrchestrationPlan(built.plan,built.stages);
  await store.updateOrchestrationPlanStage(built.plan.id,built.stages[0].id,'MANUAL_HANDOFF_REQUIRED');
  await store.updateOrchestrationPlan(built.plan.id,'MANUAL_HANDOFF_REQUIRED');
  const current=await store.getWorkflow(workflow.id); await store.transitionWorkflow(current!,'MANUAL_HANDOFF_REQUIRED','system','task28-test');
  return {workflow:await store.getWorkflow(workflow.id),plan:built.plan,stage:built.stages[0]};
}

test('Task 28 live PostgreSQL stage return persists, reloads, authorizes, and reconciles retries',{skip:!url},async()=>{
  const architecture=registry['architecture-security-advisor'];const old={runtimeStatus:architecture.runtimeStatus,chatgptUrl:architecture.chatgptUrl};architecture.runtimeStatus='MANUAL_ONLY';architecture.chatgptUrl='https://chatgpt.com/g/g-task28-security';
  const store=new PgStore(url);let reloaded:PgStore|undefined;
  try{
    const state=await fixture(store);const app=new Orchestrator(store,new UnavailableSpecialist(),new SafePromptBuilder(),new UnavailableCodex(),new UnavailableValidation(),{'task28-repo':repository});
    await assert.rejects(()=>app.acceptManualStageHandoff(state.workflow!.id,state.plan.id,state.stage.id,output,{...principal,id:'other-user'}),/AUTHORIZATION_FAILED/);
    await assert.rejects(()=>store.acceptManualStageHandoff(state.workflow!.id,state.plan.id,0,state.stage.id,output,principal.id),/MANUAL_STAGE_HANDOFF_PLAN_MISMATCH/);
    const accepted=await app.acceptManualStageHandoff(state.workflow!.id,state.plan.id,state.stage.id,output,principal);assert.equal(accepted.status,'SPECIALIST_RUNNING');
    reloaded=new PgStore(url);const persisted=await reloaded.getArtifacts(state.workflow!.id);const artifact=persisted.find(item=>item.planStageId===state.stage.id);assert.equal(artifact?.artifactType,'manual_specialist_output');assert.equal(artifact?.planId,state.plan.id);assert.equal(artifact?.specialistId,state.stage.specialistId);assert.equal((await reloaded.getOrchestrationPlanStages(state.plan.id)).find(stage=>stage.id===state.stage.id)?.status,'COMPLETE');
    const repeated=new Orchestrator(reloaded,new UnavailableSpecialist(),new SafePromptBuilder(),new UnavailableCodex(),new UnavailableValidation(),{'task28-repo':repository});assert.equal((await repeated.acceptManualStageHandoff(state.workflow!.id,state.plan.id,state.stage.id,output,principal)).id,accepted.id);await assert.rejects(()=>repeated.acceptManualStageHandoff(state.workflow!.id,state.plan.id,state.stage.id,{summary:'conflicting'},principal),/MANUAL_STAGE_HANDOFF_ALREADY_ACCEPTED/);assert.equal((await reloaded.getArtifacts(state.workflow!.id)).filter(item=>item.planStageId===state.stage.id).length,1);
  }finally{await reloaded?.pool.end();await store.pool.end();architecture.runtimeStatus=old.runtimeStatus;architecture.chatgptUrl=old.chatgptUrl;}
});

test('Task 28 concurrent PostgreSQL stage returns yield one authoritative artifact',{skip:!url},async()=>{
  const architecture=registry['architecture-security-advisor'];const old={runtimeStatus:architecture.runtimeStatus,chatgptUrl:architecture.chatgptUrl};architecture.runtimeStatus='MANUAL_ONLY';architecture.chatgptUrl='https://chatgpt.com/g/g-task28-security';
  const first=new PgStore(url);const second=new PgStore(url);
  try{const state=await fixture(first);const results=await Promise.allSettled([first.acceptManualStageHandoff(state.workflow!.id,state.plan.id,state.plan.version,state.stage.id,output,'task28-a'),second.acceptManualStageHandoff(state.workflow!.id,state.plan.id,state.plan.version,state.stage.id,output,'task28-b')]);assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.filter(result=>result.status==='rejected').length,1);assert.equal((await first.getArtifacts(state.workflow!.id)).filter(item=>item.planStageId===state.stage.id).length,1);}finally{await first.pool.end();await second.pool.end();architecture.runtimeStatus=old.runtimeStatus;architecture.chatgptUrl=old.chatgptUrl;}
});
