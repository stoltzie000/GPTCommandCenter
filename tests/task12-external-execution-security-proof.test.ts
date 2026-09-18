import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {requestBody,MAX_REQUEST_BODY_BYTES} from '../src/input.js';
import {ProcessCodexExecutor,buildContainerSpec} from '../src/executors.js';
import {validateRef} from '../src/trust.js';

function context(){return {principal:{id:'caller',roles:[],scopes:[],authType:'token'},operation:'run',requestId:'task12',workflowId:'workflow',specialistId:'architecture-security-advisor',executionType:'codex',effectiveClassification:'PUBLIC',resolvedRepository:{repositoryId:'repo',source:'./repo',classification:'PUBLIC',allowedCallers:['caller'],allowedRefs:['main'],approvedRef:'main'},authorizationDecision:{allowed:true,ruleId:'test',decidedAt:new Date().toISOString()}} as any;}
function processLike(){const p:any=new EventEmitter();p.pid=42;p.stdin={end:()=>{queueMicrotask(()=>p.emit('exit',0));}};p.stdout=new EventEmitter();p.stderr=new EventEmitter();p.kill=()=>{p.killed=true;};return p;}

test('request body parsing rejects oversized streams before JSON parsing',async()=>{
  async function* chunks(){yield Buffer.alloc(MAX_REQUEST_BODY_BYTES);yield Buffer.from('x');}
  await assert.rejects(()=>requestBody(chunks()),/REQUEST_TOO_LARGE/);
});

test('host executor keeps hostile task text as stdin data and uses bounded structured process invocation',async()=>{
  let invocation:any;let received='';
  const spawnFake=(command:string,args:string[],options:any)=>{invocation={command,args,options};const p=processLike();p.stdin={end:(value:string)=>{received=value;queueMicrotask(()=>p.emit('exit',0));}};return p;};
  const executor=new ProcessCodexExecutor('trusted-codex','.',spawnFake,async()=>({path:'/trusted/workspace',cleanup:async()=>{}}),1000);
  const hostile='$(touch /tmp/pwned); --sandbox=untrusted';
  const result=await executor.execute({trustedContext:context(),workflowId:'workflow',stageId:'stage',promptArtifact:{implementation_instructions:hostile} as any,executionPolicy:{}});
  assert.equal(result.kind,'success');assert.equal(received,hostile);assert.equal(invocation.command,'trusted-codex');assert.equal(invocation.options.shell,false);assert.equal(invocation.args.includes(hostile),false);assert.equal(invocation.args.at(-1),'-');
});

test('executor output is bounded and does not wait indefinitely for an unbounded process',async()=>{
  const spawnFake=()=>{const p=processLike();queueMicrotask(()=>p.stdout.emit('data','x'.repeat(4*1024*1024+1)));return p;};
  const executor=new ProcessCodexExecutor('trusted-codex','.',spawnFake,async()=>({path:'/trusted/workspace',cleanup:async()=>{}}),1000);
  const result=await executor.execute({trustedContext:context(),workflowId:'workflow',stageId:'stage',promptArtifact:{implementation_instructions:'safe'} as any,executionPolicy:{}});
  assert.equal(result.kind,'retryable_failure');
});

test('repository refs reject traversal, absolute paths, option injection, and shell syntax',()=>{
  const policy={repositoryId:'repo',source:'./repo',classification:'PUBLIC',allowedRefs:['main']} as any;
  for(const value of ['../escape','/absolute','C:\\absolute','-x','main;touch'])assert.throws(()=>validateRef(value,policy),/REPOSITORY_REF_INVALID/);
});

test('container execution remains shell-free and network-isolated',()=>{
  const spec=buildContainerSpec('docker','trusted-image','/trusted/workspace','$(touch /tmp/pwned)');
  assert.equal(spec.shell,false);assert.equal(spec.args.includes('$(touch /tmp/pwned)'),false);assert.ok(spec.args.includes('--network'));assert.equal(spec.args[spec.args.indexOf('--network')+1],'none');
});
