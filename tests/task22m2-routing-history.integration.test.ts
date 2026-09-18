// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { PgStore } from '../src/pg-store.js';

const url = process.env.PG_TEST_URL;
const id = () => randomUUID();
const input = (requestId = id()) => ({requestId,workflowType:'non_code',logicalSpecialistId:'previous-specialist',runtimeId:'previous-runtime',validationRequired:false,effectiveClassification:'PUBLIC',objective:'routing history api',context:{principal:{id:'operator',roles:[],scopes:[],authType:'token'}},requiresImplementation:false});
const initial = workflowId => ({id:id(),workflowId,selectedSpecialistId:'previous-specialist',routingConfidence:'CLEAR',routingReason:'persisted internal route',decisionType:'INITIAL',supersedesDecisionId:null,createdAt:'2026-09-15T00:00:00.000Z'});
const start = (port) => { const child=spawn(process.execPath,['dist/src/server.js'],{env:{...process.env,APP_MODE:'deployed',AUTH_MODE:'token',DATABASE_URL:url,ORCHESTRATOR_API_TOKEN:'test-only-token',AUTH_PRINCIPALS:JSON.stringify({'test-only-token':{id:'operator',roles:[],scopes:[]}}),PORT:String(port)},stdio:['ignore','pipe','pipe']}); return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('SERVER_START_TIMEOUT')),5000);child.stdout.on('data',chunk=>{if(String(chunk).includes('server_started')){clearTimeout(timer);resolve(child);}});child.on('error',reject);}); };
const stop = child => new Promise(resolve => {child.once('exit',resolve);child.kill('SIGTERM');});
const get = (port, path) => fetch(`http://127.0.0.1:${port}${path}`,{headers:{authorization:'Bearer test-only-token'}});

test('22M2-09 PostgreSQL restart-safe routing history endpoint', {skip:!url}, async () => {
  const first = new PgStore(url); const workflow = await first.createWorkflow(input(),'22m2','create'); const original = initial(workflow.id);
  await first.recordRoutingDecisionWithCandidates(original,[{id:id(),routingDecisionId:original.id,specialistId:'previous-specialist',rank:1,matchReason:'persisted candidate'}]);
  const override = await first.applyUserOverride(workflow.id,'architecture-security-advisor','approved workflow override','operator',original.id);
  await first.pool.end();
  const expected = [original.id,override.decision.id];
  const firstServer = await start(18120);
  try {
    const response = await get(18120,`/v1/workflows/${workflow.id}/routing-decisions`); assert.equal(response.status,200);
    const history = await response.json(); assert.deepEqual(history.map(x=>x.id),expected); assert.equal(history[0].current,false); assert.equal(history[1].current,true);
    assert.equal(history[1].supersedesDecisionId,original.id); assert.equal(history[1].decisionType,'USER_OVERRIDE');
  } finally { await stop(firstServer); }
  const freshServer = await start(18121);
  try {
    const response = await get(18121,`/v1/workflows/${workflow.id}/routing-decisions`); assert.equal(response.status,200); const history = await response.json();
    assert.deepEqual(history.map(x=>x.id),expected); assert.equal(history[1].selectedSpecialistId,'architecture-security-advisor');
    const workflowResponse = await get(18121,`/v1/workflows/${workflow.id}`); assert.equal(workflowResponse.status,200); const readModel = await workflowResponse.json();
    assert.equal(readModel.selectedSpecialistId,history.find(x=>x.current).selectedSpecialistId); assert.equal(readModel.execution.started,false); assert.equal(readModel.execution.completed,false);
    const unknown = await get(18121,`/v1/workflows/${id()}/routing-decisions`); assert.equal(unknown.status,404);
  } finally { await stop(freshServer); }
});
