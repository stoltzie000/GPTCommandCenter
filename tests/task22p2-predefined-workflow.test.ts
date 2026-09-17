import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SOFTWARE_DELIVERY_WORKFLOW, assertSoftwareDeliveryActivation, assertSoftwareDeliveryTransition, codexToValidationHandoff, promptToCodexHandoff, softwareDeliveryDefinitionFor, specialistToPromptHandoff } from '../src/predefined-workflow.js';
import { MemoryStore } from '../src/store.js';
import { registry } from '../src/registry.js';

const workflow = (workflowType: 'software'|'non_code' = 'software', status: any = 'ROUTED') => ({id:'wf',requestId:'request',workflowType,workflowDefinitionId:workflowType==='software'?'SOFTWARE_DELIVERY':undefined,logicalSpecialistId:'architecture-security-advisor',runtimeId:undefined,status,validationRequired:true,objective:'Review the approved design',context:{principal:{id:'p'},authorizationDecision:{allowed:true},secret:'must-not-handoff'},requiresImplementation:true,version:0,createdAt:'now',updatedAt:'now'} as any);
const completeStage = (stageType: any, logicalStageKey: string, artifactType: string) => {
  const artifact = {id:`artifact-${stageType}`,workflowId:'wf',artifactType,contentType:'application/json',contentJson:{},contentHash:'hash'};
  const stage = {id:`stage-${stageType}`,workflowId:'wf',stageType,logicalStageKey,status:'COMPLETE' as const,attempt:1,outputArtifactId:artifact.id};
  const attempt = {id:`attempt-${stageType}`,workflowId:'wf',stageId:stage.id,logicalStageKey,attemptNumber:1,ownerId:'server',state:'SUCCEEDED' as const,terminalEvidence:{ok:true}};
  return {stage,attempt,artifact};
};

test('22P2-01 production defines stable SOFTWARE_DELIVERY identity and four existing stages', () => {
  assert.equal(SOFTWARE_DELIVERY_WORKFLOW.id, 'SOFTWARE_DELIVERY');
  assert.equal(softwareDeliveryDefinitionFor(workflow()), SOFTWARE_DELIVERY_WORKFLOW);
  assert.deepEqual(SOFTWARE_DELIVERY_WORKFLOW.stages.map(stage=>stage.stageType).filter(Boolean), ['specialist','prompt_builder','codex','validation']);
});

test('22P2-02 order is fixed and stage skipping or reverse activation is rejected', () => {
  assert.deepEqual(SOFTWARE_DELIVERY_WORKFLOW.stages.map(stage=>stage.key), ['SPECIALIST_ANALYSIS','PROMPT_BUILD','CODEX_EXECUTION','VALIDATION','COMPLETE']);
  assertSoftwareDeliveryActivation(workflow('software','ROUTED'),'SPECIALIST_ANALYSIS',[],[],[]);
  assert.throws(()=>assertSoftwareDeliveryActivation(workflow('software','ROUTED'),'CODEX_EXECUTION',[],[],[]), /STAGE_NOT_EVIDENCE_READY/);
  assert.throws(()=>assertSoftwareDeliveryActivation(workflow('software','CODEX_COMPLETE'),'PROMPT_BUILD',[],[],[]), /STAGE_NOT_EVIDENCE_READY/);
});

test('22P2-03 stage owners are server-defined and derive only specialist validation from persisted route', () => {
  assert.deepEqual(SOFTWARE_DELIVERY_WORKFLOW.stages.map(stage=>stage.owner), ['workflow-specialist','codex-prompt-builder','codex-runtime','workflow-specialist-validator','none']);
  assert.equal(workflow().logicalSpecialistId, 'architecture-security-advisor');
  assert.equal(registry['architecture-security-advisor'].runtimeId, 'architecture-security-advisor-api');
  assert.equal(SOFTWARE_DELIVERY_WORKFLOW.stages[2].owner, 'codex-runtime');
});

test('22P2-04 only definition edges are approved and undefined stage transitions fail closed', () => {
  const edges = SOFTWARE_DELIVERY_WORKFLOW.stages.filter(stage=>stage.next).map(stage=>[stage.key,stage.next]);
  assert.deepEqual(edges, [['SPECIALIST_ANALYSIS','PROMPT_BUILD'],['PROMPT_BUILD','CODEX_EXECUTION'],['CODEX_EXECUTION','VALIDATION'],['VALIDATION','COMPLETE']]);
  assert.doesNotThrow(()=>assertSoftwareDeliveryTransition('SPECIALIST_ANALYSIS','PROMPT_BUILD'));
  assert.throws(()=>assertSoftwareDeliveryTransition('CODEX_EXECUTION','PROMPT_BUILD'), /TRANSITION_NOT_APPROVED/);
  assert.throws(()=>assertSoftwareDeliveryTransition('COMPLETE','SPECIALIST_ANALYSIS'), /TRANSITION_NOT_APPROVED/);
  assert.equal(SOFTWARE_DELIVERY_WORKFLOW.stages.find(stage=>stage.key==='COMPLETE')?.next, null);
});

