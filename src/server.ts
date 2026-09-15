import { createServer } from 'node:http';
import { Orchestrator } from './orchestrator.js';
import { MemoryStore, PersistenceStore } from './store.js';
import { UnavailableCodex, UnavailableSpecialist, SafePromptBuilder, UnavailableValidation, OpenAISpecialistExecutor, OpenAIValidationExecutor, RootlessContainerCodexExecutor } from './executors.js';
import { loadConfig } from './config.js'; import { PgStore } from './pg-store.js'; import { Classification } from './authorization.js'; import { principalForCredential, resolveRepository, validateRef, classify, freezeContext, contextFromWorkflow } from './trust.js';
import { createSpecialistInventoryProvider } from './specialist-inventory.js'; import { reconcileSpecialistInventory } from './registry-reconciliation.js'; import { registry } from './registry.js';
const config=loadConfig();
const store:PersistenceStore=config.appMode==='deployed'?new PgStore(config.databaseUrl):new MemoryStore();
const specialist=process.env.OPENAI_API_KEY?new OpenAISpecialistExecutor(process.env.OPENAI_API_KEY):new UnavailableSpecialist();
const validation=process.env.OPENAI_API_KEY?new OpenAIValidationExecutor(process.env.OPENAI_API_KEY):new UnavailableValidation();
const codex=process.env.CODEX_ENABLED==='true'?new RootlessContainerCodexExecutor():new UnavailableCodex();
const app=new Orchestrator(store,specialist,new SafePromptBuilder(),codex,validation,config.repositories); const token=config.apiToken;
function json(res:any,status:number,body:unknown){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));}
const server=createServer(async(req,res)=>{try{
  if(req.url==='/health'&&req.method==='GET')return json(res,200,{status:'ok'});
  if(req.url==='/ready'&&req.method==='GET'){if(config.appMode==='deployed'&&store instanceof PgStore)await store.pool.query('SELECT 1');return json(res,200,{status:'ready'});}
  const principal=principalForCredential(config.authMode==='token'?req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):undefined:undefined,config);
  const m=req.url?.match(/^\/v1\/workflows(?:\/([^/]+)(?:\/(run|events|result))?)?$/);if(!m)return json(res,404,{error:'NOT_FOUND'});
  const id=m[1],action=m[2];
  if(req.method==='POST'&&!id){let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);const repositoryId=typeof body.repository==='string'?body.repository:undefined;const base=repositoryId?config.repositories[repositoryId]:undefined;if(!base)return json(res,403,{error:'REPOSITORY_NOT_ALLOWED'});const repo=resolveRepository(repositoryId,config.repositories as any)!;const requestedRef=body.ref as string|undefined;if(base.allowedRefs||base.allowedRefPatterns){validateRef(requestedRef,repo);}else if(requestedRef)throw new Error('REPOSITORY_REF_NOT_ALLOWED');const trustedRepo=Object.freeze({...repo,approvedRef:requestedRef??base.allowedRefs?.[0]});const classification=classify(trustedRepo,body.requested_classification as Classification|undefined);const context=freezeContext({principal,operation:'create',requestId:body.request_id,specialistId:body.requested_specialist,executionType:body.workflow_type==='software'?'codex':'specialist',effectiveClassification:classification},trustedRepo);return json(res,201,await app.create({context,workflowInput:{request_id:body.request_id,requested_specialist:body.requested_specialist,objective:body.objective,workflow_type:body.workflow_type,requires_implementation:body.requires_implementation===true}},req.headers['idempotency-key']?.toString()));}
  const workflow=id?await store.getWorkflow(id):undefined;if(!workflow)return json(res,404,{error:'WORKFLOW_NOT_FOUND'});
  if(req.method==='POST'&&action==='run'){const current=contextFromWorkflow(workflow,'run',workflow.status==='ROUTED'?'specialist':'codex',principal,config.repositories as any);return json(res,200,await app.run(id,current,req.headers['x-worker-id']?.toString()??'http-worker'));}
  if(req.method==='GET'&&!action)return json(res,200,workflow);
  if(req.method==='GET'&&action==='events')return json(res,200,await store.getEvents(id));
  if(req.method==='GET'&&action==='result'){if(!['COMPLETE','FAILED','MANUAL_HANDOFF_REQUIRED'].includes(workflow.status))return json(res,409,{error:'RESULT_NOT_READY'});return json(res,200,{workflow,artifacts:await store.getArtifacts(id)});}
  return json(res,405,{error:'METHOD_NOT_ALLOWED'});
}catch(e){const code=e instanceof Error?e.message:'INVALID_REQUEST';const status=['AUTHENTICATION_FAILED','AUTHENTICATION_REQUIRED'].includes(code)?401:['AUTHORIZATION_FAILED','REPOSITORY_NOT_ALLOWED','REPOSITORY_REF_NOT_ALLOWED','REPOSITORY_REF_INVALID'].includes(code)?403:400;return json(res,status,{error:['INVALID_REQUEST','UNKNOWN_SPECIALIST','WORKFLOW_NOT_FOUND','REPOSITORY_NOT_ALLOWED','REPOSITORY_REF_NOT_ALLOWED','REPOSITORY_REF_INVALID','IDEMPOTENCY_KEY_REUSED'].includes(code)?code:status===401?'AUTHENTICATION_FAILED':'INVALID_REQUEST'});}});
if(store instanceof PgStore)await store.pool.query('SELECT 1');
const startupReconciliation=await reconcileSpecialistInventory(createSpecialistInventoryProvider(config.specialistInventoryProvider),registry);
console.log(JSON.stringify({event:'specialist_inventory_reconciled',freshness:startupReconciliation.freshness,outcomes:startupReconciliation.outcomes.map(outcome=>outcome.status)}));
server.listen(Number(process.env.PORT??8080),()=>console.log(JSON.stringify({event:'server_started',port:Number(process.env.PORT??8080),mode:config.appMode})));
