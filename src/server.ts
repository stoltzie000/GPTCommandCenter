import { createServer } from 'node:http';
import { Orchestrator } from './orchestrator.js';
import { ApprovalStore, ClarificationStore, MemoryStore, PersistenceStore } from './store.js';
import { UnavailableCodex, UnavailableSpecialist, SafePromptBuilder, UnavailableValidation, OpenAISpecialistExecutor, OpenAIValidationExecutor, RootlessContainerCodexExecutor } from './executors.js';
import { loadConfig } from './config.js'; import { PgStore } from './pg-store.js'; import { Classification } from './authorization.js'; import { principalForCredential, resolveRepository, validateRef, classify, freezeCreationContext, contextFromWorkflow } from './trust.js';
import { createSpecialistInventoryProvider } from './specialist-inventory.js'; import { inventoryReadiness, publicRegistryReconciliationStatus, reconcileSpecialistInventory } from './registry-reconciliation.js'; import { registry } from './registry.js';
import { readWorkflow } from './workflow-read-model.js';
import { readRoutingDecisions } from './routing-history-read-model.js';
import { readSpecialist, readSpecialists } from './specialist-read-model.js';
const config=loadConfig();
const store:PersistenceStore=config.appMode==='deployed'?new PgStore(config.databaseUrl):new MemoryStore();
const specialist=process.env.OPENAI_API_KEY?new OpenAISpecialistExecutor(process.env.OPENAI_API_KEY):new UnavailableSpecialist();
const validation=process.env.OPENAI_API_KEY?new OpenAIValidationExecutor(process.env.OPENAI_API_KEY):new UnavailableValidation();
const codex=process.env.CODEX_ENABLED==='true'?new RootlessContainerCodexExecutor():new UnavailableCodex();
const app=new Orchestrator(store,specialist,new SafePromptBuilder(),codex,validation,config.repositories); const token=config.apiToken;
function json(res:any,status:number,body:unknown){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body));}
async function requestBody(req: any): Promise<any> { let raw=''; for await(const c of req)raw+=c; return JSON.parse(raw); }
function assertAllowedKeys(body:any,allowed:readonly string[]){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!allowed.includes(key)))throw new Error('INVALID_REQUEST');}
async function persistedReadModel(id:string){const persisted=await store.getWorkflow(id);if(!persisted)throw new Error('WORKFLOW_NOT_FOUND');return readWorkflow(store,persisted);}
async function commandResponse(id:string,decisionId:string){const workflow=await persistedReadModel(id);const decisions=await readRoutingDecisions(store,id);return {...workflow,workflow,decision:decisions.find(decision=>decision.id===decisionId)};}
const server=createServer(async(req,res)=>{try{
  if(req.url==='/health'&&req.method==='GET')return json(res,200,{status:'ok'});
  if(req.url==='/ready'&&req.method==='GET'){
    if(config.appMode==='deployed'&&store instanceof PgStore)await store.pool.query('SELECT 1');
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
    if(!specialistMatch[1])return json(res,200,readSpecialists(registry));
    const specialist=registry[decodeURIComponent(specialistMatch[1])];
    if(!specialist)return json(res,404,{error:'SPECIALIST_NOT_FOUND'});
    return json(res,200,readSpecialist(specialist));
  }
  const m=req.url?.match(/^\/v1\/workflows(?:\/([^/]+)(?:\/(run|events|result|routing-decisions|clarification|clarification-response|approval|override))?)?$/);if(!m)return json(res,404,{error:'NOT_FOUND'});
  const id=m[1],action=m[2];
  if(req.method==='POST'&&!id){const body=await requestBody(req);const repositoryId=typeof body.repository==='string'?body.repository:undefined;const base=repositoryId?config.repositories[repositoryId]:undefined;if(!base)return json(res,403,{error:'REPOSITORY_NOT_ALLOWED'});const repo=resolveRepository(repositoryId,config.repositories as any)!;const requestedRef=body.ref as string|undefined;if(base.allowedRefs||base.allowedRefPatterns){validateRef(requestedRef,repo);}else if(requestedRef)throw new Error('REPOSITORY_REF_NOT_ALLOWED');const trustedRepo=Object.freeze({...repo,repositoryId,approvedRef:requestedRef??base.allowedRefs?.[0]});const classification=classify(trustedRepo,body.requested_classification as Classification|undefined);const context=freezeCreationContext({principal,operation:'create',requestId:body.request_id,executionType:body.workflow_type==='software'?'codex':'specialist',effectiveClassification:classification},trustedRepo);const created=await app.create({context,workflowInput:{request_id:body.request_id,requested_specialist:typeof body.requested_specialist==='string'?body.requested_specialist:undefined,objective:body.objective,workflow_type:body.workflow_type,requires_implementation:body.requires_implementation===true}},req.headers['idempotency-key']?.toString());return json(res,201,await persistedReadModel(created.id));}
  const workflow=id?await store.getWorkflow(id):undefined;if(!workflow)return json(res,404,{error:'WORKFLOW_NOT_FOUND'});
  const clarificationStore=store as Partial<ClarificationStore>;
  const approvalStore=store as Partial<ApprovalStore>;
  if(req.method==='GET'&&action==='routing-decisions')return json(res,200,await readRoutingDecisions(store, id));
  if(req.method==='GET'&&action==='clarification'){const clarification=await clarificationStore.getPendingClarification?.(id);if(!clarification)return json(res,404,{error:'CLARIFICATION_NOT_FOUND'});return json(res,200,clarification);}
  if(req.method==='GET'&&action==='approval'){const approval=await approvalStore.getPendingApproval?.(id);if(!approval)return json(res,404,{error:'APPROVAL_NOT_FOUND'});return json(res,200,approval);}
  if(req.method==='POST'&&action==='approval'){if(!approvalStore.decideApproval)return json(res,409,{error:'APPROVAL_PERSISTENCE_UNAVAILABLE'});const body=await requestBody(req);assertAllowedKeys(body,['approvalId','decision','reason']);if(body.decision!=='APPROVED'&&body.decision!=='REJECTED')throw new Error('INVALID_APPROVAL_DECISION');if(body.approvalId!==undefined&&typeof body.approvalId!=='string')throw new Error('INVALID_REQUEST');if(body.reason!==undefined&&typeof body.reason!=='string')throw new Error('INVALID_REQUEST');const approvalId=typeof body.approvalId==='string'?body.approvalId:(await approvalStore.getPendingApproval?.(id))?.id;if(!approvalId)throw new Error('APPROVAL_NOT_FOUND');const approval=await approvalStore.decideApproval(approvalId,body.decision,body.reason??'',principal.id);return json(res,200,{...approval,workflow:await persistedReadModel(id)});}
  if(req.method==='POST'&&action==='override'){const body=await requestBody(req);assertAllowedKeys(body,['specialistId','reason','expectedDecisionId']);if(typeof body.specialistId!=='string'||!body.specialistId.trim()|| (body.reason!==undefined&&typeof body.reason!=='string') || (body.expectedDecisionId!==undefined&&typeof body.expectedDecisionId!=='string'))throw new Error('INVALID_REQUEST');const result=await app.applyUserOverride(id,body.specialistId.trim(),body.reason??'',principal,body.expectedDecisionId);return json(res,200,await commandResponse(id,result.decision.id));}
  if(req.method==='POST'&&action==='clarification-response'){const body=await requestBody(req);assertAllowedKeys(body,['clarificationId','response','routing','candidates']);if(typeof body.response!=='string'||!body.response.trim()||typeof body.clarificationId!=='string')throw new Error('INVALID_REQUEST');if(body.routing!==undefined&&(typeof body.routing!=='object'||Array.isArray(body.routing)))throw new Error('INVALID_REQUEST');if(body.routing!==undefined)assertAllowedKeys(body.routing,['selectedSpecialistId','routingConfidence','routingReason']);if(body.routing?.selectedSpecialistId!==undefined&&typeof body.routing.selectedSpecialistId!=='string')throw new Error('INVALID_REQUEST');if(body.routing?.routingConfidence!==undefined&&typeof body.routing.routingConfidence!=='string')throw new Error('INVALID_REQUEST');if(body.routing?.routingReason!==undefined&&typeof body.routing.routingReason!=='string')throw new Error('INVALID_REQUEST');if(body.candidates!==undefined&&!Array.isArray(body.candidates))throw new Error('INVALID_REQUEST');if(Array.isArray(body.candidates))for(const candidate of body.candidates){assertAllowedKeys(candidate,['id','specialistId','rank','matchReason']);}const requestedSpecialist=body.routing&&typeof body.routing.selectedSpecialistId==='string'?body.routing.selectedSpecialistId:undefined;const result=await app.resumeClarification(id,body.clarificationId,body.response,principal,requestedSpecialist);return json(res,200,await commandResponse(id,result.decision.id));}
  if(req.method==='POST'&&action==='run'){const current=contextFromWorkflow(workflow,'run',workflow.status==='ROUTED'?'specialist':'codex',principal,config.repositories as any);return json(res,200,await app.run(id,current,req.headers['x-worker-id']?.toString()??'http-worker'));}
  if(req.method==='GET'&&!action)return json(res,200,await readWorkflow(store,workflow));
  if(req.method==='GET'&&action==='events')return json(res,200,await store.getEvents(id));
  if(req.method==='GET'&&action==='result'){if(!['COMPLETE','FAILED','MANUAL_HANDOFF_REQUIRED'].includes(workflow.status))return json(res,409,{error:'RESULT_NOT_READY'});return json(res,200,{workflow,artifacts:await store.getArtifacts(id)});}
  return json(res,405,{error:'METHOD_NOT_ALLOWED'});
}catch(e){const code=e instanceof Error?e.message:'INVALID_REQUEST';const status=['AUTHENTICATION_FAILED','AUTHENTICATION_REQUIRED'].includes(code)?401:['AUTHORIZATION_FAILED','REPOSITORY_NOT_ALLOWED','REPOSITORY_REF_NOT_ALLOWED','REPOSITORY_REF_INVALID'].includes(code)?403:400;const exposed=['INVALID_REQUEST','UNKNOWN_SPECIALIST','WORKFLOW_NOT_FOUND','REPOSITORY_NOT_ALLOWED','REPOSITORY_REF_NOT_ALLOWED','REPOSITORY_REF_INVALID','IDEMPOTENCY_KEY_REUSED','INVALID_OVERRIDE_TARGET','STALE_ROUTING_DECISION','OVERRIDE_STATE_UNSAFE','ROUTING_DECISION_NOT_FOUND','CLARIFICATION_NOT_FOUND','CLARIFICATION_ALREADY_ANSWERED','ROUTING_UNRESOLVED','APPROVAL_NOT_FOUND','INVALID_APPROVAL_DECISION','APPROVAL_ALREADY_DECIDED','APPROVAL_WORKFLOW_STATE_MISMATCH'];return json(res,status,{error:exposed.includes(code)?code:status===401?'AUTHENTICATION_FAILED':'INVALID_REQUEST'});}});
if(store instanceof PgStore)await store.pool.query('SELECT 1');
const startupReconciliation=await reconcileSpecialistInventory(createSpecialistInventoryProvider(config.specialistInventoryProvider,config.specialistInventoryFile),registry);
console.log(JSON.stringify({event:'specialist_inventory_reconciled',freshness:startupReconciliation.freshness,outcomes:startupReconciliation.outcomes.map(outcome=>outcome.status)}));
server.listen(Number(process.env.PORT??8080),()=>console.log(JSON.stringify({event:'server_started',port:Number(process.env.PORT??8080),mode:config.appMode})));
