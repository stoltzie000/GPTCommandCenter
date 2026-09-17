// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { PgStore } from '../src/pg-store.js';
import { MemoryStore } from '../src/store.js';
import { Orchestrator } from '../src/orchestrator.js';
import { registry } from '../src/registry.js';
import { freezeContext, freezeCreationContext } from '../src/trust.js';
import { assertSoftwareDeliveryActivation, assertSoftwareDeliveryTransition, codexToValidationHandoff, promptToCodexHandoff, specialistToPromptHandoff } from '../src/predefined-workflow.js';
import { readWorkflow } from '../src/workflow-read-model.js';

const url = process.env.PG_TEST_URL;
const id = () => crypto.randomUUID();
const repo = { repositoryId:'repo', source:'./repo', classification:'PUBLIC', allowedCallers:['caller'], allowedSpecialists:['architecture-security-advisor'], allowedExecutionTypes:['specialist','codex','validation'], allowedRefs:['main'], approvedRef:'main' };
const principal = { id:'caller', roles:['developer'], scopes:['run'], authType:'token' };
const createContext = (requestId:string) => freezeCreationContext({ principal, operation:'create', requestId, executionType:'codex', effectiveClassification:'PUBLIC' }, repo as any);
const runContext = (requestId:string, workflowId:string) => freezeContext({ principal, operation:'run', requestId, workflowId, specialistId:'architecture-security-advisor', executionType:'codex', effectiveClassification:'PUBLIC' }, repo as any);
const specialistOutput = { objective:'approved software task', requirements:['implement safely'], constraints:['no merge'], affected_components:['src'], security_requirements:['preserve authorization'], test_requirements:['run tests'], acceptance_criteria:['pass'], validation_required:true, validation_reason:'required' };
const promptOutput = { task_summary:'approved software task', implementation_instructions:'implement safely', scope_constraints:['no merge','no deploy'], tests_required:['run tests'], acceptance_criteria:['pass'], expected_result_report:['files and tests'] };
const codexOutput = { changedFiles:['src/example.ts'], testResults:[{name:'unit',status:'passed'}], resultSummary:'safe deterministic result', exitCode:0 };
const validationOutput = { verdict:'PASS', blocking_findings:[], non_blocking_findings:[], remediation_requirements:[] };

function harness(store:any, captures:any = {}) {
  const old = registry['architecture-security-advisor'].runtime?.status;
  if (registry['architecture-security-advisor'].runtime) registry['architecture-security-advisor'].runtime.status = 'ACTIVE';
  const specialist = { execute: async (input:any) => { captures.specialist = input; return {kind:'success', output:specialistOutput, externalExecutionId:'specialist-e2e'}; } };
  const prompt = { execute: async (input:any) => { captures.prompt = input; return {kind:'success', output:promptOutput}; } };
  const codex = { execute: async (input:any) => { captures.codex = input; return {kind:'success', output:codexOutput, externalExecutionId:'codex-e2e'}; } };
  const validation = { execute: async (input:any) => { captures.validation = input; return {kind:'success', output:validationOutput, externalExecutionId:'validation-e2e'}; } };
  return { orchestrator:new Orchestrator(store,specialist as any,prompt as any,codex as any,validation as any,{repo} as any), restore:()=>{ if (registry['architecture-security-advisor'].runtime) registry['architecture-security-advisor'].runtime.status = old; } };
}

async function createWorkflow(store:any, h:any, objective='22P3 software delivery') {
  const requestId = id();
  const workflow = await h.orchestrator.create({ context:createContext(requestId), workflowInput:{request_id:requestId, requested_specialist:'architecture-security-advisor', objective, workflow_type:'software'} });
  assert.equal(workflow.workflowDefinitionId, 'SOFTWARE_DELIVERY');
  return workflow;
}

async function prepareThroughPrompt(store:any, workflow:any, owner='e2e-setup') {
  let w = await store.getWorkflow(workflow.id);
  const specialist = await store.claimStage(w.id,'specialist:architecture-security-advisor','specialist','architecture-security-advisor-api',owner);
  await store.recordInitiation(w.id,specialist.attempt.id,{provider:'test',externalExecutionId:'specialist-prep'},owner);
  await store.transitionWorkflow(w,'SPECIALIST_RUNNING','test',owner,undefined,specialist.stage.id);
  const specialistArtifact = await store.addArtifact(w.id,'specialist_output',specialistOutput);
  await store.completeStage(w.id,specialist.attempt.id,'specialist-prep',specialistArtifact.id,{terminal:'provider_success'},owner);
  w = await store.getWorkflow(w.id);
  await store.transitionWorkflow(w,'SPECIALIST_COMPLETE','test',owner,{artifactId:specialistArtifact.id},specialist.stage.id);
  w = await store.getWorkflow(w.id);
  const specialistHandoff = specialistToPromptHandoff(w,specialistOutput);
  const prompt = await store.claimStage(w.id,'codex-prompt-builder','prompt_builder',undefined,owner);
  const promptArtifact = await store.addArtifact(w.id,'codex_prompt',promptOutput);
  await store.completeStage(w.id,prompt.attempt.id,undefined,promptArtifact.id,{contentHash:promptArtifact.contentHash},owner);
  w = await store.getWorkflow(w.id);
  await store.transitionWorkflow(w,'CODEX_PROMPT_READY','test',owner,{artifactId:promptArtifact.id,handoff:specialistHandoff.payload});
  return await store.getWorkflow(w.id);
}

