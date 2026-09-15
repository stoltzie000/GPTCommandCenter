// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRouting } from '../src/routing.js';

const c=(id,ownership=[],specificity=0)=>({specialistId:id,rank:1,matchReason:'evidence',evidence:{specialistId:id,registryVersion:'1.0.0',ownershipMatches:ownership,capabilityMatches:[],workflowRelationship:'none',exclusionResult:'eligible',specificity,runtimeStatus:'MANUAL_ONLY',matchReason:'evidence'}});

test('Task 22G classifies CLEAR, PROBABLE, AMBIGUOUS, and NO_MATCH deterministically',()=>{assert.equal(resolveRouting([c('owner',['repo'],2),c('generic',[],1)]).routingConfidence,'CLEAR');const probable=resolveRouting([c('python',['python'],4),c('arch',['architecture'],2)]);assert.equal(probable.routingConfidence,'PROBABLE');assert.equal(probable.selectedSpecialistId,'python');assert.equal(resolveRouting([c('a',['repo'],2),c('b',['repo'],2)]).routingConfidence,'AMBIGUOUS');const none=resolveRouting([]);assert.equal(none.routingConfidence,'NO_MATCH');assert.equal(none.selectedSpecialistId,null);});
test('Task 22G preserves candidates and does not use runtime status for confidence',()=>{const candidates=[c('manual',['repo'],3),c('active',['repo'],3)];candidates[1].evidence.runtimeStatus='ACTIVE';const result=resolveRouting(candidates);assert.equal(result.routingConfidence,'AMBIGUOUS');assert.equal(result.candidates.length,2);assert.equal(result.requiresClarification,true);assert.match(result.clarificationQuestion,/manual.*active/);});
