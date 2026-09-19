import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Orchestrator } from './orchestrator.js';
import { ApprovalStore, ClarificationStore, MemoryStore, PersistenceStore } from './store.js';
import { UnavailableCodex, UnavailableSpecialist, SafePromptBuilder, UnavailableValidation, OpenAISpecialistExecutor, OpenAIValidationExecutor, RootlessContainerCodexExecutor } from './executors.js';
import { loadConfig } from './config.js'; import { PgStore } from './pg-store.js'; import { Classification } from './authorization.js'; import { principalForCredential, resolveRepository, validateRef, classify, freezeCreationContext, contextFromWorkflow, assertWorkflowPrincipal } from './trust.js';
import { createSpecialistInventoryProvider } from './specialist-inventory.js'; import { inventoryReadiness, publicRegistryReconciliationStatus, reconcileSpecialistInventory } from './registry-reconciliation.js'; import { registry } from './registry.js';
import { readWorkflow } from './workflow-read-model.js';
import { readRoutingDecisions } from './routing-history-read-model.js';
import { readSpecialist, readSpecialists } from './specialist-read-model.js';
import { requestBody } from './input.js';
import { assertApprovalBelongsToWorkflow } from './api-boundaries.js';
const config=loadConfig();
const store:PersistenceStore=config.appMode==='deployed'?new PgStore(config.databaseUrl):new MemoryStore();
const specialist=process.env.OPENAI_API_KEY?new OpenAISpecialistExecutor(process.env.OPENAI_API_KEY):new UnavailableSpecialist();
const validation=process.env.OPENAI_API_KEY?new OpenAIValidationExecutor(process.env.OPENAI_API_KEY):new UnavailableValidation();
const codex=process.env.CODEX_ENABLED==='true'?new RootlessContainerCodexExecutor():new UnavailableCodex();
const app=new Orchestrator(store,specialist,new SafePromptBuilder(),codex,validation,config.repositories); const token=config.apiToken;
let shuttingDown=false;
function json(res:any,status:number,body:unknown){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));}
const clientAssets:Record<string,{file:string;type:string}>={
  '/':{file:'index.html',type:'text/html; charset=utf-8'},
  '/app.js':{file:'app.js',type:'text/javascript; charset=utf-8'},
  '/styles.css':{file:'styles.css',type:'text/css; charset=utf-8'}
};
async function serveClient(req:any,res:any):Promise<boolean>{
  if(req.method!=='GET')return false;
  const asset=clientAssets[req.url??''];
  if(!asset)return false;
  try{
    const body=await readFile(resolve(process.cwd(),'client',asset.file),'utf8');
    res.writeHead(200,{'content-type':asset.type,'cache-control':'no-store'});res.end(body);return true;
  }catch{return false;}
}
function assertAllowedKeys(body:any,allowed:readonly string[]){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!allowed.includes(key)))throw new Error('INVALID_REQUEST');}
async function persistedReadModel(id:string,principal:any){const persisted=await store.getWorkflow(id);if(!persisted)throw new Error('WORKFLOW_NOT_FOUND');assertWorkflowPrincipal(persisted,principal);return readWorkflow(store,persisted,await app.getSpecialistCatalog());}
async function commandResponse(id:string,decisionId:string,principal:any){const workflow=await persistedReadModel(id,principal);const decisions=await readRoutingDecisions(store,id);return {...workflow,workflow,decision:decisions.find(decision=>decision.id===decisionId)};}
const server=createServer(async(req,res)=>{try{
  if(await serveClient(req,res))return;
  if(req.url==='/health'&&req.method==='GET')return json(res,200,{status:'ok'});
  if(shuttingDown)return json(res,503,{status:'shutting_down'});
  if(req.url==='/ready'&&req.method==='GET'){
    if(shuttingDown)return json(res,503,{status:'not_ready'});
    try{if(config.appMode==='deployed'&&store instanceof PgStore)await store.pool.query('SELECT 1');}catch{return json(res,503,{status:'not_ready'});}
    const readiness=inventoryReadiness(config.specialistInventoryProvider,startupReconciliation.freshness);
    if(!readiness.ready){
      return json(res,503,{status:'not_ready',inventoryFreshness:readiness.inventoryFreshness});
    }
    return json(res,200,{status:'ready',inventoryFreshness:readiness.inventoryFreshness});
  }
  if(req.url==='/inventory-status'&&req.method==='GET')return json(res,200,publicRegistryReconciliationStatus(startupReconciliation));
  const principal=principalForCredential(config.authMode==='token'?req.headers.authorization?.startsWith('Bearer ')?req.headers.authorization.slice(7):undefined:undefined,config);
  const specialistMatch=req.url?.match(/^\/v1\/specialists(?:\/([^/]+))?$/);
  if(req.method==='GET'&&specialistMatch){
    const catalog=await app.getSpecialistCatalog();
    if(!specialistMatch[1])return json(res,200,readSpecialists(catalog));
    const specialist=catalog[decodeURIComponent(specialistMatch[1])];
    if(!specialist)return json(res,404,{error:'SPECIALIST_NOT_FOUND'});
    return json(res,200,readSpecialist(specialist));
  }
  const m=req.url?.match(/^\/v1\/workflows(?:\/([^/]+)(?:\/(run|recover|events|result|routing-decisions|clarification|clarification-response|approval|override|handoff|handoff-response))?)?$/);if(!m)return json(res,404,{error:'NOT_FOUND'});
  const id=m[1],action=m[2];
  if(req.method==='POST'&&!id){const body=await requestBody(req);assertAllowedKeys(body,['request_id','requested_specialist','objective','workflow_type','requires_implementation','repository','ref','requested_classification']);if(typeof body.repository!=='string'||typeof body.request_id!=='string'||typeof body.objective!=='string'||!['software','non_code'].includes(body.workflow_type)||(body.requested_specialist!==undefined&&typeof body.requested_specialist!=='string')||(body.requires_implementation!==undefined&&typeof body.requires_implementation!=='boolean')||(body.ref!==undefined&&typeof body.ref!=='string')||(body.requested_classification!==undefined&&!['PUBLIC','INTERNAL','CONFIDENTIAL','RESTRICTED'].includes(body.requested_classification)))throw new Error('INVALID_REQUEST');if(body.request_id.length>256||body.objective.length>100000||body.requested_specialist?.length>256)throw new Error('INVALID_REQUEST');const repositoryId=body.repository;const base=config.repositories[repositoryId];if(!base)return json(res,403,{error:'REPOSITORY_NOT_ALLOWED'});const repo=resolveRepository(repositoryId,config.repositories as any)!;const requestedRef=body.ref as string|undefined;if(base.allowedRefs||base.allowedRefPatterns){validateRef(requestedRef,repo);}else if(requestedRef)throw new Error('REPOSITORY_REF_NOT_ALLOWED');const trustedRepo=Object.freeze({...repo,repositoryId,approvedRef:requestedRef??base.allowedRefs?.[0]});const classification=classify(trustedRepo,body.requested_classification as Classification|undefined);const context=freezeCreationContext({principal,operation:'create',requestId:body.request_id,executionType:body.workflow_type==='software'?'codex':'specialist',effectiveClassification:classification},trustedRepo);const created=await app.create({context,workflowInput:{request_id:body.request_id,requested_specialist:body.requested_specialist,objective:body.objective,workflow_type:body.workflow_type,requires_implementation:body.requires_implementation}},req.headers['idempotency-key']?.toString());return json(res,201,await persistedReadModel(created.id,principal));}
  const workflow=id?await store.getWorkflow(id):undefined;if(!workflow)return json(res,404,{error:'WORKFLOW_NOT_FOUND'});assertWorkflowPrincipal(workflow,principal);
  const clarificationStore=store as Partial<ClarificationStore>;
  const approvalStore=store as Partial<ApprovalStore>;
  if(req.method==='GET'&&action==='routing-decisions')return json(res,200,await readRoutingDecisions(store, id));
  if(req.method==='GET'&&action==='clarification'){const clarification=await clarificationStore.getPendingClarification?.(id);if(!clarification)return json(res,404,{error:'CLARIFICATION_NOT_FOUND'});return json(res,200,clarification);}
  if(req.method==='GET'&&action==='approval'){const approval=await approvalStore.getPendingApproval?.(id);if(!approval)return json(res,404,{error:'APPROVAL_NOT_FOUND'});return json(res,200,approval);}
  if(req.method==='POST'&&action==='approval'){if(!approvalStore.decideApproval)return json(res,409,{error:'APPROVAL_PERSISTENCE_UNAVAILABLE'});const body=await requestBody(req);assertAllowedKeys(body,['approvalId','decision','reason']);if(body.decision!=='APPROVED'&&body.decision!=='REJECTED')throw new Error('INVALID_APPROVAL_DECISION');if(body.approvalId!==undefined&&typeof body.approvalId!=='string')throw new Error('INVALID_REQUEST');if(body.reason!==undefined&&typeof body.reason!=='string')throw new Error('INVALID_REQUEST');const approvalId=typeof body.approvalId==='string'?body.approvalId:(await approvalStore.getPendingApproval?.(id))?.id;if(!approvalId)throw new Error('APPROVAL_NOT_FOUND');assertApprovalBelongsToWorkflow(id,await approvalStore.getApproval?.(approvalId));const approval=await approvalStore.decideApproval(approvalId,body.decision,body.reason??'',principal.id);return json(res,200,{...approval,workflow:await persistedReadModel(id,principal)});}
  if(req.method==='POST'&&action==='override'){const body=await requestBody(req);assertAllowedKeys(body,['specialistId','reason','expectedDecisionId']);if(typeof body.specialistId!=='string'||!body.specialistId.trim()|| (body.reason!==undefined&&typeof body.reason!=='string') || (body.expectedDecisionId!==undefined&&typeof body.expectedDecisionId!=='string'))throw new Error('INVALID_REQUEST');const result=await app.applyUserOverride(id,body.specialistId.trim(),body.reason??'',principal,body.expectedDecisionId);return json(res,200,await commandResponse(id,result.decision.id,principal));}
  if(req.method==='POST'&&action==='clarification-response'){const body=await requestBody(req);assertAllowedKeys(body,['clarificationId','response','routing','candidates']);if(typeof body.response!=='string'||!body.response.trim()||typeof body.clarificationId!=='string')throw new Error('INVALID_REQUEST');if(body.routing!==undefined&&(typeof body.routing!=='object'||Array.isArray(body.routing)))throw new Error('INVALID_REQUEST');if(body.routing!==undefined)assertAllowedKeys(body.routing,['selectedSpecialistId','routingConfidence','routingReason']);if(body.routing?.selectedSpecialistId!==undefined&&typeof body.routing.selectedSpecialistId!=='string')throw new Error('INVALID_REQUEST');if(body.routing?.routingConfidence!==undefined&&typeof body.routing.routingConfidence!=='string')throw new Error('INVALID_REQUEST');if(body.routing?.routingReason!==undefined&&typeof body.routing.routingReason!=='string')throw new Error('INVALID_REQUEST');if(body.candidates!==undefined&&!Array.isArray(body.candidates))throw new Error('INVALID_REQUEST');if(Array.isArray(body.candidates))for(const candidate of body.candidates){assertAllowedKeys(candidate,['id','specialistId','rank','matchReason']);}const requestedSpecialist=body.routing&&typeof body.routing.selectedSpecialistId==='string'?body.routing.selectedSpecialistId:undefined;const result=await app.resumeClarification(id,body.clarificationId,body.response,principal,requestedSpecialist);return json(res,200,await commandResponse(id,result.decision.id,principal));}
  if(req.method==='POST'&&action==='run'){const current=contextFromWorkflow(workflow,'run',workflow.status==='ROUTED'?'specialist':'codex',principal,config.repositories as any);return json(res,200,await app.run(id,current,req.headers['x-worker-id']?.toString()??'http-worker'));}
  if(req.method==='POST'&&action==='recover'){const body=await requestBody(req);assertAllowedKeys(body,['reason']);if(body.reason!==undefined&&typeof body.reason!=='string')throw new Error('INVALID_REQUEST');return json(res,200,await app.recover(id,principal,body.reason));}
  if(req.method==='GET'&&action==='handoff')return json(res,200,(await persistedReadModel(id,principal)).manualHandoff??{available:false,specialistId:workflow.logicalSpecialistId});
  if(req.method==='POST'&&action==='handoff-response'){const body=await requestBody(req);assertAllowedKeys(body,['output']);if(body.output===undefined)throw new Error('INVALID_REQUEST');await app.acceptManualHandoff(id,body.output,principal);return json(res,200,await persistedReadModel(id,principal));}
  if(req.method==='GET'&&!action)return json(res,200,await readWorkflow(store,workflow,await app.getSpecialistCatalog()));
  if(req.method==='GET'&&action==='events')return json(res,200,await store.getEvents(id));
  if(req.method==='GET'&&action==='result'){if(!['COMPLETE','FAILED','MANUAL_HANDOFF_REQUIRED'].includes(workflow.status))return json(res,409,{error:'RESULT_NOT_READY'});return json(res,200,{workflow:await readWorkflow(store,workflow,await app.getSpecialistCatalog()),artifacts:await store.getArtifacts(id)});}
  return json(res,405,{error:'METHOD_NOT_ALLOWED'});
}catch(e){const code=e instanceof Error?e.message:'INVALID_REQUEST';const status=['AUTHENTICATION_FAILED','AUTHENTICATION_REQUIRED'].includes(code)?401:['AUTHORIZATION_FAILED','REPOSITORY_NOT_ALLOWED','REPOSITORY_REF_NOT_ALLOWED','REPOSITORY_REF_INVALID'].includes(code)?403:code==='REQUEST_TOO_LARGE'?413:400;const exposed=['INVALID_REQUEST','REQUEST_TOO_LARGE','UNKNOWN_SPECIALIST','WORKFLOW_NOT_FOUND','REPOSITORY_NOT_ALLOWED','REPOSITORY_REF_NOT_ALLOWED','REPOSITORY_REF_INVALID','IDEMPOTENCY_KEY_REUSED','INVALID_OVERRIDE_TARGET','STALE_ROUTING_DECISION','OVERRIDE_STATE_UNSAFE','ROUTING_DECISION_NOT_FOUND','CLARIFICATION_NOT_FOUND','CLARIFICATION_ALREADY_ANSWERED','ROUTING_UNRESOLVED','APPROVAL_NOT_FOUND','INVALID_APPROVAL_DECISION','APPROVAL_ALREADY_DECIDED','APPROVAL_WORKFLOW_STATE_MISMATCH','RECOVERY_STATE_UNSAFE','RECOVERY_ATTEMPT_NOT_ACTIVE','INVALID_RECOVERY_REASON','WORKFLOW_NOT_ACTIVE','MANUAL_HANDOFF_UNAVAILABLE','MANUAL_HANDOFF_STATE_UNSAFE','MANUAL_HANDOFF_PLAN_RESUME_UNSUPPORTED','INVALID_MANUAL_HANDOFF_OUTPUT','HANDOFF_OUTPUT_TOO_LARGE'];return json(res,status,{error:exposed.includes(code)?code:status===401?'AUTHENTICATION_FAILED':'INVALID_REQUEST'});}});
if(store instanceof PgStore){await store.pool.query('SELECT 1');await store.verifySchema();}
const startupReconciliation=await reconcileSpecialistInventory(createSpecialistInventoryProvider(config.specialistInventoryProvider,config.specialistInventoryFile),registry);
console.log(JSON.stringify({event:'specialist_inventory_reconciled',freshness:startupReconciliation.freshness,outcomes:startupReconciliation.outcomes.map(outcome=>outcome.status)}));
const shutdown=async(signal:string)=>{if(shuttingDown)return;shuttingDown=true;console.log(JSON.stringify({event:'server_shutdown_started',signal}));const force=setTimeout(()=>process.exit(1),10000);force.unref();server.close(async()=>{if(store instanceof PgStore)await store.pool.end().catch(()=>{});clearTimeout(force);console.log(JSON.stringify({event:'server_shutdown_complete'}));process.exit(0);});};
process.once('SIGTERM',()=>void shutdown('SIGTERM'));process.once('SIGINT',()=>void shutdown('SIGINT'));
server.listen(Number(process.env.PORT??8080),()=>console.log(JSON.stringify({event:'server_started',port:Number(process.env.PORT??8080),mode:config.appMode})));
