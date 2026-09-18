import { createHash, randomUUID } from 'node:crypto';
import { ApprovalRequest, Artifact, Attempt, AttemptState, RoutingCandidate, RoutingClarification, RoutingDecision, Stage, StageType, Workflow, WorkflowStatus, assertTransition } from './domain.js';

export interface Event { id:string; workflowId:string; sequence:number; eventType:string; actorType:string; actorId:string; stageId?:string; metadata?:unknown; createdAt:string; }
export interface RequestIdempotency { callerId:string; operation:string; key:string; requestHash:string; workflowId:string; resultReference?:string; }
export interface StageClaim { stage:Stage; attempt:Attempt; existing:boolean; }
export interface RoutingHistoryStore {
  recordRoutingDecision(decision:RoutingDecision):Promise<RoutingDecision>;
  recordRoutingCandidates(candidates:RoutingCandidate[]):Promise<RoutingCandidate[]>;
  recordRoutingDecisionWithCandidates(decision:RoutingDecision,candidates:RoutingCandidate[]):Promise<{decision:RoutingDecision; candidates:RoutingCandidate[]}>;
  getRoutingDecision(id:string):Promise<RoutingDecision|undefined>;
  getRoutingCandidates(decisionId:string):Promise<RoutingCandidate[]>;
  getRoutingHistory(workflowId:string):Promise<RoutingDecision[]>;
  getLatestRoutingDecision(workflowId:string):Promise<RoutingDecision|undefined>;
}
export interface RoutingResolutionStore { persistRoutingResolution(decision:RoutingDecision,candidates:RoutingCandidate[],clarificationQuestion?:string):Promise<{decision:RoutingDecision;candidates:RoutingCandidate[];clarification?:RoutingClarification;workflow:Workflow}>; }
export interface ClarificationStore {
  createPendingClarification(input:Omit<RoutingClarification,'id'|'status'|'response'|'createdAt'|'answeredAt'>):Promise<RoutingClarification>;
  getClarification(id:string):Promise<RoutingClarification|undefined>;
  getPendingClarification(workflowId:string):Promise<RoutingClarification|undefined>;
  getClarificationHistory(workflowId:string):Promise<RoutingClarification[]>;
  recordClarificationResponse(id:string,response:string):Promise<RoutingClarification>;
  resumeClarification(workflowId:string,clarificationId:string,decision:RoutingDecision,candidates:RoutingCandidate[]):Promise<{clarification:RoutingClarification;decision:RoutingDecision;candidates:RoutingCandidate[];workflow:Workflow}>;
}
export interface ApprovalStore {
  createPendingApproval(input:Omit<ApprovalRequest,'id'|'status'|'decisionReason'|'decidedBy'|'createdAt'|'decidedAt'>):Promise<ApprovalRequest>;
  getApproval(id:string):Promise<ApprovalRequest|undefined>;
  getPendingApproval(workflowId:string,protectedActionId?:string):Promise<ApprovalRequest|undefined>;
  getApprovalHistory(workflowId:string):Promise<ApprovalRequest[]>;
  decideApproval(id:string,status:'APPROVED'|'REJECTED',decisionReason?:string,decidedBy?:string):Promise<ApprovalRequest>;
  getApprovedApproval(workflowId:string,protectedActionId:string,scopeFingerprint?:string):Promise<ApprovalRequest|undefined>;
}
export interface OverrideStore {
  applyUserOverride(workflowId:string,targetSpecialistId:string,reason?:string,actorId?:string,expectedDecisionId?:string):Promise<{workflow:Workflow;decision:RoutingDecision;previousDecision:RoutingDecision;candidates:RoutingCandidate[]}>;
}
export interface PersistenceStore {
  createWorkflow(input:Omit<Workflow,'id'|'status'|'version'|'createdAt'|'updatedAt'>, callerId?:string, operation?:string, key?:string, requestHash?:string):Workflow|Promise<Workflow>;
  getWorkflow(id:string):Workflow|undefined|Promise<Workflow|undefined>;
  getStages(id:string):Stage[]|Promise<Stage[]>; getAttempts(id:string):Attempt[]|Promise<Attempt[]>;
  claimStage(workflowId:string,logicalStageKey:string,stageType:StageType,runtimeId:string|undefined,ownerId:string):StageClaim|Promise<StageClaim>;
  recordInitiation(workflowId:string,attemptId:string,evidence:unknown,ownerId?:string):Attempt|Promise<Attempt>;
  completeStage(workflowId:string,attemptId:string,externalExecutionId:string|undefined,artifactId:string|undefined,evidence:unknown,ownerId?:string):Attempt|Promise<Attempt>;
  failStage(workflowId:string,attemptId:string,state:AttemptState,evidence?:unknown,ownerId?:string):Attempt|Promise<Attempt>;
  markStageStatusUnknown(workflowId:string,attemptId:string,evidence:unknown):Attempt|Promise<Attempt>;
  transitionWorkflow(w:Workflow,to:WorkflowStatus,actorType:string,actorId:string,metadata?:unknown,stageId?:string):Workflow|Promise<Workflow>;
  addArtifact(workflowId:string,type:string,content:unknown):Artifact|Promise<Artifact>; getArtifacts(id:string):Artifact[]|Promise<Artifact[]>;
  appendEvent(event:Omit<Event,'id'|'sequence'|'createdAt'>):Event|Promise<Event>; getEvents(id:string):Event[]|Promise<Event[]>;
  getRequestIdempotency(callerId:string,operation:string,key:string):RequestIdempotency|undefined|Promise<RequestIdempotency|undefined>;
  reconstructWorkflow(id:string):unknown|Promise<unknown>;
  exclusive?<T>(id:string,fn:()=>Promise<T>):Promise<T>;
}

