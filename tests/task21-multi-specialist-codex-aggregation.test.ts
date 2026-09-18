import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryStore } from '../src/store.js';
import { Orchestrator } from '../src/orchestrator.js';
import { SafePromptBuilder, UnavailableCodex, UnavailableSpecialist, UnavailableValidation } from '../src/executors.js';
import { buildOrchestrationPlan } from '../src/orchestration-plan.js';
import { buildMultiSpecialistContext } from '../src/codex-aggregation.js';
import { contextFromWorkflow, freezeCreationContext } from '../src/trust.js';
import { registry } from '../src/registry.js';
import { SelectedCandidate, SoftwareOutput } from '../src/domain.js';

const repository={repositoryId:'task21-repo',source:'./task21-repo',classification:'PUBLIC' as const,allowedCallers:['task21-user'],allowedExecutionTypes:['specialist' as const,'codex' as const,'validation' as const]};
const principal={id:'task21-user',roles:['developer'] as const,scopes:['workflow:create','run'] as const,authType:'local' as const};
const candidate=(specialistId:string,rank:number):SelectedCandidate=>({specialistId,rank,matchReason:`contribution from ${specialistId}`,evidence:{specialistId,registryVersion:'1.0.0',ownershipMatches:['implementation'],capabilityMatches:['implementation'],workflowRelationship:'none',exclusionResult:'eligible',specificity:2,runtimeStatus:'ACTIVE',matchReason:`contribution from ${specialistId}`} });
const requirements=(label:string):SoftwareOutput=>({objective:'implement the approved change',requirements:[label],constraints:['no merge'],affected_components:['src'],security_requirements:['preserve authorization'],test_requirements:['run tests'],acceptance_criteria:['validated'],validation_required:true,validation_reason:'review required'});

async function prepared(){
  const store=new MemoryStore();
  const workflow=store.createWorkflow({requestId:'task21',workflowType:'software',workflowDefinitionId:'SOFTWARE_DELIVERY',logicalSpecialistId:'architecture-security-advisor',runtimeId:undefined,validationRequired:true,effectiveClassification:'PUBLIC',objective:'implement the approved change',context:{principal,resolvedRepository:repository},requiresImplementation:true});
  const claim=store.claimStage(workflow.id,'specialist:architecture-security-advisor','specialist','runtime','setup');
  store.recordInitiation(workflow.id,claim.attempt.id,{provider:'test'},'setup');
  store.transitionWorkflow(workflow,'SPECIALIST_RUNNING','test','setup',undefined,claim.stage.id);
  const primary=store.addArtifact(workflow.id,'specialist_output',requirements('primary implementation requirements'));
  store.completeStage(workflow.id,claim.attempt.id,'specialist',primary.id,{},'setup');
  store.transitionWorkflow(workflow,'SPECIALIST_COMPLETE','test','setup',{artifactId:primary.id},claim.stage.id);
  const built=buildOrchestrationPlan(workflow.id,[candidate('architecture-security-advisor',1),candidate('github-oracle',2)],registry);
  built.plan.status='COMPLETE';built.stages.forEach(stage=>stage.status='COMPLETE');
  await store.createOrchestrationPlan(built.plan,built.stages);
  const planPrimary=store.addArtifact(workflow.id,'orchestration_specialist_output',requirements('primary implementation requirements'),{planId:built.plan.id,planStageId:built.stages[0].id,specialistId:'architecture-security-advisor'});
  const second=store.addArtifact(workflow.id,'orchestration_specialist_output',{security_constraints:['retain least privilege']},{planId:built.plan.id,planStageId:built.stages[1].id,specialistId:'github-oracle'});
  await store.updateOrchestrationPlanStage(built.plan.id,built.stages[0].id,'COMPLETE',planPrimary.id);
  await store.updateOrchestrationPlanStage(built.plan.id,built.stages[1].id,'COMPLETE',second.id);
  return {store,workflow,plan:built.plan};
}

test('multi-specialist Codex handoff aggregates labeled trusted contributions',async()=>{
  const {store,workflow,plan}=await prepared();let captured:any;
  const prompt={execute:async(input:any)=>{captured=input;return {kind:'success',output:{task_summary:input.objective,implementation_instructions:'implement',scope_constraints:[],tests_required:[],acceptance_criteria:[],expected_result_report:[]}};}};
  const app=new Orchestrator(store,new UnavailableSpecialist(),prompt as any,new UnavailableCodex(),new UnavailableValidation(),{ 'task21-repo':repository });
  const current=await store.getWorkflow(workflow.id);await app.run(workflow.id,contextFromWorkflow(current!,'run','specialist',principal,{'task21-repo':repository}));
  assert.equal(captured.aggregatedContext.planId,plan.id);assert.equal(captured.aggregatedContext.contributions.length,2);assert.match(captured.aggregatedContext.contributions[1].purpose,/contribution/);
  assert.ok((await store.getArtifacts(workflow.id)).some(item=>item.artifactType==='multi_specialist_context'&&item.planId===plan.id));
});

test('aggregation is deterministic and rejects cross-workflow or missing stage artifacts',async()=>{
  const {store,workflow,plan}=await prepared();const stages=await store.getOrchestrationPlanStages(plan.id);const artifacts=await store.getArtifacts(workflow.id);const first=buildMultiSpecialistContext(workflow,plan,stages,artifacts);const second=buildMultiSpecialistContext(workflow,plan,stages,artifacts);assert.deepEqual(first,second);
  const foreign=store.createWorkflow({requestId:'foreign',workflowType:'software',workflowDefinitionId:'SOFTWARE_DELIVERY',logicalSpecialistId:'architecture-security-advisor',validationRequired:true,effectiveClassification:'PUBLIC',objective:'foreign',context:{},requiresImplementation:true});
  assert.throws(()=>buildMultiSpecialistContext(foreign,plan,stages,artifacts),/MULTI_SPECIALIST_PLAN_NOT_COMPLETE/);
  stages[1].outputArtifactId=undefined;assert.throws(()=>buildMultiSpecialistContext(workflow,plan,stages,artifacts),/MULTI_SPECIALIST_REQUIRED_OUTPUT_MISSING/);
});

test('single-specialist prompt builder contract remains unchanged',async()=>{
  const result=await new SafePromptBuilder().execute({trustedContext:{principal,operation:'prompt-build',requestId:'r',workflowId:'w',specialistId:'architecture-security-advisor',executionType:'codex',effectiveClassification:'PUBLIC',resolvedRepository:repository,authorizationDecision:{allowed:true,ruleId:'test',decidedAt:new Date().toISOString()}},objective:'single',requirements:requirements('one')});
  assert.equal(result.kind,'success');assert.equal(result.output?.implementation_instructions,'one');
});
