import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store.js';
import { Orchestrator } from '../src/orchestrator.js';
import {
  UnavailableSpecialist,
  SafePromptBuilder,
  UnavailableCodex,
  UnavailableValidation
} from '../src/executors.js';
import { freezeCreationContext, contextFromWorkflow } from '../src/trust.js';

test('unavailable execution never fabricates completion',async()=>{
  const o=new Orchestrator(
    new MemoryStore(),
    new UnavailableSpecialist(),
    new SafePromptBuilder(),
    new UnavailableCodex(),
    new UnavailableValidation()
  );

  const repo={
    repositoryId:'repo',
    source:'./repo',
    classification:'PUBLIC' as const
  };

  const createContext=freezeCreationContext({
    principal:{
      id:'local',
      roles:[],
      scopes:[],
      authType:'local' as const
    },
    operation:'create',
    requestId:'00000000-0000-0000-0000-000000000001',
    executionType:'codex',
    effectiveClassification:'PUBLIC'
  },repo);

  const w=await o.create({
    context:createContext,
    workflowInput:{
      request_id:createContext.requestId,
      workflow_type:'software',
      requested_specialist:'architecture-security-advisor',
      objective:'x'
    }
  });

  const runContext=contextFromWorkflow(
    w,
    'run',
    'specialist',
    createContext.principal
  );

  await o.run(w.id,runContext);

  assert.ok(['FAILED','MANUAL_HANDOFF_REQUIRED'].includes(w.status));
  assert.equal(
    (await o.store.getEvents(w.id)).some(e=>e.eventType.includes('SPECIALIST_COMPLETE')),
    false
  );
  assert.equal(
    (await o.store.getEvents(w.id)).some(e=>e.eventType.includes('CODEX_COMPLETE')),
    false
  );
});
