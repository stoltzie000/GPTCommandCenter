import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MemoryStore } from '../src/store.js';
import { persistResolvedRouting } from '../src/routing.js';
import { readWorkflow } from '../src/workflow-read-model.js';
import { registry } from '../src/registry.js';

const candidate=(id:string,rank=1)=>({specialistId:id,rank,matchReason:'test evidence',evidence:{specialistId:id,registryVersion:'1.0.0',ownershipMatches:['architecture'],capabilityMatches:[],workflowRelationship:'none' as const,exclusionResult:'eligible' as const,specificity:2,runtimeStatus:'UNVERIFIED' as const,matchReason:'test evidence'}});
const workflow=(store:MemoryStore,logicalSpecialistId:string|null=null)=>store.createWorkflow({requestId:randomUUID(),workflowType:'non_code',logicalSpecialistId,runtimeId:undefined,validationRequired:false,effectiveClassification:'PUBLIC',objective:'architecture review',context:{},requiresImplementation:false});

test('22M1-01/03 persisted routed read model is truthful and not running',async()=>{const store=new MemoryStore();const w=workflow(store);await persistResolvedRouting(store,w.id,{routingConfidence:'CLEAR',selectedSpecialistId:'architecture-security-advisor',routingReason:'clear ownership',candidates:[candidate('architecture-security-advisor')],requiresClarification:false});const model=await readWorkflow(store,w);assert.equal(model.id,w.id);assert.equal(model.status,'ROUTED');assert.equal(model.selectedSpecialistId,'architecture-security-advisor');assert.equal(model.execution.started,false);assert.equal(model.execution.completed,false);assert.equal(model.runtime.executable,false);assert.equal(model.runtime.status,'UNVERIFIED');});

test('22M1-04 manual runtime is not reported executable',async()=>{const old=registry['architecture-security-advisor'].runtimeStatus;registry['architecture-security-advisor'].runtimeStatus='MANUAL_ONLY';try{const store=new MemoryStore();const w=workflow(store);await persistResolvedRouting(store,w.id,{routingConfidence:'CLEAR',selectedSpecialistId:'architecture-security-advisor',routingReason:'manual route',candidates:[candidate('architecture-security-advisor')],requiresClarification:false});const model=await readWorkflow(store,w);assert.equal(model.runtime.status,'MANUAL_ONLY');assert.equal(model.runtime.executable,false);assert.equal(model.execution.started,false);}finally{registry['architecture-security-advisor'].runtimeStatus=old;}});

test('22M1-05 clarification state is persisted without execution implication',async()=>{const store=new MemoryStore();const w=workflow(store);await persistResolvedRouting(store,w.id,{routingConfidence:'AMBIGUOUS',selectedSpecialistId:null,routingReason:'ambiguous ownership',candidates:[candidate('architecture-security-advisor'),candidate('policy-document-reviewer',2)],requiresClarification:true,clarificationQuestion:'Which specialist owns this?'});const model=await readWorkflow(store,w);assert.equal(model.status,'AWAITING_CLARIFICATION');assert.equal(model.clarificationRequired,true);assert.equal(model.selectedSpecialistId,null);assert.equal(model.execution.started,false);});

test('22M1-06 unknown workflow has no read model',async()=>{const store=new MemoryStore();assert.equal(await store.getWorkflow(randomUUID()),undefined);});

test('22M1-08 latest routing decision wins over a stale workflow projection',async()=>{const store=new MemoryStore();const w=workflow(store,'architecture-security-advisor');const decision={id:randomUUID(),workflowId:w.id,selectedSpecialistId:null,routingConfidence:'NO_MATCH' as const,routingReason:'no current owner',decisionType:'FALLBACK' as const,supersedesDecisionId:null,createdAt:new Date().toISOString()};await store.recordRoutingDecision(decision);const model=await readWorkflow(store,w);assert.equal(model.selectedSpecialistId,null);assert.equal(model.routingConfidence,'NO_MATCH');});

test('GET read mapping is side-effect free',async()=>{const store=new MemoryStore();const w=workflow(store);const beforeEvents=(await store.getEvents(w.id)).length;const beforeAttempts=(await store.getAttempts(w.id)).length;await readWorkflow(store,w);assert.equal((await store.getEvents(w.id)).length,beforeEvents);assert.equal((await store.getAttempts(w.id)).length,beforeAttempts);});
