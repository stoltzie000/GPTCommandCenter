// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const url=process.env.PG_TEST_URL;
const start=port=>{const child=spawn(process.execPath,['dist/src/server.js'],{env:{...process.env,APP_MODE:'deployed',AUTH_MODE:'token',DATABASE_URL:url,PGPASSWORD:process.env.PGPASSWORD,ORCHESTRATOR_API_TOKEN:'test-only-token',AUTH_PRINCIPALS:JSON.stringify({'test-only-token':{id:'reader',roles:[],scopes:[]}}),PORT:String(port)},stdio:['ignore','pipe','pipe']});return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('SERVER_START_TIMEOUT')),5000);child.stdout.on('data',chunk=>{if(String(chunk).includes('server_started')){clearTimeout(timer);resolve(child);}});child.on('error',reject);});};
const stop=child=>new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');});
const get=(port,path)=>fetch(`http://127.0.0.1:${port}${path}`,{headers:{authorization:'Bearer test-only-token'}});

test('22M4-01/02/03/10 specialist list/detail API is canonical, safe, and side-effect free',{skip:!url},async()=>{
  const child=await start(18140);
  try{
    const before=await (await get(18140,'/v1/specialists')).json();assert.equal(before.length,25);assert.equal(before[0].id,'architecture-security-advisor');assert.equal(before[0].role,'ROUTABLE_SPECIALIST');assert.equal(before[0].runtime.executable,false);assert.equal(before[0].manualHandoff.available,false);
    const serialized=JSON.stringify(before);for(const forbidden of ['authorizationDecision','context','instructionRef','outputSchema','timeoutSeconds','maxAttempts','OPENAI_API_KEY','secrets'])assert.equal(serialized.includes(forbidden),false,forbidden);
    const detail=await get(18140,'/v1/specialists/architecture-security-advisor');assert.equal(detail.status,200);const body=await detail.json();assert.deepEqual(body,before[0]);
    const unknown=await get(18140,'/v1/specialists/not-registered');assert.equal(unknown.status,404);
    const after=await (await get(18140,'/v1/specialists')).json();assert.deepEqual(after,before);
  }finally{await stop(child);}
});
