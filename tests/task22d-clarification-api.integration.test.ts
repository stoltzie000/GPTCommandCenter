// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { PgStore } from '../src/pg-store.js';

const url=process.env.PG_TEST_URL;
const id=()=>randomUUID();
const input=(requestId=id())=>({requestId,workflowType:'software' as const,logicalSpecialistId:'architecture-security-advisor',runtimeId:'runtime',validationRequired:true,effectiveClassification:'PUBLIC' as const,objective:'task22d api',context:{},requiresImplementation:true});

test('Task 22D clarification API retrieves and submits durable clarification', {skip:!url}, async()=>{
  const store=new PgStore(url);const workflow=await store.createWorkflow(input(),'task22d-api','create');
  const original={id:id(),workflowId:workflow.id,selectedSpecialistId:null,routingConfidence:'AMBIGUOUS' as const,routingReason:'ambiguous API route',decisionType:'INITIAL' as const,supersedesDecisionId:null,createdAt:new Date().toISOString()};
  await store.recordRoutingDecision(original);const clarification=await store.createPendingClarification({workflowId:workflow.id,routingDecisionId:original.id,question:'Which target should be used?'});await store.pool.end();
  const port=18081;const child=spawn(process.execPath,['dist/src/server.js'],{env:{...process.env,APP_MODE:'deployed',AUTH_MODE:'token',DATABASE_URL:url,PGPASSWORD:process.env.PGPASSWORD,ORCHESTRATOR_API_TOKEN:'test-only-token',AUTH_PRINCIPALS:JSON.stringify({'test-only-token':{id:'test-caller',roles:[],scopes:[]}}),PORT:String(port)},stdio:['ignore','pipe','pipe']});
  try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('SERVER_START_TIMEOUT')),5000);child.stdout.on('data',chunk=>{if(String(chunk).includes('server_started')){clearTimeout(timer);resolve();}});child.on('error',reject);});const headers={authorization:'Bearer test-only-token'};const get=await fetch(`http://127.0.0.1:${port}/v1/workflows/${workflow.id}/clarification`,{headers});assert.equal(get.status,200);assert.equal((await get.json()).id,clarification.id);const post=await fetch(`http://127.0.0.1:${port}/v1/workflows/${workflow.id}/clarification-response`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({clarificationId:clarification.id,response:'Use production',routing:{routingConfidence:'PROBABLE',selectedSpecialistId:'architecture-security-advisor',routingReason:'clarified target'},candidates:[{specialistId:'architecture-security-advisor',rank:1,matchReason:'clarified'}]})});assert.equal(post.status,200);const result=await post.json();assert.equal(result.decision.decisionType,'POST_CLARIFICATION');assert.equal(result.workflow.status,'ROUTED');}finally{child.kill('SIGTERM');}
});