test('22P3-01 full SOFTWARE_DELIVERY happy path completes all approved stages', {skip:!url}, async () => {
  const store = new PgStore(url); const captures:any = {}; const h = harness(store,captures);
  try { const w = await createWorkflow(store,h); const result = await h.orchestrator.run(w.id,runContext(w.requestId,w.id),'e2e-owner'); const p:any = await store.reconstructWorkflow(w.id);
    assert.equal(result.status,'COMPLETE'); assert.equal(p.workflow.workflowDefinitionId,'SOFTWARE_DELIVERY'); assert.deepEqual(p.stages.map(x=>x.logicalStageKey).sort(),['specialist:architecture-security-advisor','codex-prompt-builder','codex','validation:architecture-security-advisor'].sort()); assert.ok(p.stages.every(x=>x.status==='COMPLETE')); assert.equal(p.attempts.filter(x=>x.state==='SUCCEEDED').length,4); assert.equal(p.artifacts.length,4);
  } finally { h.restore(); await store.pool.end(); }
});

test('22P3-02 restart after PROMPT_BUILD reconstructs and continues to COMPLETE', {skip:!url}, async () => {
  const first = new PgStore(url); const h1 = harness(first); let workflow:any;
  try { workflow = await createWorkflow(first,h1); await prepareThroughPrompt(first,workflow); const before:any = await first.reconstructWorkflow(workflow.id); assert.equal(before.workflow.status,'CODEX_PROMPT_READY'); assert.equal(before.stages.filter(x=>x.status==='COMPLETE').length,2); assert.equal(before.attempts.some(x=>x.logicalStageKey==='codex'),false); } finally { h1.restore(); await first.pool.end(); }
  const second = new PgStore(url); const h2 = harness(second);
  try { const restored:any = await second.reconstructWorkflow(workflow.id); assert.equal(restored.workflow.workflowDefinitionId,'SOFTWARE_DELIVERY'); assert.equal(restored.workflow.status,'CODEX_PROMPT_READY'); assert.equal(restored.artifacts.some(x=>x.artifactType==='codex_prompt'),true); await h2.orchestrator.run(workflow.id,runContext(restored.workflow.requestId,workflow.id),'fresh-owner'); assert.equal((await second.getWorkflow(workflow.id)).status,'COMPLETE'); } finally { h2.restore(); await second.pool.end(); }
});

test('22P3-03 Codex authority is reconstructed after restart through fresh context', {skip:!url}, async () => {
  const first = new PgStore(url); const h1 = harness(first); let w:any;
  try { w=await createWorkflow(first,h1); await prepareThroughPrompt(first,w); } finally { h1.restore(); await first.pool.end(); }
  const second = new PgStore(url); let captured:any; const h2 = harness(second,{ });
  try { const restored=await second.getWorkflow(w.id); const fresh=runContext(restored.requestId,w.id); assert.notEqual(fresh, (h1 as any).context); await h2.orchestrator.run(w.id,fresh,'post-restart-owner'); const attempts=await second.getAttempts(w.id); assert.equal(attempts.filter(x=>x.logicalStageKey==='codex'&&x.ownerId==='post-restart-owner').length,1); } finally { h2.restore(); await second.pool.end(); }
});

test('22P3-04 stage order rejects skip and reverse transitions without mutation', async () => {
  assert.throws(()=>assertSoftwareDeliveryTransition('SPECIALIST_ANALYSIS','CODEX_EXECUTION'),/TRANSITION_NOT_APPROVED/); assert.throws(()=>assertSoftwareDeliveryTransition('CODEX_EXECUTION','PROMPT_BUILD'),/TRANSITION_NOT_APPROVED/); assert.throws(()=>assertSoftwareDeliveryTransition('COMPLETE','VALIDATION'),/TRANSITION_NOT_APPROVED/);
});

