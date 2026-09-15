import {CodexPrompt,SoftwareOutput,validCodexPrompt,validSoftwareOutput,validValidation,Workflow} from './domain.js';
import {resolveSpecialist} from './registry.js';
import {PersistenceStore,RoutingHistoryStore,RoutingResolutionStore,hash} from './store.js';
import {CodexExecutor,PromptBuilderExecutor,SpecialistExecutor,ValidationExecutor} from './executors.js';
import {assertAuthorizedCreation,assertExecutionContext,contextFromWorkflow,CreationContext,ExecutionContext} from './trust.js';
import {DeterministicRequestInterpreter,InterpretationProvider,interpretAndSelect,persistResolvedRouting,resolveRouting} from './routing.js';
export class Orchestrator {
 constructor(public store:PersistenceStore,public specialist:SpecialistExecutor,public prompt:PromptBuilderExecutor,public codex:CodexExecutor,public validation:ValidationExecutor,private registry?:Record<string,any>,private interpreter:InterpretationProvider=new DeterministicRequestInterpreter()){ }
 async create(input:{context:CreationContext;workflowInput:{request_id:string;requested_specialist?:string;objective:string;workflow_type:'software'|'non_code';requires_implementation?:boolean}},key?:string){
  const {context,b}={context:input.context,b:input.workflowInput};
  assertAuthorizedCreation(context);

  if(!b||typeof b.request_id!=='string'||!b.request_id||typeof b.objective!=='string'||!b.objective.trim()||!['software','non_code'].includes(b.workflow_type))throw new Error('INVALID_REQUEST');
  if(b.requested_specialist!==undefined&&(typeof b.requested_specialist!=='string'||!b.requested_specialist.trim()))throw new Error('INVALID_REQUEST');

  const workflow=await this.store.createWorkflow({
    requestId:b.request_id,
    workflowType:b.workflow_type,
    logicalSpecialistId:null,
    runtimeId:undefined,
    validationRequired:b.workflow_type==='software',
    effectiveClassification:context.effectiveClassification,
    objective:b.objective,
    context,
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

  const selected=await interpretAndSelect(this.interpreter,{request:routingRequest});
  const allowed=context.resolvedRepository?.allowedSpecialists;
  const candidates=allowed
    ? selected.candidates.filter(candidate=>allowed.includes(candidate.specialistId))
    : selected.candidates;

  const resolution=resolveRouting(candidates);
  const persisted=await persistResolvedRouting(routingStore,workflow.id,resolution);

  return persisted.workflow??workflow;
 }
 async run(id:string,context:ExecutionContext,owner='worker'){assertExecutionContext(context);if(context.workflowId!==id||context.operation!=='run')throw new Error('AUTHORIZATION_FAILED');const w=await this.store.getWorkflow(id);if(!w)throw new Error('WORKFLOW_NOT_FOUND');if(!w.logicalSpecialistId)throw new Error('ROUTING_REQUIRED');if(context.specialistId!==w.logicalSpecialistId)throw new Error('AUTHORIZATION_FAILED');if(w.status==='AWAITING_CLARIFICATION')throw new Error('CLARIFICATION_REQUIRED');if(w.status==='AWAITING_APPROVAL')throw new Error('APPROVAL_REQUIRED');const f=()=>this.advance(w,owner,context.principal);return this.store.exclusive?this.store.exclusive(id,f):f();}
 private async advance(w:Workflow,owner:string,principal:ExecutionContext['principal']){if(!w.logicalSpecialistId)throw new Error('ROUTING_REQUIRED');const s=resolveSpecialist(w.logicalSpecialistId)!;
  if(w.status==='ROUTED'){const cxt=contextFromWorkflow(w,'run','specialist',principal,this.registry);if(!s.runtime||s.runtime.status!=='ACTIVE'){await this.store.transitionWorkflow(w,'MANUAL_HANDOFF_REQUIRED','system','disposition',{reason:'runtime_not_executable'});return w;}const c=await this.store.claimStage(w.id,`specialist:${s.specialistId}`,'specialist',s.runtime.runtimeId,owner);if(c.existing)return w;const r=await this.specialist.execute({trustedContext:cxt,workflowId:w.id,stageId:c.stage.id,runtimeId:s.runtime.runtimeId,runtimeVersion:s.runtime.version,objective:w.objective,context:w.context,expectedOutputSchema:s.runtime.outputSchema});if(r.kind!=='success'){await this.store.failStage(w.id,c.attempt.id,r.kind==='retryable_failure'?'STATUS_UNKNOWN':'FAILED',{errorCode:r.errorCode},owner);if(r.kind==='retryable_failure')await this.store.transitionWorkflow(w,'MANUAL_HANDOFF_REQUIRED','orchestrator','ambiguous-execution');else await this.fail(w,r.errorCode??'SPECIALIST_EXECUTION_FAILED');return w;}await this.store.recordInitiation(w.id,c.attempt.id,{provider:'openai',externalExecutionId:r.externalExecutionId},owner);await this.store.transitionWorkflow(w,'SPECIALIST_RUNNING','orchestrator','specialist',undefined,c.stage.id);if(!validSoftwareOutput(r.output)){await this.fail(w,'SPECIALIST_OUTPUT_INVALID');return w;}const a=await this.store.addArtifact(w.id,'specialist_output',r.output);await this.store.completeStage(w.id,c.attempt.id,r.externalExecutionId,a.id,{terminal:'provider_success'},owner);w.validationRequired=w.workflowType==='software'&&(r.output as SoftwareOutput).validation_required;await this.store.transitionWorkflow(w,'SPECIALIST_COMPLETE','executor',s.runtime.runtimeId,{artifactId:a.id},c.stage.id);if(w.workflowType==='non_code'){await this.store.transitionWorkflow(w,'COMPLETE','orchestrator','state-machine');return w;}}
  if(w.status==='SPECIALIST_COMPLETE'&&w.workflowType==='software'){const cxt=contextFromWorkflow(w,'prompt-build','codex',principal,this.registry);const req=(await this.store.getArtifacts(w.id)).find(a=>a.artifactType==='specialist_output')!.contentJson as SoftwareOutput;const c=await this.store.claimStage(w.id,'codex-prompt-builder','prompt_builder',undefined,owner);if(!(c.existing&&c.stage.status==='COMPLETE')){const r=await this.prompt.execute({trustedContext:cxt,objective:w.objective,requirements:req});if(r.kind!=='success'||!validCodexPrompt(r.output)){await this.fail(w,'CODEX_PROMPT_FAILED');return w;}const a=await this.store.addArtifact(w.id,'codex_prompt',r.output);await this.store.completeStage(w.id,c.attempt.id,undefined,a.id,{contentHash:a.contentHash},owner);}if(w.status==='SPECIALIST_COMPLETE')await this.store.transitionWorkflow(w,'CODEX_PROMPT_READY','executor','codex-prompt-builder');}
  if(w.status==='CODEX_PROMPT_READY'){const cxt=contextFromWorkflow(w,'run','codex',principal,this.registry);const p=(await this.store.getArtifacts(w.id)).find(a=>a.artifactType==='codex_prompt')!.contentJson as CodexPrompt;const c=await this.store.claimStage(w.id,'codex','codex',undefined,owner);if(c.existing)return w;const r=await this.codex.execute({trustedContext:cxt,workflowId:w.id,stageId:c.stage.id,promptArtifact:p,executionPolicy:{noMerge:true,noDeploy:true}});if(r.kind!=='success'||!r.output||r.output.exitCode!==0){await this.store.failStage(w.id,c.attempt.id,r.kind==='retryable_failure'?'STATUS_UNKNOWN':'FAILED',{errorCode:r.errorCode},owner);if(r.kind==='retryable_failure')await this.store.transitionWorkflow(w,'MANUAL_HANDOFF_REQUIRED','orchestrator','ambiguous-execution');else await this.fail(w,r.errorCode??'CODEX_EXECUTION_FAILED');return w;}try{await this.store.recordInitiation(w.id,c.attempt.id,{process:'codex',terminalObserved:true,externalExecutionId:r.externalExecutionId},owner);}catch(error){await this.store.failStage(w.id,c.attempt.id,'STATUS_UNKNOWN',{errorCode:'INITIATION_PERSISTENCE_FAILED',externalExecutionId:r.externalExecutionId,executionCertainty:'AMBIGUOUS_MAY_HAVE_STARTED'},owner);await this.store.transitionWorkflow(w,'FAILED','orchestrator','ambiguous-execution',{errorCode:'INITIATION_PERSISTENCE_FAILED',externalExecutionId:r.externalExecutionId});return w;}await this.store.transitionWorkflow(w,'CODEX_RUNNING','orchestrator','codex',undefined,c.stage.id);const a=await this.store.addArtifact(w.id,'codex_result',r.output);await this.store.completeStage(w.id,c.attempt.id,r.externalExecutionId,a.id,{exitCode:r.output.exitCode},owner);await this.store.transitionWorkflow(w,'CODEX_COMPLETE','executor','codex',{artifactId:a.id},c.stage.id);}
  if(w.status==='CODEX_COMPLETE'){if(!w.validationRequired){await this.store.transitionWorkflow(w,'COMPLETE','orchestrator','state-machine');return w;}const cxt=contextFromWorkflow(w,'validate','validation',principal,this.registry);const a=await this.store.getArtifacts(w.id);const req=a.find(x=>x.artifactType==='specialist_output')!.contentJson as SoftwareOutput,p=a.find(x=>x.artifactType==='codex_prompt')!.contentJson as CodexPrompt,r=a.find(x=>x.artifactType==='codex_result')!.contentJson as any;const c=await this.store.claimStage(w.id,`validation:${s.specialistId}`,'validation',s.runtime?.runtimeId,owner);if(c.existing)return w;const v=await this.validation.execute({trustedContext:cxt,workflowId:w.id,stageId:c.stage.id,originalRequirements:req,codexPrompt:p,codexResult:r,changedFiles:r.changedFiles,testResults:r.testResults});if(v.kind!=='success'||!validValidation(v.output)){await this.store.failStage(w.id,c.attempt.id,'FAILED',{errorCode:'VALIDATION_FAILED'},owner);await this.fail(w,'VALIDATION_FAILED');return w;}await this.store.recordInitiation(w.id,c.attempt.id,{provider:'openai',externalExecutionId:v.externalExecutionId},owner);await this.store.transitionWorkflow(w,'VALIDATION_RUNNING','orchestrator','validation',undefined,c.stage.id);const out=await this.store.addArtifact(w.id,'validation_result',v.output);await this.store.completeStage(w.id,c.attempt.id,v.externalExecutionId,out.id,{verdict:v.output.verdict},owner);if(v.output.verdict==='PASS')await this.store.transitionWorkflow(w,'COMPLETE','executor','validation',{artifactId:out.id},c.stage.id);else await this.fail(w,'VALIDATION_FAILED');}return w;}
 private async fail(w:Workflow,code:string){w.failureCode=code;w.failureMessage='Workflow could not continue';if(w.status!=='FAILED')await this.store.transitionWorkflow(w,'FAILED','orchestrator','failure',{errorCode:code});}
}