export class MemoryStore implements PersistenceStore,RoutingHistoryStore,RoutingResolutionStore,ClarificationStore,OverrideStore {
  workflows=new Map<string,Workflow>(); stages=new Map<string,Stage>(); attempts=new Map<string,Attempt>(); artifacts=new Map<string,Artifact>(); events=new Map<string,Event[]>(); idem=new Map<string,RequestIdempotency>(); locks=new Map<string,Promise<void>>();
  routingDecisions=new Map<string,RoutingDecision>(); routingCandidates=new Map<string,RoutingCandidate[]>(); routingClarifications=new Map<string,RoutingClarification>();
  async exclusive<T>(id:string,fn:()=>Promise<T>):Promise<T>{const prior=this.locks.get(id)??Promise.resolve();let release!:()=>void;const current=new Promise<void>(r=>release=r);this.locks.set(id,prior.then(()=>current));await prior;try{return await fn();}finally{release();if(this.locks.get(id)===current)this.locks.delete(id);}}
  createWorkflow(input:Omit<Workflow,'id'|'status'|'version'|'createdAt'|'updatedAt'>,callerId='local',operation='create',key=input.requestId,requestHash=hash(input)){const ik=`${callerId}:${operation}:${key}`;const old=this.idem.get(ik);if(old){if(old.requestHash!==requestHash)throw new Error('IDEMPOTENCY_KEY_REUSED');return this.workflows.get(old.workflowId)!;}const existing=[...this.workflows.values()].find(w=>w.requestId===input.requestId);if(existing)return existing;const now=new Date().toISOString();const w:Workflow={...input,id:randomUUID(),status:'CREATED',version:0,createdAt:now,updatedAt:now};this.workflows.set(w.id,w);this.events.set(w.id,[]);if(w.logicalSpecialistId)this.transitionWorkflow(w,'ROUTED','system','router',{runtimeDisposition:'resolved'});this.idem.set(ik,{callerId,operation,key,requestHash,workflowId:w.id});return w;}
  getWorkflow(id:string){return this.workflows.get(id);}
  getStages(id:string){return [...this.stages.values()].filter(x=>x.workflowId===id);}
  getAttempts(id:string){return [...this.attempts.values()].filter(x=>x.workflowId===id);}
  claimStage(workflowId:string,key:string,stageType:StageType,runtimeId:string|undefined,ownerId:string){const workflow=this.workflows.get(workflowId);if(!workflow)throw new Error('WORKFLOW_NOT_FOUND');if(!workflow.logicalSpecialistId)throw new Error('ROUTING_REQUIRED');const status=workflow.status;if(status==='AWAITING_CLARIFICATION')throw new Error('CLARIFICATION_REQUIRED');if(status==='AWAITING_APPROVAL')throw new Error('APPROVAL_REQUIRED');const existing=[...this.stages.values()].find(x=>x.workflowId===workflowId&&x.logicalStageKey===key);if(existing){const active=this.getAttempts(workflowId).find(a=>a.stageId===existing.id&&!['SUCCEEDED','FAILED','FAILED_TO_START','TIMED_OUT','CANCELLED'].includes(a.state));if(active)return {stage:existing,attempt:active,existing:true};if(existing.status==='COMPLETE')return {stage:existing,attempt:this.getAttempts(workflowId).find(a=>a.stageId===existing.id)! ,existing:true};}const stage=existing??{id:randomUUID(),workflowId,stageType,logicalStageKey:key,runtimeId,status:'PENDING' as const,attempt:0};if(!existing)this.stages.set(stage.id,stage);const n=this.getAttempts(workflowId).filter(a=>a.stageId===stage.id).length+1;const attempt:Attempt={id:randomUUID(),workflowId,stageId:stage.id,logicalStageKey:key,attemptNumber:n,ownerId,state:'CLAIMED'};this.attempts.set(attempt.id,attempt);stage.attempt=n;return {stage,attempt,existing:false};}
  recordInitiation(workflowId:string,attemptId:string,evidence:unknown,ownerId?:string){const a=this.attempts.get(attemptId);if(!a)throw new Error('ATTEMPT_NOT_FOUND');if(a.workflowId!==workflowId)throw new Error('ATTEMPT_WORKFLOW_MISMATCH');if(ownerId&&a.ownerId!==ownerId)throw new Error('ATTEMPT_NOT_OWNER');a.state='RUNNING';a.initiationEvidence=evidence;return a;}
  completeStage(workflowId:string,attemptId:string,externalExecutionId:string|undefined,artifactId:string|undefined,evidence:unknown,ownerId?:string){const a=this.attempts.get(attemptId);if(!a)throw new Error('ATTEMPT_NOT_FOUND');if(a.workflowId!==workflowId)throw new Error('ATTEMPT_WORKFLOW_MISMATCH');if(ownerId&&a.ownerId!==ownerId)throw new Error('ATTEMPT_NOT_OWNER');if(artifactId&&this.artifacts.get(artifactId)?.workflowId!==workflowId)throw new Error('ARTIFACT_WORKFLOW_MISMATCH');a.state='SUCCEEDED';a.terminalEvidence={evidence,externalExecutionId,artifactId};const s=this.stages.get(a.stageId)!;s.status='COMPLETE';s.externalExecutionId=externalExecutionId;s.outputArtifactId=artifactId;s.evidence=evidence;return a;}
  failStage(workflowId:string,attemptId:string,state:AttemptState,evidence?:unknown,ownerId?:string){const a=this.attempts.get(attemptId);if(!a)throw new Error('ATTEMPT_NOT_FOUND');if(a.workflowId!==workflowId)throw new Error('ATTEMPT_WORKFLOW_MISMATCH');if(ownerId&&a.ownerId!==ownerId)throw new Error('ATTEMPT_NOT_OWNER');a.state=state;a.terminalEvidence=evidence;this.stages.get(a.stageId)!.status='FAILED';return a;}
  markStageStatusUnknown(w:string,id:string,e:unknown){return this.failStage(w,id,'STATUS_UNKNOWN',e);}
  transitionWorkflow(w:Workflow,to:WorkflowStatus,actorType:string,actorId:string,metadata?:unknown,stageId?:string){assertTransition(w.status,to);w.status=to;w.version++;w.updatedAt=new Date().toISOString();this.appendEvent({workflowId:w.id,eventType:`WORKFLOW_${to}`,actorType,actorId,stageId,metadata});return w;}
  addArtifact(workflowId:string,type:string,content:unknown){if(!this.workflows.has(workflowId))throw new Error('WORKFLOW_NOT_FOUND');const json=JSON.stringify(content);const a:Artifact={id:randomUUID(),workflowId,artifactType:type,contentType:'application/json',contentJson:content,contentHash:createHash('sha256').update(json).digest('hex')};this.artifacts.set(a.id,a);this.appendEvent({workflowId,eventType:'ARTIFACT_CREATED',actorType:'orchestrator',actorId:'artifact-store',metadata:{artifactId:a.id,artifactType:type,contentHash:a.contentHash}});return a;}
  getArtifacts(id:string){return [...this.artifacts.values()].filter(x=>x.workflowId===id);}
  appendEvent(input:Omit<Event,'id'|'sequence'|'createdAt'>){if(!this.workflows.has(input.workflowId))throw new Error('WORKFLOW_NOT_FOUND');const list=this.events.get(input.workflowId)??[];const e={...input,id:randomUUID(),sequence:list.length+1,createdAt:new Date().toISOString()};list.push(e);this.events.set(input.workflowId,list);return e;}
  getEvents(id:string){return this.events.get(id)??[];}
  recordRoutingDecision(decision:RoutingDecision){if(!this.workflows.has(decision.workflowId))throw new Error('WORKFLOW_NOT_FOUND');if(decision.supersedesDecisionId){const previous=this.routingDecisions.get(decision.supersedesDecisionId);if(!previous)throw new Error('SUPERSEDED_ROUTING_DECISION_NOT_FOUND');if(previous.workflowId!==decision.workflowId)throw new Error('SUPERSEDED_ROUTING_WORKFLOW_MISMATCH');}this.routingDecisions.set(decision.id,decision);return Promise.resolve(decision);}
  recordRoutingCandidates(candidates:RoutingCandidate[]){for(const candidate of candidates){if(!this.routingDecisions.has(candidate.routingDecisionId))throw new Error('ROUTING_DECISION_NOT_FOUND');const list=this.routingCandidates.get(candidate.routingDecisionId)??[];list.push(candidate);this.routingCandidates.set(candidate.routingDecisionId,list);}return Promise.resolve(candidates);}
  async recordRoutingDecisionWithCandidates(decision:RoutingDecision,candidates:RoutingCandidate[]){await this.recordRoutingDecision(decision);await this.recordRoutingCandidates(candidates);return {decision,candidates};}
  getRoutingDecision(id:string){return Promise.resolve(this.routingDecisions.get(id));}
  getRoutingCandidates(decisionId:string){return Promise.resolve([...(this.routingCandidates.get(decisionId)??[])].sort((a,b)=>a.rank-b.rank));}
  getRoutingHistory(workflowId:string){return Promise.resolve([...this.routingDecisions.values()].filter(x=>x.workflowId===workflowId).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)));}
  async getLatestRoutingDecision(workflowId:string){const history=await this.getRoutingHistory(workflowId);const superseded=new Set(history.map(x=>x.supersedesDecisionId).filter((x):x is string=>!!x));return [...history].reverse().find(x=>!superseded.has(x.id));}
  async persistRoutingResolution(decision:RoutingDecision,candidates:RoutingCandidate[],clarificationQuestion?:string){
    const workflow=this.workflows.get(decision.workflowId);
    if(!workflow)throw new Error('WORKFLOW_NOT_FOUND');

    if(decision.routingConfidence==='AMBIGUOUS'){
      if(!clarificationQuestion?.trim())throw new Error('CLARIFICATION_QUESTION_REQUIRED');
      assertTransition(workflow.status,'AWAITING_CLARIFICATION');
    }else if(workflow.status==='CREATED'&&decision.routingConfidence!=='NO_MATCH'){
      if(!decision.selectedSpecialistId)throw new Error('ROUTING_SPECIALIST_REQUIRED');
      const {resolveRoutableSpecialist}=await import('./registry.js');
      if(!resolveRoutableSpecialist(decision.selectedSpecialistId))throw new Error('INVALID_ROUTING_TARGET');
    }

    await this.recordRoutingDecisionWithCandidates(decision,candidates);

    if(decision.routingConfidence==='AMBIGUOUS'){
      const question=clarificationQuestion!.trim();
      const clarification:RoutingClarification={
        id:randomUUID(),
        workflowId:workflow.id,
        routingDecisionId:decision.id,
        question,
        status:'PENDING',
        response:null,
        createdAt:new Date().toISOString(),
        answeredAt:null
      };
      this.routingClarifications.set(clarification.id,clarification);
      this.transitionWorkflow(workflow,'AWAITING_CLARIFICATION','system','routing-clarification',{clarificationId:clarification.id,routingDecisionId:decision.id});
      return {decision,candidates,clarification,workflow};
    }

    if(workflow.status==='CREATED'&&decision.routingConfidence!=='NO_MATCH'){
      if(!decision.selectedSpecialistId)throw new Error('ROUTING_SPECIALIST_REQUIRED');
      const {resolveRoutableSpecialist}=await import('./registry.js');
      const target=resolveRoutableSpecialist(decision.selectedSpecialistId);
      if(!target)throw new Error('INVALID_ROUTING_TARGET');
      workflow.logicalSpecialistId=target.specialistId;
      workflow.runtimeId=target.runtime?.runtimeId;
      this.transitionWorkflow(workflow,'ROUTED','system','router',{routingDecisionId:decision.id,routingConfidence:decision.routingConfidence});
    }

    return {decision,candidates,workflow};
  }
  createPendingClarification(input:Omit<RoutingClarification,'id'|'status'|'response'|'createdAt'|'answeredAt'>){
    const workflow=this.workflows.get(input.workflowId);if(!workflow)throw new Error('WORKFLOW_NOT_FOUND');
    const decision=this.routingDecisions.get(input.routingDecisionId);if(!decision||decision.workflowId!==input.workflowId)throw new Error('CLARIFICATION_WORKFLOW_MISMATCH');
    if(decision.routingConfidence!=='AMBIGUOUS')throw new Error('CLARIFICATION_REQUIRES_AMBIGUOUS_DECISION');
    assertTransition(workflow.status,'AWAITING_CLARIFICATION');
    const clarification:RoutingClarification={id:randomUUID(),...input,status:'PENDING',response:null,createdAt:new Date().toISOString(),answeredAt:null};
    this.routingClarifications.set(clarification.id,clarification);this.transitionWorkflow(workflow,'AWAITING_CLARIFICATION','system','routing-clarification',{clarificationId:clarification.id,routingDecisionId:decision.id});return Promise.resolve(clarification);
  }
  getClarification(id:string){return Promise.resolve(this.routingClarifications.get(id));}
  getPendingClarification(workflowId:string){return Promise.resolve([...this.routingClarifications.values()].find(x=>x.workflowId===workflowId&&x.status==='PENDING'));
  }
  getClarificationHistory(workflowId:string){return Promise.resolve([...this.routingClarifications.values()].filter(x=>x.workflowId===workflowId).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)));
  }
  recordClarificationResponse(id:string,response:string){const current=this.routingClarifications.get(id);if(!current)throw new Error('CLARIFICATION_NOT_FOUND');if(current.status!=='PENDING')throw new Error('CLARIFICATION_ALREADY_ANSWERED');if(!response.trim())throw new Error('INVALID_CLARIFICATION_RESPONSE');const updated={...current,status:'ANSWERED' as const,response:response.trim(),answeredAt:new Date().toISOString()};this.routingClarifications.set(id,updated);return Promise.resolve(updated);}
  async resumeClarification(workflowId:string,clarificationId:string,decision:RoutingDecision,candidates:RoutingCandidate[]){const clarification=await this.getClarification(clarificationId);if(!clarification||clarification.workflowId!==workflowId)throw new Error('CLARIFICATION_NOT_FOUND');if(clarification.status!=='ANSWERED')throw new Error('CLARIFICATION_RESPONSE_REQUIRED');const workflow=this.workflows.get(workflowId);if(!workflow)throw new Error('WORKFLOW_NOT_FOUND');if(workflow.status!=='AWAITING_CLARIFICATION')throw new Error('CLARIFICATION_WORKFLOW_STATE_MISMATCH');const existing=[...this.routingDecisions.values()].find(x=>x.supersedesDecisionId===clarification.routingDecisionId);if(existing)return {clarification,decision:existing,candidates:await this.getRoutingCandidates(existing.id),workflow};if(decision.workflowId!==workflowId||decision.decisionType!=='POST_CLARIFICATION'||decision.supersedesDecisionId!==clarification.routingDecisionId)throw new Error('INVALID_POST_CLARIFICATION_DECISION');const {resolveRoutableSpecialist}=await import('./registry.js');if(!decision.selectedSpecialistId||!resolveRoutableSpecialist(decision.selectedSpecialistId)||candidates.some(candidate=>!resolveRoutableSpecialist(candidate.specialistId)))throw new Error('INVALID_ROUTING_TARGET');await this.recordRoutingDecisionWithCandidates(decision,candidates);const target=resolveRoutableSpecialist(decision.selectedSpecialistId);if(!target)throw new Error('INVALID_ROUTING_TARGET');workflow.logicalSpecialistId=decision.selectedSpecialistId;workflow.runtimeId=target.runtime?.runtimeId;const updated=this.transitionWorkflow(workflow,'ROUTED','system','routing-resume',{clarificationId,decisionId:decision.id});return {clarification,decision,candidates,workflow:updated};}
  async applyUserOverride(workflowId:string,targetSpecialistId:string,reason='',actorId='user',expectedDecisionId?:string){const target=(await import('./registry.js')).resolveRoutableSpecialist(targetSpecialistId);if(!target)throw new Error('INVALID_OVERRIDE_TARGET');if(reason.length>1000)throw new Error('INVALID_OVERRIDE_REASON');const workflow=this.workflows.get(workflowId);if(!workflow)throw new Error('WORKFLOW_NOT_FOUND');if(!['ROUTED','AWAITING_CLARIFICATION','AWAITING_APPROVAL'].includes(workflow.status))throw new Error('OVERRIDE_STATE_UNSAFE');if(workflow.status==='AWAITING_CLARIFICATION'&&!await this.getPendingClarification(workflowId))throw new Error('CLARIFICATION_NOT_FOUND');const previous=await this.getLatestRoutingDecision(workflowId);if(!previous)throw new Error('ROUTING_DECISION_NOT_FOUND');if(expectedDecisionId&&expectedDecisionId!==previous.id)throw new Error('STALE_ROUTING_DECISION');if(previous.selectedSpecialistId===target.specialistId)return {workflow,decision:previous,previousDecision:previous,candidates:await this.getRoutingCandidates(previous.id)};const decision:RoutingDecision={id:randomUUID(),workflowId,selectedSpecialistId:target.specialistId,routingConfidence:'PROBABLE',routingReason:`User override selected ${target.displayName} for the current task.${reason.trim()?` User reason: ${reason.trim()}`:''}`,decisionType:'USER_OVERRIDE',supersedesDecisionId:previous.id,createdAt:new Date().toISOString()};const prior=await this.getRoutingCandidates(previous.id);const candidates=prior.map(x=>({...x,id:randomUUID(),routingDecisionId:decision.id}));await this.recordRoutingDecisionWithCandidates(decision,candidates);if(workflow.status==='AWAITING_CLARIFICATION'){const pending=await this.getPendingClarification(workflowId);if(pending)this.routingClarifications.set(pending.id,{...pending,status:'SUPERSEDED'});}workflow.logicalSpecialistId=target.specialistId;workflow.runtimeId=target.runtime?.runtimeId;if(workflow.status==='AWAITING_CLARIFICATION')this.transitionWorkflow(workflow,'ROUTED','system','routing-override',{previousDecisionId:previous.id,decisionId:decision.id,clarificationResolution:'SUPERSEDED'});this.appendEvent({workflowId,eventType:'ROUTING_OVERRIDDEN',actorType:'principal',actorId,metadata:{previousDecisionId:previous.id,previousSpecialistId:previous.selectedSpecialistId,overrideDecisionId:decision.id,targetSpecialistId:target.specialistId,reason:reason.trim()||undefined}});return {workflow,decision,previousDecision:previous,candidates};}
  getRequestIdempotency(callerId:string,operation:string,key:string){return this.idem.get(`${callerId}:${operation}:${key}`);}
  reconstructWorkflow(id:string){return {workflow:this.getWorkflow(id),stages:this.getStages(id),attempts:this.getAttempts(id),artifacts:this.getArtifacts(id),events:this.getEvents(id)};}
}
export function hash(value:unknown){return createHash('sha256').update(JSON.stringify(value,(k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.keys(v).sort().reduce((o,x)=>(o[x]=v[x],o),{} as any):v)).digest('hex');}