test('22P2-05 stage progression does not change logical specialist routing authority', () => {
  assert.equal(SOFTWARE_DELIVERY_WORKFLOW.stages[2].owner, 'codex-runtime');
  assert.equal(SOFTWARE_DELIVERY_WORKFLOW.stages[1].owner, 'codex-prompt-builder');
  assert.equal(SOFTWARE_DELIVERY_WORKFLOW.stages[2].owner, 'codex-runtime');
});

test('22P2-06 transitions are authorized within the existing run scope; no redundant approval is defined', () => {
  assert.ok(SOFTWARE_DELIVERY_WORKFLOW.stages.filter(stage=>stage.transition==='AUTOMATIC').every(stage=>stage.approval==='NOT_REQUIRED_WITHIN_AUTHORIZED_SCOPE'));
  assert.equal(SOFTWARE_DELIVERY_WORKFLOW.stages[2].owner, 'codex-runtime');
});

test('22P2-07 no additional approval transition exists in this workflow definition', () => {
  assert.equal(SOFTWARE_DELIVERY_WORKFLOW.stages.some(stage=>stage.approval!=='NOT_REQUIRED_WITHIN_AUTHORIZED_SCOPE' && stage.approval!=='NOT_APPLICABLE'), false);
});

test('22P2-08 approved within-scope continuation follows the existing run path, not caller stage selection', () => {
  const prompt = completeStage('prompt_builder','codex-prompt-builder','codex_prompt');
  assertSoftwareDeliveryActivation(workflow('software','CODEX_PROMPT_READY'),'CODEX_EXECUTION',[prompt.stage],[prompt.attempt],[prompt.artifact]);
});

test('22P2-09 specialist to prompt handoff contains only objective and specialist output', () => {
  const handoff = specialistToPromptHandoff(workflow(), {objective:'x',requirements:['r'],constraints:[],affected_components:[],security_requirements:[],test_requirements:[],acceptance_criteria:[],validation_required:true,validation_reason:'x'});
  const json = JSON.stringify(handoff);
  assert.deepEqual(Object.keys(handoff.payload).sort(), ['objective','requirements']);
  for (const forbidden of ['secret','principal','authorizationDecision','environment','ExecutionContext']) assert.equal(json.includes(forbidden), false);
});

test('22P2-10 prompt to Codex handoff contains prompt and fixed execution constraints, not trust authority', () => {
  const handoff = promptToCodexHandoff({task_summary:'x',implementation_instructions:'do x',scope_constraints:[],tests_required:[],acceptance_criteria:[],expected_result_report:[]});
  assert.deepEqual(handoff.payload.executionPolicy, {noMerge:true,noDeploy:true});
  assert.equal('principal' in handoff.payload, false);
  assert.equal('runtimeId' in handoff.payload, false);
});

test('22P2-11 Codex to validation handoff is limited to requirements, prompt, result, files, and tests', () => {
  const handoff = codexToValidationHandoff({objective:'x',requirements:[],constraints:[],affected_components:[],security_requirements:[],test_requirements:[],acceptance_criteria:[],validation_required:true,validation_reason:'x'}, {task_summary:'x',implementation_instructions:'x',scope_constraints:[],tests_required:[],acceptance_criteria:[],expected_result_report:[]}, {changedFiles:['a'],testResults:[]});
  assert.deepEqual(Object.keys(handoff.payload).sort(), ['changedFiles','codexPrompt','codexResult','originalRequirements','testResults']);
  for (const forbidden of ['secret','principal','authorizationDecision','environment','provider']) assert.equal(JSON.stringify(handoff).includes(forbidden), false);
});

test('22P2-12 next stage requires completed prior stage, terminal evidence, and artifact', () => {
  const prior = completeStage('prompt_builder','codex-prompt-builder','codex_prompt');
  assertSoftwareDeliveryActivation(workflow('software','CODEX_PROMPT_READY'),'CODEX_EXECUTION',[prior.stage],[prior.attempt],[prior.artifact]);
  assert.throws(()=>assertSoftwareDeliveryActivation(workflow('software','CODEX_PROMPT_READY'),'CODEX_EXECUTION',[prior.stage],[{...prior.attempt,terminalEvidence:undefined}],[prior.artifact]), /STAGE_NOT_EVIDENCE_READY/);
  assert.throws(()=>assertSoftwareDeliveryActivation(workflow('software','CODEX_PROMPT_READY'),'CODEX_EXECUTION',[prior.stage],[prior.attempt],[]), /STAGE_NOT_EVIDENCE_READY/);
});

