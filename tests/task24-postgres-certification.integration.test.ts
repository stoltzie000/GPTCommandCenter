import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PgStore } from '../src/pg-store.js';
import { buildMultiSpecialistContext } from '../src/codex-aggregation.js';
import { buildOrchestrationPlan } from '../src/orchestration-plan.js';
import { buildDynamicSpecialist } from '../src/specialist-catalog.js';
import { registry } from '../src/registry.js';
import { SelectedCandidate, TaskInterpretation } from '../src/domain.js';

const url=process.env.PG_TEST_URL;
const candidate=(specialistId:string,rank:number):SelectedCandidate=>({specialistId,rank,matchReason:`task24 ${specialistId}`,evidence:{specialistId,registryVersion:'1.0.0',ownershipMatches:['task24'],capabilityMatches:['task24'],workflowRelationship:'none',exclusionResult:'eligible',specificity:2,runtimeStatus:'ACTIVE',matchReason:`task24 ${specialistId}`} });
const interpretation:TaskInterpretation={intent:'task24 database certification',requestedOutcome:'database certification',taskCategories:['security review'],requiredCapabilities:['database certification'],excludedCapabilities:[],inputTypes:[],expectedOutputTypes:[],workflowContext:{},requiresCurrentInformation:false,requiresExecutableRuntime:false};

test('Task 24 live PostgreSQL persistence, concurrency, rollback, and aggregation certification',{skip:!url},async()=>{
  const store=new PgStore(url);const requestId=randomUUID();
  try{
    await store.verifySchema();
    const dynamic=buildDynamicSpecialist(interpretation,`task24-${requestId}`);dynamic.capabilities=['database certification'];
    const results=await Promise.all([store.createDynamicSpecialist(dynamic),store.createDynamicSpecialist(dynamic)]);
    assert.equal(results[0].id, dynamic.id);assert.equal(results[1].id,dynamic.id);
    assert.ok((await store.getEffectiveSpecialists())[dynamic.id]);
    const forged={...dynamic,id:'architecture-security-advisor'};
    await assert.rejects(()=>store.createDynamicSpecialist(forged),/DYNAMIC_SPECIALIST_COLLIDES_WITH_BUILTIN/);
    const workflow=await store.createWorkflow({requestId,workflowType:'non_code',logicalSpecialistId:'architecture-security-advisor',validationRequired:false,effectiveClassification:'PUBLIC',objective:'task24',context:{},requiresImplementation:false},'task24','create',requestId);
    const built=buildOrchestrationPlan(workflow.id,[candidate('architecture-security-advisor',1),candidate(dynamic.id,2)],await store.getEffectiveSpecialists());
    await store.createOrchestrationPlan(built.plan,built.stages);
    const reloaded=await store.getOrchestrationPlan(workflow.id);assert.equal(reloaded?.version,1);
    assert.deepEqual((await store.getOrchestrationPlanStages(built.plan.id)).map(stage=>stage.dependencies),built.stages.map(stage=>stage.dependencies));
    const first=await store.addArtifact(workflow.id,'orchestration_specialist_output',{objective:'task24',requirements:['implement'],constraints:[],affected_components:[],security_requirements:[],test_requirements:[],acceptance_criteria:[],validation_required:false,validation_reason:''},{planId:built.plan.id,planStageId:built.stages[0].id,specialistId:'architecture-security-advisor'});
    const second=await store.addArtifact(workflow.id,'orchestration_specialist_output',{security_constraints:['preserve authorization']},{planId:built.plan.id,planStageId:built.stages[1].id,specialistId:dynamic.id});
    await store.updateOrchestrationPlanStage(built.plan.id,built.stages[0].id,'COMPLETE',first.id);await store.updateOrchestrationPlanStage(built.plan.id,built.stages[1].id,'COMPLETE',second.id);await store.updateOrchestrationPlan(built.plan.id,'COMPLETE');
    const completePlan=(await store.getOrchestrationPlan(workflow.id))!;const context=buildMultiSpecialistContext((await store.getWorkflow(workflow.id))!,completePlan,await store.getOrchestrationPlanStages(built.plan.id),await store.getArtifacts(workflow.id));assert.equal(context.contributions.length,2);assert.equal(context.planVersion,1);
    const aggregate=await store.addArtifact(workflow.id,'multi_specialist_context',context,{planId:built.plan.id});assert.equal((await store.getArtifacts(workflow.id)).find(item=>item.id===aggregate.id)?.planId,built.plan.id);
    const foreignWorkflow=await store.createWorkflow({requestId:randomUUID(),workflowType:'non_code',logicalSpecialistId:'architecture-security-advisor',validationRequired:false,effectiveClassification:'PUBLIC',objective:'foreign',context:{},requiresImplementation:false},'foreign','create',randomUUID());
    await assert.rejects(()=>store.addArtifact(foreignWorkflow.id,'multi_specialist_context',context,{planId:built.plan.id}),/ARTIFACT_PLAN_WORKFLOW_MISMATCH/);
    const claimResults=await Promise.all([store.claimStage(workflow.id,'task24-stage','specialist',undefined,'task24-a'),store.claimStage(workflow.id,'task24-stage','specialist',undefined,'task24-b')]);assert.equal(claimResults.filter(result=>!result.existing).length,1);
    const invalidPlan={...built.plan,id:randomUUID(),version:2};const invalidStages=built.stages.map(stage=>({...stage,id:randomUUID(),planId:invalidPlan.id,dependencies:[] as string[]}));invalidStages[0].dependencies=[invalidStages[1].id];invalidStages[1].dependencies=[invalidStages[0].id];await assert.rejects(()=>store.createOrchestrationPlan(invalidPlan,invalidStages),/ORCHESTRATION_PLAN_CYCLE/);assert.equal((await store.getOrchestrationPlan(workflow.id))?.id,built.plan.id);
  }finally{await store.pool.end();}
});
