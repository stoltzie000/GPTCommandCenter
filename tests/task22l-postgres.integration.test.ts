// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PgStore } from '../src/pg-store.js';
import { Orchestrator } from '../src/orchestrator.js';
import { Principal } from '../src/trust.js';

const url=process.env.PG_TEST_URL;
const principal:Principal={id:'task22l-pg-user',roles:['developer'],scopes:['workflow:create','workflow:run'],authType:'token',maxClassification:'RESTRICTED'};
const repo={repositoryId:'repo',source:'./repo',classification:'PUBLIC',allowedCallers:['task22l-pg-user'],allowedSpecialists:['architecture-security-advisor'],allowedExecutionTypes:['specialist'],allowedRefs:['main'],approvedRef:'main'};
const input=(requestId:string)=>({requestId,workflowType:'non_code' as const,logicalSpecialistId:null,runtimeId:undefined,validationRequired:false,effectiveClassification:'PUBLIC' as const,objective:'security architecture',context:{principal,resolvedRepository:repo},requiresImplementation:false});
const unused:any={execute:async()=>({kind:'success',output:{}})};

test('22L-06 PostgreSQL reload preserves clarification routing authority', {skip:!url}, async()=>{
  const first=new PgStore(url);const workflow=await first.createWorkflow(input(randomUUID()),'task22l-pg','create');
  const decision={id:randomUUID(),workflowId:workflow.id,selectedSpecialistId:null,routingConfidence:'AMBIGUOUS' as const,routingReason:'needs clarification',decisionType:'INITIAL' as const,supersedesDecisionId:null,createdAt:new Date().toISOString()};
  await first.recordRoutingDecision(decision);const clarification=await first.createPendingClarification({workflowId:workflow.id,routingDecisionId:decision.id,question:'Which specialist owns this task?'});await first.pool.end();
  const second=new PgStore(url);try{const app=new Orchestrator(second,unused,unused,unused,unused,{'repo':repo});const result=await app.resumeClarification(workflow.id,clarification.id,'Focus on security architecture',principal);const reloaded=await second.getWorkflow(workflow.id);assert.equal(result.workflow.logicalSpecialistId,'architecture-security-advisor');assert.equal(reloaded?.logicalSpecialistId,'architecture-security-advisor');assert.equal((await second.getLatestRoutingDecision(workflow.id))?.id,result.decision.id);assert.equal((await second.getClarification(clarification.id))?.status,'ANSWERED');}finally{await second.pool.end();}
});