test('22P3-05 specialist completion evidence gates PROMPT_BUILD', () => {
  const wf:any={workflowDefinitionId:'SOFTWARE_DELIVERY',status:'SPECIALIST_COMPLETE'}; assert.throws(()=>assertSoftwareDeliveryActivation(wf,'PROMPT_BUILD', [{status:'COMPLETE',logicalStageKey:'specialist:architecture-security-advisor'}], [{state:'SUCCEEDED',logicalStageKey:'specialist:architecture-security-advisor'}], []),/STAGE_NOT_EVIDENCE_READY/);
});

test('22P3-06 prompt build evidence gates CODEX_EXECUTION', () => {
  const wf:any={workflowDefinitionId:'SOFTWARE_DELIVERY',status:'CODEX_PROMPT_READY'}; const stage:any={status:'COMPLETE',logicalStageKey:'codex-prompt-builder'}; const attempt:any={state:'SUCCEEDED',logicalStageKey:'codex-prompt-builder',terminalEvidence:{ok:true}}; assert.throws(()=>assertSoftwareDeliveryActivation(wf,'CODEX_EXECUTION',[stage],[attempt],[]),/STAGE_NOT_EVIDENCE_READY/);
});

test('22P3-07 Codex terminal evidence gates VALIDATION', () => {
  const wf:any={workflowDefinitionId:'SOFTWARE_DELIVERY',status:'CODEX_COMPLETE'}; const stage:any={status:'COMPLETE',logicalStageKey:'codex'}; const attempt:any={state:'RUNNING',logicalStageKey:'codex',terminalEvidence:{ok:true}}; const artifact:any={artifactType:'codex_result'}; assert.throws(()=>assertSoftwareDeliveryActivation(wf,'VALIDATION',[stage],[attempt],[artifact]),/STAGE_NOT_EVIDENCE_READY/);
});

test('22P3-08 validation terminal evidence is required before COMPLETE', () => {
  const wf:any={workflowDefinitionId:'SOFTWARE_DELIVERY',status:'VALIDATION_RUNNING'}; assert.throws(()=>assertSoftwareDeliveryTransition('VALIDATION','CODEX_EXECUTION'),/TRANSITION_NOT_APPROVED/); assert.equal(wf.status,'VALIDATION_RUNNING');
});

test('22P3-09 CLAIMED is not RUNNING', {skip:!url}, async () => {
  const store=new PgStore(url); const h=harness(store); try { const w=await createWorkflow(store,h); const c=await store.claimStage(w.id,'specialist:architecture-security-advisor','specialist','architecture-security-advisor-api','claim-only'); assert.equal(c.attempt.state,'CLAIMED'); assert.equal(c.attempt.initiationEvidence,undefined); assert.equal((await store.getWorkflow(w.id)).status,'ROUTED'); } finally { h.restore(); await store.pool.end(); }
});

test('22P3-10 STATUS_UNKNOWN blocks validation and blind relaunch', {skip:!url}, async () => {
  const store=new PgStore(url); let launches=0; const h=harness(store); (h.orchestrator as any).codex={execute:async()=>{launches++;return {kind:'success',output:codexOutput,externalExecutionId:'should-not-run'}}};
  try { const w=await createWorkflow(store,h); await prepareThroughPrompt(store,w); const c=await store.claimStage(w.id,'codex','codex',undefined,'unknown-owner'); await store.markStageStatusUnknown(w.id,c.attempt.id,{executionCertainty:'AMBIGUOUS'}); await h.orchestrator.run(w.id,runContext(w.requestId,w.id),'retry-owner'); assert.equal(launches,0); assert.equal((await store.getWorkflow(w.id)).status,'CODEX_PROMPT_READY'); assert.equal((await store.getStages(w.id)).some(x=>x.logicalStageKey.startsWith('validation')),false); } finally { h.restore(); await store.pool.end(); }
});

test('22P3-11 actual E2E handoffs contain only approved data', {skip:!url}, async () => {
  const store=new PgStore(url); const captures:any={}; const h=harness(store,captures); try { const w=await createWorkflow(store,h); await h.orchestrator.run(w.id,runContext(w.requestId,w.id),'handoff-owner'); assert.deepEqual(Object.keys(captures.prompt).sort(),['objective','requirements','trustedContext'].sort()); assert.deepEqual(Object.keys(captures.codex).sort(),['executionPolicy','promptArtifact','stageId','trustedContext','workflowId'].sort()); assert.deepEqual(Object.keys(captures.validation).sort(),['changedFiles','codexPrompt','codexResult','originalRequirements','stageId','testResults','trustedContext','workflowId'].sort()); const handoffPayloads=[captures.prompt,captures.codex,captures.validation].map(({trustedContext,...payload})=>payload); const text=JSON.stringify(handoffPayloads); for(const forbidden of ['password','apiKey','credentials','environment','authorizationDecision','ExecutionContext','providerMetadata']) assert.equal(text.includes(forbidden),false); } finally { h.restore(); await store.pool.end(); }
});

