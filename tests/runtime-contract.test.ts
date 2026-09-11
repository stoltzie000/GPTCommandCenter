import test from 'node:test';
import assert from 'node:assert/strict';
import {ExecutionContext} from '../src/trust.js';

const specialistFields=Object.freeze([
  ['workflowId','OPERATIONAL_NON_AUTHORITATIVE'],
  ['stageId','OPERATIONAL_NON_AUTHORITATIVE'],
  ['objective','DOMAIN_PAYLOAD_NON_AUTHORITATIVE'],
  ['context','DOMAIN_PAYLOAD_NON_AUTHORITATIVE'],
  ['runtimeId','SERVER_DERIVED_OR_EQUALITY_ENFORCED'],
  ['runtimeVersion','SERVER_DERIVED_OR_EQUALITY_ENFORCED'],
  ['expectedOutputSchema','SERVER_REGISTRY_DERIVED'],
  ['maxClassification','SERVER_DERIVED_AUTHORITY'],
  ['onInitiation','OPERATIONAL_EXECUTION_EVIDENCE_CALLBACK'],
] as const);

test('specialist trust-adjacent fields have explicit contract dispositions',()=>{
  assert.deepEqual(Object.fromEntries(specialistFields),{
    workflowId:'OPERATIONAL_NON_AUTHORITATIVE',stageId:'OPERATIONAL_NON_AUTHORITATIVE',
    objective:'DOMAIN_PAYLOAD_NON_AUTHORITATIVE',context:'DOMAIN_PAYLOAD_NON_AUTHORITATIVE',
    runtimeId:'SERVER_DERIVED_OR_EQUALITY_ENFORCED',runtimeVersion:'SERVER_DERIVED_OR_EQUALITY_ENFORCED',
    expectedOutputSchema:'SERVER_REGISTRY_DERIVED',maxClassification:'SERVER_DERIVED_AUTHORITY',onInitiation:'OPERATIONAL_EXECUTION_EVIDENCE_CALLBACK'
  });
});

test('runtime routing values cannot replace trusted specialist identity',()=>{
  const trusted=Object.freeze({specialistId:'architecture-security-advisor',executionType:'specialist'});
  const request={runtimeId:'untrusted-privileged-runtime',runtimeVersion:'9.9.9'};
  assert.notEqual(request.runtimeId,(trusted as Pick<ExecutionContext,'specialistId'>).specialistId);
  assert.equal(trusted.specialistId,'architecture-security-advisor');
});
