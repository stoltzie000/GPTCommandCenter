// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const url=process.env.PG_TEST_URL;
const repository=JSON.stringify({repo:{source:'./repo',classification:'PUBLIC',allowedCallers:['task22m1-user'],allowedSpecialists:['architecture-security-advisor'],allowedExecutionTypes:['specialist'],allowedRefs:['main']}});
const principals=JSON.stringify({'task22m1-token':{id:'task22m1-user',roles:['developer'],scopes:['workflow:create','workflow:run']}});
const headers={authorization:'Bearer task22m1-token','content-type':'application/json'};
const env=(port:number)=>({...process.env,APP_MODE:'deployed',AUTH_MODE:'token',DATABASE_URL:url,PGPASSWORD:process.env.PGPASSWORD,ORCHESTRATOR_API_TOKEN:'task22m1-token',AUTH_PRINCIPALS:principals,ALLOWED_REPOSITORIES:repository,SPECIALIST_INVENTORY_PROVIDER:'none',PORT:String(port)});
async function start(port:number){const child=spawn(process.execPath,['dist/src/server.js'],{env:env(port),stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('SERVER_START_TIMEOUT')),5000);child.stdout.on('data',chunk=>{if(String(chunk).includes('server_started')){clearTimeout(timer);resolve(null);}});child.on('error',reject);});return child;}

test('22M1-01/02/03/04 POST and GET return a truthful persisted workflow model', {skip:!url}, async()=>{
  const requestId=randomUUID();const first=await start(18110);let workflowId:string;
  try{const post=await fetch('http://127.0.0.1:18110/v1/workflows',{method:'POST',headers,body:JSON.stringify({request_id:requestId,workflow_type:'non_code',objective:'architecture security review',repository:'repo'})});const postText=await post.text();assert.equal(post.status,201,postText);const created=JSON.parse(postText);workflowId=created.id;assert.equal(created.status,'ROUTED');assert.equal(created.routingConfidence,'CLEAR');assert.equal(created.selectedSpecialistId,'architecture-security-advisor');assert.equal(created.runtime.status,'UNVERIFIED');assert.equal(created.runtime.executable,false);assert.equal(created.execution.started,false);assert.equal(created.execution.completed,false);}finally{first.kill('SIGTERM');}
  const fresh=await start(18111);try{const get=await fetch(`http://127.0.0.1:18111/v1/workflows/${workflowId}`,{headers});assert.equal(get.status,200);const model=await get.json();assert.equal(model.id,workflowId);assert.equal(model.status,'ROUTED');assert.equal(model.selectedSpecialistId,'architecture-security-advisor');assert.equal(model.runtime.status,'UNVERIFIED');assert.equal(model.execution.started,false);assert.equal(model.execution.completed,false);const unknown=await fetch(`http://127.0.0.1:18111/v1/workflows/${randomUUID()}`,{headers});assert.equal(unknown.status,404);assert.deepEqual(await unknown.json(),{error:'WORKFLOW_NOT_FOUND'});}finally{fresh.kill('SIGTERM');}
});
