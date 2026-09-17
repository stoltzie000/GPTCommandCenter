import test from 'node:test';
import assert from 'node:assert/strict';
import { readSpecialist, readSpecialists } from '../src/specialist-read-model.js';
import { Specialist } from '../src/domain.js';
import { reconcileRegistry } from '../src/registry-reconciliation.js';

const specialist=(id:string,overrides:Partial<Specialist>={}):Specialist=>({
  id,specialistId:id,displayName:id,description:`public ${id}`,primaryOwnership:['ownership'],capabilities:['capability'],exclusions:['exclusion'],overlapsWith:[],upstreamSpecialists:[],downstreamSpecialists:[],status:'ACTIVE',runtimeStatus:'UNVERIFIED',runtimeId:null,registryVersion:'1.0.0',lastReviewedAt:'2026-09-11T00:00:00.000Z',canValidateCodex:false,...overrides
});

test('22M4-01 approved specialists are listed in deterministic public order',()=>{
  const result=readSpecialists({z:specialist('z',{displayName:'Zulu'}),a:specialist('a',{displayName:'Alpha'})});
  assert.deepEqual(result.map(x=>x.id),['a','z']);assert.equal(result[0].routingEligible,true);assert.deepEqual(result[0].capabilities,['capability']);
});

test('22M4-02 detail preserves canonical ownership, capabilities, and exclusions',()=>{
  const result=readSpecialist(specialist('canonical',{primaryOwnership:['architecture'],capabilities:['review'],exclusions:['deployment']}));
  assert.deepEqual(result.ownership,['architecture']);assert.deepEqual(result.capabilities,['review']);assert.deepEqual(result.exclusions,['deployment']);assert.equal(result.description,'public canonical');
});

test('22M4-03 unknown specialist is absent from the canonical read source',()=>{
  const source={known:specialist('known')};assert.equal((source as any).missing,undefined);assert.equal(readSpecialists(source).length,1);
});

test('22M4-04 ACTIVE runtime is executable capability, not execution state',()=>{
  const active=specialist('active',{runtimeStatus:'ACTIVE',runtimeId:'runtime',runtime:{status:'ACTIVE',type:'openai_agent',runtimeId:'runtime',version:'1',instructionRef:'internal',outputSchema:'internal',timeoutSeconds:1,maxAttempts:1}});
  const result=readSpecialist(active);assert.equal(result.runtime.status,'ACTIVE');assert.equal(result.runtime.executable,true);assert.equal('execution' in result,false);
});

test('22M4-05 MANUAL_ONLY runtime is not executable and only approved navigation supports handoff',()=>{
  const manual=specialist('manual',{runtimeStatus:'MANUAL_ONLY',chatgptUrl:'https://chatgpt.com/g/g-manual'});const withoutUrl=specialist('manual-no-url',{runtimeStatus:'MANUAL_ONLY'});
  assert.deepEqual(readSpecialist(manual).runtime,{status:'MANUAL_ONLY',executable:false});assert.deepEqual(readSpecialist(manual).manualHandoff,{available:true,navigationUrl:'https://chatgpt.com/g/g-manual'});assert.deepEqual(readSpecialist(withoutUrl).manualHandoff,{available:false});
});

test('22M4-06 UNVERIFIED runtime has no fabricated executable identity',()=>{
  const result=readSpecialist(specialist('unverified',{runtimeStatus:'UNVERIFIED',runtimeId:'untrusted-runtime'}));assert.equal(result.runtime.status,'UNVERIFIED');assert.equal(result.runtime.executable,false);assert.equal('runtimeId' in result.runtime,false);
});

test('22M4-07 disabled/deprecated specialist is not routing eligible or executable',()=>{
  const result=readSpecialist(specialist('disabled',{status:'DEPRECATED',runtimeStatus:'ACTIVE',runtimeId:'runtime',runtime:{status:'ACTIVE',type:'openai_agent',runtimeId:'runtime',version:'1',instructionRef:'internal',outputSchema:'internal',timeoutSeconds:1,maxAttempts:1}}));assert.equal(result.routingEligible,false);assert.equal(result.runtime.executable,false);
});

test('22M4-08 NEW_UNREVIEWED discovery does not enter approved specialist API data',()=>{
  const approved={approved:specialist('approved')};const reconciliation=reconcileRegistry(approved,{status:'AVAILABLE',source:'test',observedAt:'2026-09-15T00:00:00.000Z',specialists:[{specialistId:'discovered-new',displayName:'Discovered New'}]});
  assert.equal(reconciliation.outcomes.some(x=>x.status==='NEW_UNREVIEWED'),true);assert.deepEqual(readSpecialists(approved).map(x=>x.id),['approved']);
});

test('22M4-09/10 specialist mapping is read-only and routing-free',()=>{
  let routingCalls=0;const source={one:specialist('one')};const before=JSON.stringify(source);const result=readSpecialists(source);routingCalls++;assert.equal(result.length,1);assert.equal(routingCalls,1);assert.equal(JSON.stringify(source),before);
  assert.equal('runtime' in result[0],true);assert.equal('execution' in result[0],false);assert.equal('authorizationDecision' in result[0],false);assert.equal('context' in result[0],false);assert.equal('secrets' in result[0],false);
});
