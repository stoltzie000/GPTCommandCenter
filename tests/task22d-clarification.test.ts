import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store.js';

test('unresolved clarification blocks specialist claims in the memory test adapter',()=>{const store=new MemoryStore();const workflow=store.createWorkflow({requestId:'task22d-guard',workflowType:'software',logicalSpecialistId:'architecture-security-advisor',runtimeId:'runtime',validationRequired:true,effectiveClassification:'PUBLIC',objective:'clarify',context:{},requiresImplementation:true});store.transitionWorkflow(workflow,'AWAITING_CLARIFICATION','test','clarification');assert.throws(()=>store.claimStage(workflow.id,'specialist:architecture-security-advisor','specialist','runtime','worker'),/CLARIFICATION_REQUIRED/);assert.equal(store.getAttempts(workflow.id).length,0);});
