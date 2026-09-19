import { randomUUID } from 'node:crypto';
import {CodexPrompt,SoftwareOutput,validCodexPrompt,validSoftwareOutput,validValidation,Workflow} from './domain.js';
import {resolveRoutableSpecialist} from './registry.js';
import {ClarificationStore,OrchestrationPlanStore,OverrideStore,PersistenceStore,RoutingHistoryStore,RoutingResolutionStore,SpecialistCatalogStore,hash} from './store.js';
import {CodexExecutor,PromptBuilderExecutor,SpecialistExecutor,ValidationExecutor} from './executors.js';
import {assertAuthorizedCreation,assertExecutionContext,assertWorkflowPrincipal,contextFromWorkflow,CreationContext,ExecutionContext,freezeContext,resolveRepository} from './trust.js';
import {DeterministicRequestInterpreter,InterpretationProvider,interpretAndSelect,persistResolvedRouting,resolveRouting,routingDecision} from './routing.js';
import {assertSoftwareDeliveryActivation,codexToValidationHandoff,promptToCodexHandoff,softwareDeliveryDefinitionFor,specialistToPromptHandoff} from './predefined-workflow.js';
import {assessSpecialistCoverage,buildDynamicSpecialist,mergeSpecialistCatalog} from './specialist-catalog.js';
import {buildOrchestrationPlan} from './orchestration-plan.js';
import {buildMultiSpecialistContext,readMultiSpecialistContext} from './codex-aggregation.js';
export class Orchestrator {
 constructor(public store:PersistenceStore,public specialist:SpecialistExecutor,public prompt:PromptBuilderExecutor,public codex:CodexExecutor,public validation:ValidationExecutor,private registry?:Record<string,any>,private interpreter:InterpretationProvider=new DeterministicRequestInterpreter()){ }
 private async specialistCatalog(){const source=this.store as PersistenceStore&Partial<SpecialistCatalogStore>;return source.getEffectiveSpecialists?source.getEffectiveSpecialists():mergeSpecialistCatalog();}
 async getSpecialistCatalog(){return this.specialistCatalog();}
 async create(input:{context:CreationContext;workflowInput:{request_id:string;requested_specialist?:string;objective:string;workflow_type:'software'|'non_code';requires_implementation?:boolean}},key?:string){
  const {context,b}={context:input.context,b:input.workflowInput};
  assertAuthorizedCreation(context);

  if(!b||typeof b.request_id!=='string'||!b.request_id||typeof b.objective!=='string'||!b.objective.trim()||!['software','non_code'].includes(b.workflow_type))throw new Error('INVALID_REQUEST');
  if(b.requested_specialist!==undefined&&(typeof b.requested_specialist!=='string'||!b.requested_specialist.trim()))throw new Error('INVALID_REQUEST');
  if(b.requested_specialist!==undefined&&!b.requested_specialist.trim())throw new Error('INVALID_REQUESTED_SPECIALIST');

  const workflow=await this.store.createWorkflow({
    requestId:b.request_id,
    workflowType:b.workflow_type,
    workflowDefinitionId:b.workflow_type==='software'?'SOFTWARE_DELIVERY':undefined,
    logicalSpecialistId:null,
    runtimeId:undefined,
    validationRequired:b.workflow_type==='software',
    effectiveClassification:context.effectiveClassification,
    objective:b.objective,
    context:b.workflow_type==='software'?{...context,workflowDefinitionId:'SOFTWARE_DELIVERY'}:context,
    requiresImplementation:b.requires_implementation===true
  },context.principal.id,context.operation,key??b.request_id,hash({
    workflow_type:b.workflow_type,
    requested_specialist:b.requested_specialist,
    objective:b.objective,
    requires_implementation:b.requires_implementation===true
  }));

  const routingStore=this.store as PersistenceStore&RoutingHistoryStore&Partial<RoutingResolutionStore>;
  if(!routingStore.persistRoutingResolution)throw new Error('ROUTING_RESOLUTION_PERSISTENCE_UNAVAILABLE');

  const routingRequest=b.requested_specialist
    ? `route this to ${b.requested_specialist}. ${b.objective}`
    : b.objective;

  let catalog=await this.specialistCatalog();
  if(b.requested_specialist!==undefined&&!resolveRoutableSpecialist(b.requested_specialist.trim(),catalog))throw new Error('INVALID_REQUESTED_SPECIALIST');
  let selected=await interpretAndSelect(this.interpreter,{request:routingRequest},catalog);
  const allowed=context.resolvedRepository?.allowedSpecialists;
  if(allowed?.some(id=>!resolveRoutableSpecialist(id,catalog)))throw new Error('INVALID_SPECIALIST_POLICY');
  const candidates=allowed
    ? selected.candidates.filter(candidate=>allowed.includes(candidate.specialistId))
    : selected.candidates;

  let resolution=resolveRouting(candidates);
  const coverage=assessSpecialistCoverage(selected.interpretation,candidates);
  if(coverage.kind==='CREATE'){
    const catalogStore=this.store as PersistenceStore&Partial<SpecialistCatalogStore>;
    if(!catalogStore.createDynamicSpecialist)throw new Error('SPECIALIST_CATALOG_PERSISTENCE_UNAVAILABLE');
    await catalogStore.createDynamicSpecialist(buildDynamicSpecialist(selected.interpretation,workflow.id));
    catalog=await this.specialistCatalog();
    selected=await interpretAndSelect(this.interpreter,{request:routingRequest},catalog);
    resolution=resolveRouting(allowed?selected.candidates.filter(candidate=>allowed.includes(candidate.specialistId)):selected.candidates);
  } else if(coverage.kind==='ORCHESTRATE') {
    const selectedSpecialistId=coverage.specialistIds[0]??resolution.selectedSpecialistId;
    if(!selectedSpecialistId)throw new Error('ORCHESTRATION_PLAN_TARGET_REQUIRED');
    resolution={...resolution,routingConfidence:'PROBABLE',selectedSpecialistId,routingReason:'Existing specialists collectively cover the task; a durable orchestration plan will execute them in order.',requiresClarification:false,clarificationQuestion:undefined,candidates:selected.candidates};
  } else if(coverage.kind==='CLARIFY'&&resolution.routingConfidence==='NO_MATCH') {
    resolution={...resolution,routingConfidence:'AMBIGUOUS',requiresClarification:true,clarificationQuestion:coverage.reason,candidates:selected.candidates};
  }
  const persisted=await persistResolvedRouting(routingStore,workflow.id,resolution,'INITIAL',null,catalog);
  if(coverage.kind==='ORCHESTRATE'){
    const planStore=this.store as PersistenceStore&OrchestrationPlanStore;
    if(!planStore.createOrchestrationPlan)throw new Error('ORCHESTRATION_PLAN_PERSISTENCE_UNAVAILABLE');
    const built=buildOrchestrationPlan(workflow.id,selected.candidates,catalog);
    await planStore.createOrchestrationPlan(built.plan,built.stages);
  }

  return persisted.workflow??workflow;
 }
 async resumeClarification(workflowId:string,clarificationId:string,response:string,principal:ExecutionContext['principal'],requestedSpecialist?:string){
  if(typeof response!=='string'||!response.trim())throw new Error('INVALID_CLARIFICATION_RESPONSE');
  const clarificationStore=this.store as PersistenceStore&ClarificationStore&RoutingHistoryStore;
  if(!clarificationStore.getClarification||!clarificationStore.recordClarificationResponse||!clarificationStore.resumeClarification)throw new Error('CLARIFICATION_PERSISTENCE_UNAVAILABLE');
  const pending=await clarificationStore.getClarification(clarificationId);
  if(!pending||pending.workflowId!==workflowId)throw new Error('CLARIFICATION_NOT_FOUND');
  if(pending.status!=='PENDING')throw new Error('CLARIFICATION_ALREADY_ANSWERED');
  const workflow=await this.store.getWorkflow(workflowId);
  if(!workflow)throw new Error('WORKFLOW_NOT_FOUND');
  assertWorkflowPrincipal(workflow,principal);
  const raw=workflow.context as any;
  const repositoryId=raw?.resolvedRepository?.repositoryId??raw?.repositoryId;
  const hint=typeof requestedSpecialist==='string'&&requestedSpecialist.trim()?`\nUser requested specialist focus: ${requestedSpecialist.trim()}`:'';
  const catalog=await this.specialistCatalog();
  const interpreted=await interpretAndSelect(this.interpreter,{request:`${workflow.objective}\nClarification response: ${response.trim()}${hint}`,workflowContext:{currentSpecialistId:workflow.logicalSpecialistId??undefined,routeType:'POST_CLARIFICATION'},repositoryContext:repositoryId?{repositoryId}:undefined},catalog);
  const allowed=raw?.resolvedRepository?.allowedSpecialists as readonly string[]|undefined;
  if(allowed?.some(id=>!resolveRoutableSpecialist(id,catalog)))throw new Error('INVALID_SPECIALIST_POLICY');
  const candidates=allowed?interpreted.candidates.filter(candidate=>allowed.includes(candidate.specialistId)):interpreted.candidates;
  const resolution=resolveRouting(candidates);
  if(resolution.routingConfidence==='AMBIGUOUS'||!resolution.selectedSpecialistId)throw new Error('ROUTING_UNRESOLVED');
  const decision=routingDecision(workflowId,resolution,'POST_CLARIFICATION',pending.routingDecisionId);
  const rows=resolution.candidates.map(candidate=>({id:randomUUID(),routingDecisionId:decision.id,specialistId:candidate.specialistId,rank:candidate.rank,matchReason:candidate.matchReason}));
  await clarificationStore.recordClarificationResponse(pending.id,response);
  return clarificationStore.resumeClarification(workflowId,pending.id,decision,rows);
 }
 async applyUserOverride(workflowId:string,targetSpecialistId:string,reason:string,principal:ExecutionContext['principal'],expectedDecisionId?:string){
  if(!targetSpecialistId.trim())throw new Error('INVALID_OVERRIDE_TARGET');
  const target=resolveRoutableSpecialist(targetSpecialistId.trim(),await this.specialistCatalog());
  if(!target)throw new Error('INVALID_OVERRIDE_TARGET');
  const overrideStore=this.store as PersistenceStore&OverrideStore;
  if(!overrideStore.applyUserOverride)throw new Error('OVERRIDE_PERSISTENCE_UNAVAILABLE');
  const workflow=await this.store.getWorkflow(workflowId);
  if(!workflow)throw new Error('WORKFLOW_NOT_FOUND');
  assertWorkflowPrincipal(workflow,principal);
  const raw=workflow.context as any;
  const repositoryId=raw?.resolvedRepository?.repositoryId??raw?.repositoryId;
  const repo=repositoryId&&this.registry?resolveRepository(repositoryId,this.registry):raw?.resolvedRepository;
  const {authorize}=await import('./authorization.js');
  authorize({caller:principal.id,operation:'run',specialistId:target.specialistId,repositoryId,executionType:'specialist',dataClassification:workflow.effectiveClassification??raw?.effectiveClassification??'PUBLIC',principalMaxClassification:principal.maxClassification,repository:repo});
  return overrideStore.applyUserOverride(workflowId,target.specialistId,reason,principal.id,expectedDecisionId);
 }
 async run(id:string,context:ExecutionContext,owner='worker'){assertExecutionContext(context);if(context.workflowId!==id||context.operation!=='run')throw new Error('AUTHORIZATION_FAILED');const w=await this.store.getWorkflow(id);if(!w)throw new Error('WORKFLOW_NOT_FOUND');if(!w.logicalSpecialistId)throw new Error('ROUTING_REQUIRED');if(context.specialistId!==w.logicalSpecialistId)throw new Error('AUTHORIZATION_FAILED');if(w.status==='AWAITING_CLARIFICATION')throw new Error('CLARIFICATION_REQUIRED');if(w.status==='AWAITING_APPROVAL')throw new Error('APPROVAL_REQUIRED');const f=async()=>{const planStore=this.store as PersistenceStore&Partial<OrchestrationPlanStore>;const plan=await planStore.getOrchestrationPlan?.(id);if(plan&&plan.status!=='COMPLETE')return this.runOrchestrationPlan(w,plan,owner,context.principal);return this.advance(w,owner,context.principal);};return this.store.exclusive?this.store.exclusive(id,f):f();}
 async recover(id:string,principal:ExecutionContext['principal'],reason='stale execution requires manual handoff'){if(!reason.trim()||reason.length>1000)throw new Error('INVALID_RECOVERY_REASON');const w=await this.store.getWorkflow(id);if(!w)throw new Error('WORKFLOW_NOT_FOUND');assertWorkflowPrincipal(w,principal);const recoverable=['ROUTED','SPECIALIST_RUNNING','CODEX_PROMPT_READY','CODEX_RUNNING','CODEX_COMPLETE','VALIDATION_RUNNING'];if(!recoverable.includes(w.status))throw new Error('RECOVERY_STATE_UNSAFE');const executionType=['ROUTED','SPECIALIST_RUNNING'].includes(w.status)?'specialist':['CODEX_PROMPT_READY','CODEX_RUNNING'].includes(w.status)?'codex':'validation';contextFromWorkflow(w,'run',executionType,principal,this.registry);const attempts=await this.store.getAttempts(id);if(!attempts.some(attempt=>['CLAIMED','STARTING','RUNNING','STATUS_UNKNOWN'].includes(attempt.state)))throw new Error('RECOVERY_ATTEMPT_NOT_ACTIVE');const f=async()=>this.store.transitionWorkflow(w,'MANUAL_HANDOFF_REQUIRED','operator',principal.id,{reason:reason.trim(),recovery:true});return this.store.exclusive?this.store.exclusive(id,f):f();}
 async acceptManualHandoff(id:string,content:unknown,principal:ExecutionContext['principal']){const w=await this.store.getWorkflow(id);if(!w)throw new Error('WORKFLOW_NOT_FOUND');assertWorkflowPrincipal(w,principal);if(w.status!=='MANUAL_HANDOFF_REQUIRED')throw new Error('MANUAL_HANDOFF_STATE_UNSAFE');if((await (this.store as Partial<OrchestrationPlanStore>).getOrchestrationPlan?.(id)))throw new Error('MANUAL_HANDOFF_PLAN_RESUME_UNSUPPORTED');const specialist=resolveRoutableSpecialist(w.logicalSpecialistId??'',await this.specialistCatalog());const url=specialist?.chatgptUrl;if(!specialist||specialist.status!=='ACTIVE'||specialist.runtimeStatus==='ACTIVE'||typeof url!=='string'||!/^https:\/\/(?:chatgpt\.com|chat\.openai\.com)\/g\//.test(url))throw new Error('MANUAL_HANDOFF_UNAVAILABLE');if(w.workflowType==='software'&&!validSoftwareOutput(content))throw new Error('INVALID_MANUAL_HANDOFF_OUTPUT');if(w.workflowType!=='software'&&(typeof content!=='string'&&(!content||typeof content!=='object'||Array.isArray(content))))throw new Error('INVALID_MANUAL_HANDOFF_OUTPUT');return this.store.acceptManualHandoff(id,content,principal.id);}
 private async runOrchestrationPlan(w:Workflow,plan:any,owner:string,principal:ExecutionContext['principal']){
  const planStore=this.store as PersistenceStore&OrchestrationPlanStore;
  const stages=await planStore.getOrchestrationPlanStages(plan.id);
  if(!stages.length)throw new Error('ORCHESTRATION_PLAN_EMPTY');
  if(plan.status==='PLANNED')await planStore.updateOrchestrationPlan(plan.id,'RUNNING');
  const catalog=await this.specialistCatalog();
  for(const stage of stages.sort((a,b)=>a.order-b.order)){
    if(stage.status==='COMPLETE')continue;
    const dependencies=stages.filter(candidate=>stage.dependencies.includes(candidate.id));
    if(dependencies.some(dependency=>dependency.status!=='COMPLETE')){
      if(dependencies.some(dependency=>['FAILED','MANUAL_HANDOFF_REQUIRED'].includes(dependency.status)))await planStore.updateOrchestrationPlan(plan.id,'FAILED');
      return w;
    }
    const specialist=resolveRoutableSpecialist(stage.specialistId,catalog);
    if(!specialist)throw new Error('INVALID_ORCHESTRATION_SPECIALIST');
    const base=contextFromWorkflow(w,'run','specialist',principal,this.registry);
    const stageContext=freezeContext({principal,operation:'run',requestId:w.requestId,workflowId:w.id,specialistId:specialist.specialistId,executionType:'specialist',effectiveClassification:base.effectiveClassification},base.resolvedRepository);
    if(!specialist.runtime||specialist.runtime.status!=='ACTIVE'){
      await planStore.updateOrchestrationPlanStage(plan.id,stage.id,'MANUAL_HANDOFF_REQUIRED');
      await planStore.updateOrchestrationPlan(plan.id,'MANUAL_HANDOFF_REQUIRED');
      if(!['SPECIALIST_RUNNING','MANUAL_HANDOFF_REQUIRED'].includes(w.status))await this.store.transitionWorkflow(w,'MANUAL_HANDOFF_REQUIRED','system','orchestration',{planId:plan.id,planStageId:stage.id,reason:'runtime_not_executable'});
      else if(w.status==='SPECIALIST_RUNNING')await this.store.transitionWorkflow(w,'MANUAL_HANDOFF_REQUIRED','system','orchestration',{planId:plan.id,planStageId:stage.id,reason:'runtime_not_executable'});
      return w;
    }
    const predecessorArtifacts=(await this.store.getArtifacts(w.id)).filter(artifact=>artifact.planId===plan.id&&stage.dependencies.includes(artifact.planStageId??''));
    const context={workflowObjective:w.objective,stagePurpose:stage.purpose,predecessorArtifacts:predecessorArtifacts.map(artifact=>({artifactId:artifact.id,type:artifact.artifactType,content:artifact.contentJson}))};
    const claim=await this.store.claimStage(w.id,`orchestration:${plan.id}:${stage.id}`,'specialist',specialist.runtime.runtimeId,owner);
    if(claim.existing){if(claim.stage.status==='COMPLETE')await planStore.updateOrchestrationPlanStage(plan.id,stage.id,'COMPLETE',claim.stage.outputArtifactId);return w;}
    await planStore.updateOrchestrationPlanStage(plan.id,stage.id,'RUNNING');
    const result=await this.specialist.execute({trustedContext:stageContext,workflowId:w.id,stageId:claim.stage.id,runtimeId:specialist.runtime.runtimeId,runtimeVersion:specialist.runtime.version,objective:w.objective,context,expectedOutputSchema:specialist.runtime.outputSchema});
    if(result.kind!=='success'||result.output===undefined){await this.store.failStage(w.id,claim.attempt.id,'FAILED',{errorCode:result.errorCode??'SPECIALIST_EXECUTION_FAILED'},owner);await planStore.updateOrchestrationPlanStage(plan.id,stage.id,'FAILED');await planStore.updateOrchestrationPlan(plan.id,'FAILED');await this.fail(w,result.errorCode??'SPECIALIST_EXECUTION_FAILED');return w;}
    await this.store.recordInitiation(w.id,claim.attempt.id,{provider:'specialist',externalExecutionId:result.externalExecutionId},owner);
    if(w.status==='ROUTED')await this.store.transitionWorkflow(w,'SPECIALIST_RUNNING','orchestrator','orchestration',{planId:plan.id,planStageId:stage.id},claim.stage.id);
    const artifact=await this.store.addArtifact(w.id,stage.order===0?'specialist_output':'orchestration_specialist_output',result.output,{planId:plan.id,planStageId:stage.id,specialistId:specialist.specialistId});
    await this.store.completeStage(w.id,claim.attempt.id,result.externalExecutionId,artifact.id,{planId:plan.id,planStageId:stage.id},owner);
    await planStore.updateOrchestrationPlanStage(plan.id,stage.id,'COMPLETE',artifact.id);
  }
  await planStore.updateOrchestrationPlan(plan.id,'COMPLETE');
  if(w.status==='ROUTED')await this.store.transitionWorkflow(w,'SPECIALIST_RUNNING','orchestrator','orchestration',{planId:plan.id});
  if(w.status==='SPECIALIST_RUNNING')await this.store.transitionWorkflow(w,'SPECIALIST_COMPLETE','orchestrator','orchestration',{planId:plan.id});
  if(w.workflowType==='software')return w;
  await this.store.transitionWorkflow(w,'COMPLETE','orchestrator','orchestration',{planId:plan.id});
  return w;
 }
 private async advance(w:Workflow,owner:string,principal:ExecutionContext['principal']){if(!w.logicalSpecialistId)throw new Error('ROUTING_REQUIRED');const s=resolveRoutableSpecialist(w.logicalSpecialistId,await this.specialistCatalog());if(!s)throw new Error('INVALID_ROUTING_TARGET');
  const predefined=softwareDeliveryDefinitionFor(w);
  const assertActivation=async(target:Parameters<typeof assertSoftwareDeliveryActivation>[1])=>{if(predefined)assertSoftwareDeliveryActivation(w,target,await this.store.getStages(w.id),await this.store.getAttempts(w.id),await this.store.getArtifacts(w.id));};
  if(w.status==='ROUTED'){await assertActivation('SPECIALIST_ANALYSIS');const cxt=contextFromWorkflow(w,'run','specialist',principal,this.registry);if(!s.runtime||s.runtime.status!=='ACTIVE'){await this.store.transitionWorkflow(w,'MANUAL_HANDOFF_REQUIRED','system','disposition',{reason:'runtime_not_executable'});return w;}const c=await this.store.claimStage(w.id,`specialist:${s.specialistId}`,'specialist',s.runtime.runtimeId,owner);if(c.existing)return w;const r=await this.specialist.execute({trustedContext:cxt,workflowId:w.id,stageId:c.stage.id,runtimeId:s.runtime.runtimeId,runtimeVersion:s.runtime.version,objective:w.objective,context:w.context,expectedOutputSchema:s.runtime.outputSchema});if(r.kind!=='success'){await this.store.failStage(w.id,c.attempt.id,r.kind==='retryable_failure'?'STATUS_UNKNOWN':'FAILED',{errorCode:r.errorCode},owner);if(r.kind==='retryable_failure')await this.store.transitionWorkflow(w,'MANUAL_HANDOFF_REQUIRED','orchestrator','ambiguous-execution');else await this.fail(w,r.errorCode??'SPECIALIST_EXECUTION_FAILED');return w;}await this.store.recordInitiation(w.id,c.attempt.id,{provider:'openai',externalExecutionId:r.externalExecutionId},owner);await this.store.transitionWorkflow(w,'SPECIALIST_RUNNING','orchestrator','specialist',undefined,c.stage.id);if(!validSoftwareOutput(r.output)){await this.fail(w,'SPECIALIST_OUTPUT_INVALID');return w;}const a=await this.store.addArtifact(w.id,'specialist_output',r.output);await this.store.completeStage(w.id,c.attempt.id,r.externalExecutionId,a.id,{terminal:'provider_success'},owner);w.validationRequired=w.workflowType==='software'&&(r.output as SoftwareOutput).validation_required;await this.store.transitionWorkflow(w,'SPECIALIST_COMPLETE','executor',s.runtime.runtimeId,{artifactId:a.id},c.stage.id);if(w.workflowType==='non_code'){await this.store.transitionWorkflow(w,'COMPLETE','orchestrator','state-machine');return w;}}
  if(w.status==='SPECIALIST_COMPLETE'&&w.workflowType==='software'){await assertActivation('PROMPT_BUILD');const cxt=contextFromWorkflow(w,'prompt-build','codex',principal,this.registry);const artifacts=await this.store.getArtifacts(w.id);const planStore=this.store as PersistenceStore&Partial<OrchestrationPlanStore>;const plan=await planStore.getOrchestrationPlan?.(w.id);let aggregatedContext;let req=(artifacts.find(a=>a.artifactType==='specialist_output'||a.artifactType==='manual_specialist_output')?.contentJson as SoftwareOutput|undefined);if(plan&&plan.status==='COMPLETE'&&(await planStore.getOrchestrationPlanStages?.(plan.id))?.length){const stages=await planStore.getOrchestrationPlanStages!(plan.id);aggregatedContext=buildMultiSpecialistContext(w,plan,stages,artifacts);const existing=artifacts.find(a=>a.artifactType==='multi_specialist_context'&&a.planId===plan.id);if(!existing)await this.store.addArtifact(w.id,'multi_specialist_context',aggregatedContext,{planId:plan.id});req=aggregatedContext.primaryRequirements;}if(!req||!validSoftwareOutput(req)){await this.fail(w,'SPECIALIST_OUTPUT_INVALID');return w;}const handoff=specialistToPromptHandoff(w,req);const c=await this.store.claimStage(w.id,'codex-prompt-builder','prompt_builder',undefined,owner);if(!(c.existing&&c.stage.status==='COMPLETE')){const r=await this.prompt.execute({trustedContext:cxt,...handoff.payload,...(aggregatedContext?{aggregatedContext}:{})});if(r.kind!=='success'||!validCodexPrompt(r.output)){await this.fail(w,'CODEX_PROMPT_FAILED');return w;}const a=await this.store.addArtifact(w.id,'codex_prompt',r.output);await this.store.completeStage(w.id,c.attempt.id,undefined,a.id,{contentHash:a.contentHash,planId:plan?.id,planVersion:plan?.version},owner);}if(w.status==='SPECIALIST_COMPLETE')await this.store.transitionWorkflow(w,'CODEX_PROMPT_READY','executor','codex-prompt-builder');}
  if(w.status==='CODEX_PROMPT_READY'){await assertActivation('CODEX_EXECUTION');const cxt=contextFromWorkflow(w,'run','codex',principal,this.registry);const p=(await this.store.getArtifacts(w.id)).find(a=>a.artifactType==='codex_prompt')!.contentJson as CodexPrompt;const handoff=promptToCodexHandoff(p);const c=await this.store.claimStage(w.id,'codex','codex',undefined,owner);if(c.existing)return w;const r=await this.codex.execute({trustedContext:cxt,workflowId:w.id,stageId:c.stage.id,...handoff.payload});if(r.kind!=='success'||!r.output||r.output.exitCode!==0){await this.store.failStage(w.id,c.attempt.id,r.kind==='retryable_failure'?'STATUS_UNKNOWN':'FAILED',{errorCode:r.errorCode},owner);if(r.kind==='retryable_failure')await this.store.transitionWorkflow(w,'MANUAL_HANDOFF_REQUIRED','orchestrator','ambiguous-execution');else await this.fail(w,r.errorCode??'CODEX_EXECUTION_FAILED');return w;}try{await this.store.recordInitiation(w.id,c.attempt.id,{process:'codex',terminalObserved:true,externalExecutionId:r.externalExecutionId},owner);}catch(error){await this.store.failStage(w.id,c.attempt.id,'STATUS_UNKNOWN',{errorCode:'INITIATION_PERSISTENCE_FAILED',externalExecutionId:r.externalExecutionId,executionCertainty:'AMBIGUOUS_MAY_HAVE_STARTED'},owner);await this.store.transitionWorkflow(w,'FAILED','orchestrator','ambiguous-execution',{errorCode:'INITIATION_PERSISTENCE_FAILED',externalExecutionId:r.externalExecutionId});return w;}await this.store.transitionWorkflow(w,'CODEX_RUNNING','orchestrator','codex',undefined,c.stage.id);const a=await this.store.addArtifact(w.id,'codex_result',r.output);await this.store.completeStage(w.id,c.attempt.id,r.externalExecutionId,a.id,{exitCode:r.output.exitCode},owner);await this.store.transitionWorkflow(w,'CODEX_COMPLETE','executor','codex',{artifactId:a.id},c.stage.id);}
  if(w.status==='CODEX_COMPLETE'){if(!w.validationRequired){await this.store.transitionWorkflow(w,'COMPLETE','orchestrator','state-machine');return w;}await assertActivation('VALIDATION');const cxt=contextFromWorkflow(w,'validate','validation',principal,this.registry);const a=await this.store.getArtifacts(w.id);const req=a.find(x=>x.artifactType==='specialist_output'||x.artifactType==='manual_specialist_output')!.contentJson as SoftwareOutput,p=a.find(x=>x.artifactType==='codex_prompt')!.contentJson as CodexPrompt,r=a.find(x=>x.artifactType==='codex_result')!.contentJson as any;const aggregateArtifact=a.find(x=>x.artifactType==='multi_specialist_context');const aggregate=aggregateArtifact?readMultiSpecialistContext(aggregateArtifact):undefined;const handoff=codexToValidationHandoff(req,p,r);const c=await this.store.claimStage(w.id,`validation:${s.specialistId}`,'validation',s.runtime?.runtimeId,owner);if(c.existing)return w;const v=await this.validation.execute({trustedContext:cxt,workflowId:w.id,stageId:c.stage.id,...handoff.payload,...(aggregate?{multiSpecialistContext:aggregate}:{})} as any);if(v.kind!=='success'||!validValidation(v.output)){await this.store.failStage(w.id,c.attempt.id,'FAILED',{errorCode:'VALIDATION_FAILED'},owner);await this.fail(w,'VALIDATION_FAILED');return w;}await this.store.recordInitiation(w.id,c.attempt.id,{provider:'openai',externalExecutionId:v.externalExecutionId},owner);await this.store.transitionWorkflow(w,'VALIDATION_RUNNING','orchestrator','validation',undefined,c.stage.id);const out=await this.store.addArtifact(w.id,'validation_result',v.output);await this.store.completeStage(w.id,c.attempt.id,v.externalExecutionId,out.id,{verdict:v.output.verdict},owner);if(v.output.verdict==='PASS')await this.store.transitionWorkflow(w,'COMPLETE','executor','validation',{artifactId:out.id},c.stage.id);else await this.fail(w,'VALIDATION_FAILED');}return w;}
 private async fail(w:Workflow,code:string){w.failureCode=code;w.failureMessage='Workflow could not continue';if(w.status!=='FAILED')await this.store.transitionWorkflow(w,'FAILED','orchestrator','failure',{errorCode:code});}
}
