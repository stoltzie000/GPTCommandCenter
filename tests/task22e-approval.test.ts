import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store.js';

test('AWAITING_APPROVAL blocks orchestration-level execution',()=>{const store=new MemoryStore();const workflow=store.createWorkflow({requestId:'task22e-guard',workflowType:'software',logicalSpecialistId:'architecture-security-advisor',runtimeId:'runtime',validationRequired:true,effectiveClassification:'PUBLIC',objective:'approval',context:{},requiresImplementation:true});store.transitionWorkflow(workflow,'AWAITING_APPROVAL','test','approval');assert.throws(()=>store.claimStage(workflow.id,'protected-action','specialist','runtime','worker'),/APPROVAL_REQUIRED/);assert.equal(store.getAttempts(workflow.id).length,0);});
