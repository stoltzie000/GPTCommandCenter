import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { MemoryStore } from '../src/store.js';
import { Orchestrator } from '../src/orchestrator.js';
import { SafePromptBuilder, UnavailableCodex, UnavailableSpecialist, UnavailableValidation } from '../src/executors.js';
import { contextFromWorkflow, freezeCreationContext } from '../src/trust.js';
import { registry } from '../src/registry.js';
import { readWorkflow } from '../src/workflow-read-model.js';

const repo={repositoryId:'task30-repo',source:'./repo',classification:'PUBLIC' as const};
const principal={id:'task30-user',roles:['developer'],scopes:['run'],authType:'local' as const};
const specialistOutput={objective:'implement the requested change',requirements:['preserve the existing authorization boundary'],constraints:[],affected_components:['workflow'],security_requirements:['retain provenance'],test_requirements:['run validation'],acceptance_criteria:['the task is complete'],validation_required:false,validation_reason:''};
const manualCodexOutput={implementation_summary:'The generated task was completed in an external Codex environment.',changed_files:['src/example.ts'],test_results:['npm test passed'],execution_notes:'This report is externally supplied.'};

async function softwareHandoff(codex:any){
  const store=new MemoryStore();
  const app=new Orchestrator(store,new UnavailableSpecialist(),new SafePromptBuilder(),codex,new UnavailableValidation(),{[repo.repositoryId]:repo});
  const requestId=randomUUID();
  const context=freezeCreationContext({principal,operation:'create',requestId,executionType:'codex',effectiveClassification:'PUBLIC'},repo);
  const workflow=await app.create({context,workflowInput:{request_id:requestId,workflow_type:'software',objective:'implement the requested change',requested_specialist:'architecture-security-advisor',requires_implementation:true}});
  const specialist=registry['architecture-security-advisor'];
  const old={runtimeStatus:specialist.runtimeStatus,chatgptUrl:specialist.chatgptUrl};
  specialist.runtimeStatus='MANUAL_ONLY';specialist.chatgptUrl='https://chatgpt.com/g/g-task30';
  await app.run(workflow.id,contextFromWorkflow(workflow,'run','specialist',principal),'task30-specialist');
  await app.acceptManualHandoff(workflow.id,specialistOutput,principal);
  await app.run(workflow.id,contextFromWorkflow(await store.getWorkflow(workflow.id)!,'run','codex',principal),'task30-codex');
  return {store,app,workflowId:workflow.id,restore:()=>{specialist.runtimeStatus=old.runtimeStatus;specialist.chatgptUrl=old.chatgptUrl;}};
}

test('unavailable Codex preserves the prompt and exposes a typed manual handoff',async()=>{
  const state=await softwareHandoff(new UnavailableCodex());
  try {
    const workflow=await state.store.getWorkflow(state.workflowId);assert.equal(workflow?.status,'MANUAL_HANDOFF_REQUIRED');assert.equal(workflow?.failureCode,'CODEX_RUNTIME_UNAVAILABLE');
    const artifacts=await state.store.getArtifacts(state.workflowId);const prompt=artifacts.find(item=>item.artifactType==='codex_prompt');assert.ok(prompt);
    const read=await readWorkflow(state.store,workflow!,await state.app.getSpecialistCatalog());assert.equal(read.codexHandoff?.available,true);assert.equal(read.codexHandoff?.artifactId,prompt!.id);assert.equal(read.codexHandoff?.returnEndpoint,`/v1/workflows/${state.workflowId}/handoff-response`);
    const accepted=await state.app.acceptManualCodexHandoff(state.workflowId,manualCodexOutput,principal);assert.equal(accepted.failureCode,'CODEX_MANUAL_REVIEW_REQUIRED');assert.equal((await state.store.getArtifacts(state.workflowId)).filter(item=>item.artifactType==='manual_codex_output').length,1);
    assert.equal((await state.app.acceptManualCodexHandoff(state.workflowId,manualCodexOutput,principal)).id,state.workflowId);
    await assert.rejects(()=>state.app.acceptManualCodexHandoff(state.workflowId,{...manualCodexOutput,implementation_summary:'different'},principal),/CODEX_HANDOFF_ALREADY_ACCEPTED/);
    const final=await readWorkflow(state.store,await state.store.getWorkflow(state.workflowId)!,await state.app.getSpecialistCatalog());assert.equal(final.codexHandoff?.submitted,true);
  } finally { state.restore(); }
});

test('an attempted Codex execution failure remains FAILED and keeps the prompt',async()=>{
  const attempted={isAvailable:()=>true,execute:async()=>({kind:'terminal_failure',errorCode:'CODEX_EXECUTION_FAILED'})};
  const state=await softwareHandoff(attempted);
  try { const workflow=await state.store.getWorkflow(state.workflowId);assert.equal(workflow?.status,'FAILED');assert.equal(workflow?.failureCode,'CODEX_EXECUTION_FAILED');assert.equal((await state.store.getArtifacts(state.workflowId)).some(item=>item.artifactType==='codex_prompt'),true); } finally { state.restore(); }
});

test('an available Codex runtime continues the existing successful path',async()=>{
  const available={isAvailable:()=>true,execute:async()=>({kind:'success',externalExecutionId:'task30-codex',output:{exitCode:0,changedFiles:[],testResults:[],resultSummary:'done'}})};
  const state=await softwareHandoff(available);
  try { assert.equal((await state.store.getWorkflow(state.workflowId))?.status,'COMPLETE');assert.equal((await state.store.getArtifacts(state.workflowId)).some(item=>item.artifactType==='codex_result'),true); } finally { state.restore(); }
});
