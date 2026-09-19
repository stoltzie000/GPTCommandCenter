import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PgStore } from '../src/pg-store.js';
import { buildOrchestrationPlan } from '../src/orchestration-plan.js';
import { registry } from '../src/registry.js';
import { SelectedCandidate } from '../src/domain.js';

const url=process.env.PG_TEST_URL;
const candidate=(specialistId:string,rank:number):SelectedCandidate=>({specialistId,rank,matchReason:`task21 ${specialistId}`,evidence:{specialistId,registryVersion:'1.0.0',ownershipMatches:['implementation'],capabilityMatches:['implementation'],workflowRelationship:'none',exclusionResult:'eligible',specificity:2,runtimeStatus:'ACTIVE',matchReason:`task21 ${specialistId}`} });

test('Task 21 PostgreSQL plan and stage persistence survives reload',{skip:!url},async()=>{
  const store=new PgStore(url);let reloadedStore:PgStore|undefined;const requestId=randomUUID();
  try{
    await store.verifySchema();
    const workflow=await store.createWorkflow({requestId,workflowType:'non_code',logicalSpecialistId:'architecture-security-advisor',validationRequired:false,effectiveClassification:'PUBLIC',objective:'persist plan',context:{},requiresImplementation:false},'task21','create',requestId);
    const built=buildOrchestrationPlan(workflow.id,[candidate('architecture-security-advisor',1),candidate('github-oracle',2)],registry);
    await store.createOrchestrationPlan(built.plan,built.stages);
    reloadedStore=new PgStore(url);const reloaded=await reloadedStore.getOrchestrationPlan(workflow.id);
    assert.equal(reloaded?.id,built.plan.id);
    assert.deepEqual((await store.getOrchestrationPlanStages(built.plan.id)).map(stage=>stage.dependencies),built.stages.map(stage=>stage.dependencies));
  }finally{await reloadedStore?.pool.end();await store.pool.end();}
});
