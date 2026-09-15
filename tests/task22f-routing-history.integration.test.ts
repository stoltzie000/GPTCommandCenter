// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PgStore } from '../src/pg-store.js';
import { DeterministicRequestInterpreter, selectCandidates } from '../src/routing.js';

const url=process.env.PG_TEST_URL;
const id=()=>randomUUID();

test('Task 22F persists deterministic generated candidates through Task 22C history', {skip:!url}, async()=>{
  const s=new PgStore(url);
  const w=await s.createWorkflow({requestId:id(),workflowType:'non_code',logicalSpecialistId:'architecture-security-advisor',runtimeId:'runtime',validationRequired:false,effectiveClassification:'PUBLIC',objective:'candidate persistence',context:{},requiresImplementation:false},'task22f','create');
  try{
    const interpretation=new DeterministicRequestInterpreter().interpretRequest({request:'Review the architecture and security of this repository'});
    const candidates=selectCandidates(interpretation,{owner:{id:'owner',specialistId:'owner',displayName:'owner',description:'owner',primaryOwnership:['architecture'],capabilities:['security analysis'],exclusions:[],overlapsWith:[],upstreamSpecialists:[],downstreamSpecialists:[],status:'ACTIVE',runtimeStatus:'MANUAL_ONLY',runtimeId:null,registryVersion:'2.0.0',lastReviewedAt:'2026-09-11T00:00:00.000Z',canValidateCodex:false},other:{id:'other',specialistId:'other',displayName:'other',description:'other',primaryOwnership:[],capabilities:['security analysis'],exclusions:[],overlapsWith:[],upstreamSpecialists:[],downstreamSpecialists:[],status:'ACTIVE',runtimeStatus:'UNVERIFIED',runtimeId:null,registryVersion:'2.0.0',lastReviewedAt:'2026-09-11T00:00:00.000Z',canValidateCodex:false}});
    const d={id:id(),workflowId:w.id,selectedSpecialistId:null,routingConfidence:'AMBIGUOUS',routingReason:'candidate evidence only',decisionType:'INITIAL',supersedesDecisionId:null,createdAt:new Date().toISOString()};
    await s.recordRoutingDecisionWithCandidates(d,candidates.map(x=>({id:id(),routingDecisionId:d.id,specialistId:x.specialistId,rank:x.rank,matchReason:x.matchReason})));
    await s.pool.end();
    const fresh=new PgStore(url);
    try{const rows=await fresh.getRoutingCandidates(d.id);assert.deepEqual(rows.map(x=>x.specialistId),candidates.map(x=>x.specialistId));assert.deepEqual(rows.map(x=>x.rank),[1,2]);assert.ok(rows.every(x=>x.matchReason.length<200));}finally{await fresh.pool.end();}
  }catch(error){await s.pool.end().catch(()=>{});throw error;}
});