test('22P2-13 CLAIMED is not complete or RUNNING evidence for downstream activation', () => {
  const prior = completeStage('prompt_builder','codex-prompt-builder','codex_prompt');
  assert.throws(()=>assertSoftwareDeliveryActivation(workflow('software','CODEX_PROMPT_READY'),'CODEX_EXECUTION',[prior.stage],[{...prior.attempt,state:'CLAIMED'}],[prior.artifact]), /STAGE_NOT_EVIDENCE_READY/);
});

test('22P2-14 STATUS_UNKNOWN prevents evidence-ready progression', () => {
  const prior = completeStage('codex','codex','codex_result');
  assert.throws(()=>assertSoftwareDeliveryActivation(workflow('software','CODEX_COMPLETE'),'VALIDATION',[prior.stage],[{...prior.attempt,state:'STATUS_UNKNOWN'}],[prior.artifact]), /STAGE_NOT_EVIDENCE_READY/);
});

test('22P2-15 PostgreSQL reconstruction recovers software definition identity and stage evidence', {skip:!process.env.PG_TEST_URL}, async () => {
  const {PgStore} = await import('../src/pg-store.js');
  const url = process.env.PG_TEST_URL!;
  const first = new PgStore(url);
  const requestId = randomUUID();
  let workflowId = '';
  try {
    const created = await first.createWorkflow({requestId,workflowType:'software',workflowDefinitionId:'SOFTWARE_DELIVERY',logicalSpecialistId:'architecture-security-advisor',runtimeId:'architecture-security-advisor-api',validationRequired:true,effectiveClassification:'PUBLIC',objective:'restart definition',context:{workflowDefinitionId:'SOFTWARE_DELIVERY'},requiresImplementation:true},'task22p2','create');
    workflowId = created.id;
    const claim = await first.claimStage(workflowId,'specialist:architecture-security-advisor','specialist','architecture-security-advisor-api','p2-test');
    await first.recordInitiation(workflowId,claim.attempt.id,{externalExecutionId:'specialist-p2'},'p2-test');
    const artifact = await first.addArtifact(workflowId,'specialist_output',{requirements:['preserved']});
    await first.completeStage(workflowId,claim.attempt.id,'specialist-p2',artifact.id,{terminal:'success'},'p2-test');
    await first.transitionWorkflow(created,'SPECIALIST_RUNNING','test','p2',undefined,claim.stage.id);
    await first.transitionWorkflow(created,'SPECIALIST_COMPLETE','test','p2',{artifactId:artifact.id},claim.stage.id);
  } finally { await first.pool.end(); }
  const fresh = new PgStore(url);
  try {
    const restored = await fresh.reconstructWorkflow(workflowId) as any;
    assert.equal(restored.workflow.workflowDefinitionId,'SOFTWARE_DELIVERY');
    assert.equal(softwareDeliveryDefinitionFor(restored.workflow)?.id,'SOFTWARE_DELIVERY');
    assert.equal(restored.stages[0].status,'COMPLETE');
    assert.ok(restored.attempts[0].terminalEvidence);
    assert.equal(restored.artifacts[0].artifactType,'specialist_output');
    assertSoftwareDeliveryActivation(restored.workflow,'PROMPT_BUILD',restored.stages,restored.attempts,restored.artifacts);
  } finally { await fresh.pool.end(); }
});

test('22P2-16 non-code/legacy workflow remains outside SOFTWARE_DELIVERY definition', () => {
  assert.equal(softwareDeliveryDefinitionFor(workflow('non_code')), undefined);
});

test('22P2-17 activation contract has no caller-supplied authority parameters', () => {
  assert.equal(assertSoftwareDeliveryActivation.length, 5);
  assert.throws(()=>assertSoftwareDeliveryActivation({...workflow(),status:'COMPLETE'},'CODEX_EXECUTION',[],[],[]), /STAGE_NOT_EVIDENCE_READY/);
});

test('22P2-18 definition and stage ownership do not provide an execution context or runtime authorization', () => {
  const definition = SOFTWARE_DELIVERY_WORKFLOW;
  assert.equal('executionContext' in definition, false);
  assert.equal('authorizationDecision' in definition, false);
  assert.equal(definition.stages.find(stage=>stage.key==='CODEX_EXECUTION')?.owner,'codex-runtime');
});

test('workflow definition metadata is consistently ordered', () => {
  assert.equal(SOFTWARE_DELIVERY_WORKFLOW.stages[0].next, SOFTWARE_DELIVERY_WORKFLOW.stages[1].key);
});
