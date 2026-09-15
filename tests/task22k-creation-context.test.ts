import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertAuthorizedCreation,
  freezeCreationContext
} from '../src/trust.js';

const principal={
  id:'creator',
  roles:[] as readonly string[],
  scopes:[] as readonly string[],
  authType:'local' as const,
  maxClassification:'RESTRICTED' as const
};

const repo={
  repositoryId:'repo',
  source:'./repo',
  classification:'PUBLIC' as const,
  allowedCallers:['creator'],
  allowedSpecialists:['architecture-security-advisor'],
  allowedExecutionTypes:['codex']
};

test('Task 22K creation context authorizes repository trust without specialist authority',()=>{
  const context=freezeCreationContext({
    principal,
    operation:'create',
    requestId:'task22k-create-context',
    executionType:'codex',
    effectiveClassification:'PUBLIC'
  },repo);

  assert.equal('specialistId' in context,false);
  assert.doesNotThrow(()=>assertAuthorizedCreation(context));
});

test('Task 22K creation context still enforces caller and execution policy',()=>{
  assert.throws(()=>freezeCreationContext({
    principal:{...principal,id:'denied'},
    operation:'create',
    requestId:'task22k-denied-caller',
    executionType:'codex',
    effectiveClassification:'PUBLIC'
  },repo),/AUTHORIZATION_FAILED/);

  assert.throws(()=>freezeCreationContext({
    principal,
    operation:'create',
    requestId:'task22k-denied-execution',
    executionType:'specialist',
    effectiveClassification:'PUBLIC'
  },repo),/AUTHORIZATION_FAILED/);
});

test('Task 22K creation context rejects injected specialist authority',()=>{
  const forged={
    principal,
    operation:'create',
    requestId:'task22k-forged-specialist',
    specialistId:'architecture-security-advisor',
    executionType:'codex',
    effectiveClassification:'PUBLIC',
    resolvedRepository:repo,
    authorizationDecision:{
      allowed:true as const,
      ruleId:'forged',
      decidedAt:new Date().toISOString()
    }
  };

  assert.throws(()=>assertAuthorizedCreation(forged),/AUTHORIZATION_FAILED/);
});
