import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PgStore } from '../src/pg-store.js';
import { Orchestrator } from '../src/orchestrator.js';
import { SafePromptBuilder, UnavailableCodex, UnavailableSpecialist, UnavailableValidation } from '../src/executors.js';
import { freezeCreationContext } from '../src/trust.js';

const url=process.env.PG_TEST_URL;
const principal={id:'task30-pg-user',roles:['developer'] as const,scopes:['run'] as const,authType:'local' as const};
const repository={repositoryId:'task30-pg-repo',source:'./task30-pg-repo',classification:'PUBLIC' as const,allowedCallers:['task30-pg-user'],allowedExecutionTypes:['codex' as const]};
const output={implementation_summary:'External implementation report',changed_files:['src/example.ts'],test_results:['npm test passed'],execution_notes:'unverified'};

test('Task 30 PostgreSQL persists typed Codex handoff evidence and retries idempotently',{skip:!url},async()=>{
  const store=new PgStore(url!);let workflowId='';
  try {
    const requestId=randomUUID();const context=freezeCreationContext({principal,operation:'create',requestId,executionType:'codex',effectiveClassification:'PUBLIC'},repository);
    const workflow=await store.createWorkflow({requestId,workflowType:'software',logicalSpecialistId:'architecture-security-advisor',runtimeId:undefined,validationRequired:false,effectiveClassification:'PUBLIC',objective:'Task 30 PostgreSQL handoff',context,requiresImplementation:true},principal.id,'create',requestId);workflowId=workflow.id;
    await store.addArtifact(workflow.id,'codex_prompt',{task_summary:'Task 30',implementation_instructions:'implement',scope_constraints:[],tests_required:[],acceptance_criteria:[],expected_result_report:[]});
    await store.transitionWorkflow(workflow,'ROUTED','test','setup');await store.transitionWorkflow(workflow,'SPECIALIST_RUNNING','test','setup');await store.transitionWorkflow(workflow,'SPECIALIST_COMPLETE','test','setup');await store.transitionWorkflow(workflow,'CODEX_PROMPT_READY','test','setup');await store.transitionWorkflow(workflow,'MANUAL_HANDOFF_REQUIRED','test','setup',{failureCode:'CODEX_RUNTIME_UNAVAILABLE'});
    const app=new Orchestrator(store,new UnavailableSpecialist(),new SafePromptBuilder(),new UnavailableCodex(),new UnavailableValidation(),{[repository.repositoryId]:repository});
    const accepted=await app.acceptManualCodexHandoff(workflow.id,output,principal);assert.equal(accepted.failureCode,'CODEX_MANUAL_REVIEW_REQUIRED');
    const reloaded=new PgStore(url!);try{const artifacts=await reloaded.getArtifacts(workflow.id);assert.equal(artifacts.filter(item=>item.artifactType==='manual_codex_output').length,1);assert.equal((await reloaded.getWorkflow(workflow.id))?.failureCode,'CODEX_MANUAL_REVIEW_REQUIRED');assert.equal((await new Orchestrator(reloaded,new UnavailableSpecialist(),new SafePromptBuilder(),new UnavailableCodex(),new UnavailableValidation(),{[repository.repositoryId]:repository}).acceptManualCodexHandoff(workflow.id,output,principal)).id,workflow.id);}finally{await reloaded.pool.end();}
  } finally { await store.pool.end(); }
  assert.ok(workflowId);
});