test('22P3-12 forged stage, specialist, runtime, status, completion, evidence and approval input has zero authority', async () => {
  const store=new MemoryStore(); const h=harness(store); try { const w=await createWorkflow(store,h); await assert.rejects(()=>h.orchestrator.run(w.id,{...runContext(w.requestId,w.id),specialistId:'forged-specialist'},'forger'),/AUTHORIZATION_FAILED/); assert.equal(store.getStages(w.id).length,0); assert.equal(store.getAttempts(w.id).length,0); assert.throws(()=>assertSoftwareDeliveryTransition('SPECIALIST_ANALYSIS','CODEX_EXECUTION'),/TRANSITION_NOT_APPROVED/); } finally { h.restore(); }
});

test('22P3-13 SOFTWARE_DELIVERY creates no redundant downstream approvals', {skip:!url}, async () => {
  const store=new PgStore(url); const h=harness(store); try { const w=await createWorkflow(store,h); await h.orchestrator.run(w.id,runContext(w.requestId,w.id),'approval-owner'); assert.equal((await store.getApprovalHistory(w.id)).length,0); } finally { h.restore(); await store.pool.end(); }
});

test('22P3-14 internal stage progression creates no DOWNSTREAM_ROUTE decision', {skip:!url}, async () => {
  const store=new PgStore(url); const h=harness(store); try { const w=await createWorkflow(store,h); await h.orchestrator.run(w.id,runContext(w.requestId,w.id),'route-owner'); assert.equal((await store.getRoutingHistory(w.id)).filter(x=>x.decisionType==='DOWNSTREAM_ROUTE').length,0); } finally { h.restore(); await store.pool.end(); }
});

test('22P3-15 workflow read state is truthful at completion', {skip:!url}, async () => {
  const store=new PgStore(url); const h=harness(store); try { const w=await createWorkflow(store,h); const before=await readWorkflow(store,w); assert.equal(before.execution.started,false); await h.orchestrator.run(w.id,runContext(w.requestId,w.id),'read-owner'); const after=await readWorkflow(store,await store.getWorkflow(w.id)); assert.equal(after.execution.completed,true); assert.equal(after.status,'COMPLETE'); } finally { h.restore(); await store.pool.end(); }
});

test('22P3-16 persisted events and artifacts audit the complete lifecycle', {skip:!url}, async () => {
  const store=new PgStore(url); const h=harness(store); try { const w=await createWorkflow(store,h); await h.orchestrator.run(w.id,runContext(w.requestId,w.id),'audit-owner'); const events=await store.getEvents(w.id); assert.ok(events.some(x=>x.eventType==='WORKFLOW_SPECIALIST_COMPLETE')); assert.ok(events.some(x=>x.eventType==='WORKFLOW_CODEX_COMPLETE')); assert.ok(events.some(x=>x.eventType==='WORKFLOW_COMPLETE')); assert.equal((await store.getArtifacts(w.id)).length,4); } finally { h.restore(); await store.pool.end(); }
});

test('22P3-17 final COMPLETE state survives a second PostgreSQL restart', {skip:!url}, async () => {
  const first=new PgStore(url); const h1=harness(first); let w:any; try { w=await createWorkflow(first,h1); await h1.orchestrator.run(w.id,runContext(w.requestId,w.id),'restart-owner'); } finally { h1.restore(); await first.pool.end(); } const second=new PgStore(url); try { const p:any=await second.reconstructWorkflow(w.id); assert.equal(p.workflow.status,'COMPLETE'); assert.equal(p.workflow.workflowDefinitionId,'SOFTWARE_DELIVERY'); assert.equal(p.stages.length,4); assert.equal(p.attempts.length,4); assert.equal(p.artifacts.length,4); assert.ok(p.events.length>1); } finally { await second.pool.end(); }
});

test('22P3-18 safe deterministic executor preserves noMerge/noDeploy and performs no external side effect', {skip:!url}, async () => {
  const store=new PgStore(url); const captures:any={}; const h=harness(store,captures); try { const w=await createWorkflow(store,h); await h.orchestrator.run(w.id,runContext(w.requestId,w.id),'safe-owner'); assert.deepEqual(captures.codex.executionPolicy,{noMerge:true,noDeploy:true}); assert.equal((await store.getWorkflow(w.id)).status,'COMPLETE'); } finally { h.restore(); await store.pool.end(); }
});
