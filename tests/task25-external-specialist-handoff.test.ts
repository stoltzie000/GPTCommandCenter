import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { MemoryStore } from '../src/store.js';
import { Orchestrator } from '../src/orchestrator.js';
import { UnavailableCodex, UnavailableSpecialist, UnavailableValidation, SafePromptBuilder } from '../src/executors.js';
import { contextFromWorkflow, freezeCreationContext } from '../src/trust.js';
import { readSpecialist } from '../src/specialist-read-model.js';
import { registry } from '../src/registry.js';
import { readWorkflow } from '../src/workflow-read-model.js';

const repo={repositoryId:'repo',source:'./repo',classification:'PUBLIC' as const};
const principal={id:'handoff-user',roles:['developer'],scopes:['run'],authType:'local' as const};
const output={objective:'architecture review',requirements:['review the architecture'],constraints:[],affected_components:[],security_requirements:['preserve authorization'],test_requirements:['run tests'],acceptance_criteria:['review is complete'],validation_required:false,validation_reason:''};

test('custom GPT navigation is manual-only and rejects unsafe URLs',()=>{
  const specialist=registry['architecture-security-advisor'];const old={runtimeStatus:specialist.runtimeStatus,chatgptUrl:specialist.chatgptUrl};
  try {
    specialist.runtimeStatus='MANUAL_ONLY';specialist.chatgptUrl='https://chatgpt.com/g/g-architecture';
    assert.deepEqual(readSpecialist(specialist).manualHandoff,{available:true,navigationUrl:'https://chatgpt.com/g/g-architecture'});
    specialist.chatgptUrl='https://evil.example/gpt';
    assert.deepEqual(readSpecialist(specialist).manualHandoff,{available:false});
  } finally { specialist.runtimeStatus=old.runtimeStatus;specialist.chatgptUrl=old.chatgptUrl; }
});

test('manual specialist handoff exposes a bounded package and resumes software delivery with labeled output',async()=>{
  const specialist=registry['architecture-security-advisor'];const old={runtimeStatus:specialist.runtimeStatus,chatgptUrl:specialist.chatgptUrl};
  try {
    specialist.runtimeStatus='MANUAL_ONLY';specialist.chatgptUrl='https://chatgpt.com/g/g-architecture';
    const store=new MemoryStore();const app=new Orchestrator(store,new UnavailableSpecialist(),new SafePromptBuilder(),new UnavailableCodex(),new UnavailableValidation(),{repo});
    const requestId=randomUUID();const context=freezeCreationContext({principal,operation:'create',requestId,executionType:'codex',effectiveClassification:'PUBLIC'},repo);
    const workflow=await app.create({context,workflowInput:{request_id:requestId,workflow_type:'software',objective:'architecture review',requested_specialist:'architecture-security-advisor',requires_implementation:true}});
    await app.run(workflow.id,contextFromWorkflow(workflow,'run','specialist',principal), 'handoff-owner');
    const pending=await readWorkflow(store,await store.getWorkflow(workflow.id)!,await app.getSpecialistCatalog());
    assert.equal(pending.status,'MANUAL_HANDOFF_REQUIRED');assert.equal(pending.execution.started,false);assert.equal(pending.manualHandoff?.available,true);assert.equal(pending.manualHandoff?.returnEndpoint,`/v1/workflows/${workflow.id}/handoff-response`);
    const accepted=await app.acceptManualHandoff(workflow.id,output,principal);
    assert.equal(accepted.status,'SPECIALIST_COMPLETE');assert.equal((await store.getArtifacts(workflow.id)).filter(a=>a.artifactType==='manual_specialist_output').length,1);
    await app.run(workflow.id,contextFromWorkflow(accepted,'run','codex',principal),'handoff-owner');
    assert.equal((await store.getWorkflow(workflow.id))?.status,'FAILED');
    assert.equal((await store.getArtifacts(workflow.id)).some(artifact=>artifact.artifactType==='codex_prompt'),true);
    await assert.rejects(()=>app.acceptManualHandoff(workflow.id,output,principal),/MANUAL_HANDOFF_STATE_UNSAFE/);
  } finally { specialist.runtimeStatus=old.runtimeStatus;specialist.chatgptUrl=old.chatgptUrl; }
});

test('manual handoff cannot be accepted by another workflow principal',async()=>{
  const specialist=registry['architecture-security-advisor'];const old={runtimeStatus:specialist.runtimeStatus,chatgptUrl:specialist.chatgptUrl};
  try {
    specialist.runtimeStatus='MANUAL_ONLY';specialist.chatgptUrl='https://chatgpt.com/g/g-architecture';
    const store=new MemoryStore();const app=new Orchestrator(store,new UnavailableSpecialist(),new SafePromptBuilder(),new UnavailableCodex(),new UnavailableValidation(),{repo});
    const requestId=randomUUID();const context=freezeCreationContext({principal,operation:'create',requestId,executionType:'specialist',effectiveClassification:'PUBLIC'},repo);const workflow=await app.create({context,workflowInput:{request_id:requestId,workflow_type:'non_code',objective:'architecture review',requested_specialist:'architecture-security-advisor'}});
    await app.run(workflow.id,contextFromWorkflow(workflow,'run','specialist',principal));
    await assert.rejects(()=>app.acceptManualHandoff(workflow.id,{summary:'forged'}, {...principal,id:'other-user'}),/AUTHORIZATION_FAILED/);
    assert.equal((await store.getArtifacts(workflow.id)).length,0);
  } finally { specialist.runtimeStatus=old.runtimeStatus;specialist.chatgptUrl=old.chatgptUrl; }
});
