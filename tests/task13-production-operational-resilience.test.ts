import test from 'node:test';
import assert from 'node:assert/strict';
import {loadConfig} from '../src/config.js';
import {PgStore} from '../src/pg-store.js';

test('production configuration rejects malformed trusted policy data',()=>{
  assert.throws(()=>loadConfig({APP_MODE:'deployed',AUTH_MODE:'token',ORCHESTRATOR_API_TOKEN:'token',DATABASE_URL:'postgres://db',AUTH_PRINCIPALS:JSON.stringify({token:{id:'operator',roles:[],scopes:[]}}),ALLOWED_REPOSITORIES:JSON.stringify({repo:{source:'./repo',classification:'PUBLIC',allowedRefs:['main'],allowedRefPatterns:['[']}})} as any),/INVALID_CONFIGURATION/);
  assert.throws(()=>loadConfig({APP_MODE:'deployed',AUTH_MODE:'token',ORCHESTRATOR_API_TOKEN:'token',DATABASE_URL:'postgres://db',AUTH_PRINCIPALS:JSON.stringify({token:{id:'operator',roles:'operator',scopes:[]}}),ALLOWED_REPOSITORIES:'{}'} as any),/INVALID_CONFIGURATION/);
});

test('token mode requires an explicit principal mapping',()=>{
  assert.throws(()=>loadConfig({APP_MODE:'local',AUTH_MODE:'token',ORCHESTRATOR_API_TOKEN:'token',ALLOWED_REPOSITORIES:'{}',AUTH_PRINCIPALS:'{}'} as any),/AUTHENTICATION_REQUIRED/);
  assert.throws(()=>loadConfig({APP_MODE:'local',AUTH_MODE:'token',ORCHESTRATOR_API_TOKEN:'token',ALLOWED_REPOSITORIES:'{}',AUTH_PRINCIPALS:JSON.stringify({other:{id:'operator',roles:[],scopes:[]}})} as any),/AUTHENTICATION_REQUIRED/);
});

test('application mode must be explicit so deployment cannot silently select MemoryStore',()=>{
  assert.throws(()=>loadConfig({AUTH_MODE:'disabled',ALLOWED_REPOSITORIES:'{}'} as any),/INVALID_CONFIGURATION/);
});

test('PostgreSQL startup schema verification fails closed when required tables are missing',async()=>{
  const store=new PgStore('postgres://unused');
  (store as any).pool={query:async()=>({rows:[{table_name:'workflows'}]})};
  await assert.rejects(()=>store.verifySchema(),/DATABASE_SCHEMA_NOT_READY/);
});

test('PostgreSQL startup schema verification accepts the complete required table set',async()=>{
  const required=['workflows','workflow_events','workflow_stages','workflow_attempts','artifacts','request_idempotency','routing_decisions','routing_candidates','routing_clarifications','workflow_approvals'];
  const store=new PgStore('postgres://unused');
  (store as any).pool={query:async()=>({rows:required.map(table_name=>({table_name}))})};
  await store.verifySchema();
});
