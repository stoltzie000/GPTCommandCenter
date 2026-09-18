import { Classification, RepositoryPolicy, authorize, authorizeCreation, effectiveClassification } from './authorization.js';
export interface Principal { readonly id:string; readonly roles:readonly string[]; readonly scopes:readonly string[]; readonly authType:'token'|'local'; readonly maxClassification?:Classification; }
export interface ResolvedRepositoryPolicy extends RepositoryPolicy { readonly repositoryId:string; readonly approvedRef?:string; readonly allowedRefs?:readonly string[]; readonly allowedRefPatterns?:readonly string[]; }
export interface AuthorizationDecision { readonly allowed:true; readonly ruleId:string; readonly decidedAt:string; }
export interface ExecutionContext { readonly principal:Principal; readonly operation:string; readonly requestId:string; readonly workflowId?:string; readonly specialistId:string; readonly executionType:string; readonly resolvedRepository?:ResolvedRepositoryPolicy; readonly effectiveClassification:Classification; readonly authorizationDecision:AuthorizationDecision; }
export interface CreationContext { readonly principal:Principal; readonly operation:'create'; readonly requestId:string; readonly executionType:string; readonly resolvedRepository?:ResolvedRepositoryPolicy; readonly effectiveClassification:Classification; readonly authorizationDecision:AuthorizationDecision; }
export function assertCreationContext(value:unknown):asserts value is CreationContext {
  if(!value||typeof value!=='object')throw new Error('AUTHORIZATION_FAILED');
  const c=value as any;
  if(!c.principal?.id||c.operation!=='create'||!c.requestId||!c.executionType||!c.effectiveClassification||c.authorizationDecision?.allowed!==true)throw new Error('AUTHORIZATION_FAILED');
  if('specialistId' in c&&c.specialistId!==undefined)throw new Error('AUTHORIZATION_FAILED');
  if(c.resolvedRepository&&!c.resolvedRepository.repositoryId)throw new Error('REPOSITORY_NOT_ALLOWED');
}
export function assertAuthorizedCreation(value:unknown):asserts value is CreationContext {
  assertCreationContext(value);
  const c=value as CreationContext;
  authorizeCreation({
    caller:c.principal.id,
    operation:'create',
    repositoryId:c.resolvedRepository?.repositoryId,
    executionType:c.executionType,
    dataClassification:c.effectiveClassification,
    principalMaxClassification:c.principal.maxClassification,
    repository:c.resolvedRepository
  });
}
export function freezeCreationContext(input:Omit<CreationContext,'authorizationDecision'>,repo?:ResolvedRepositoryPolicy):Readonly<CreationContext>{
  authorizeCreation({
    caller:input.principal.id,
    operation:'create',
    repositoryId:repo?.repositoryId,
    executionType:input.executionType,
    dataClassification:input.effectiveClassification,
    principalMaxClassification:input.principal.maxClassification,
    repository:repo
  });
  return Object.freeze({
    ...input,
    resolvedRepository:repo,
    authorizationDecision:Object.freeze({
      allowed:true,
      ruleId:'default-allow',
      decidedAt:new Date().toISOString()
    })
  });
}

export function assertExecutionContext(value:unknown):asserts value is ExecutionContext { if(!value||typeof value!=='object')throw new Error('AUTHORIZATION_FAILED');const c=value as any;if(!c.principal?.id||!c.operation||!c.requestId||!c.specialistId||!c.executionType||!c.effectiveClassification||c.authorizationDecision?.allowed!==true)throw new Error('AUTHORIZATION_FAILED');if(c.resolvedRepository&&!c.resolvedRepository.repositoryId)throw new Error('REPOSITORY_NOT_ALLOWED'); }
export function assertAuthorizedExecution(value:unknown):asserts value is ExecutionContext { assertExecutionContext(value); const c=value as ExecutionContext; authorize({caller:c.principal.id,operation:c.operation,specialistId:c.specialistId,repositoryId:c.resolvedRepository?.repositoryId,executionType:c.executionType,dataClassification:c.effectiveClassification,principalMaxClassification:c.principal.maxClassification,repository:c.resolvedRepository}); }
export function freezeContext(input:Omit<ExecutionContext,'authorizationDecision'>,repo?:ResolvedRepositoryPolicy):Readonly<ExecutionContext>{const decision=authorize({caller:input.principal.id,operation:input.operation,specialistId:input.specialistId,repositoryId:repo?.repositoryId,executionType:input.executionType,dataClassification:input.effectiveClassification,principalMaxClassification:input.principal.maxClassification,repository:repo});return Object.freeze({...input,resolvedRepository:repo,authorizationDecision:Object.freeze({allowed:true,ruleId:'default-allow',decidedAt:new Date().toISOString()})});}
export function resolveRepository(id:string|undefined,registry:Record<string,ResolvedRepositoryPolicy>){if(!id)return undefined;const p=registry[id];if(!p)throw new Error('REPOSITORY_NOT_ALLOWED');return Object.freeze({...p,allowedRefs:p.allowedRefs?Object.freeze([...p.allowedRefs]):undefined,allowedRefPatterns:p.allowedRefPatterns?Object.freeze([...p.allowedRefPatterns]):undefined});}
export function validateRef(ref:string|undefined,policy:ResolvedRepositoryPolicy){if(ref===undefined)return; if(!policy.allowedRefs&&!policy.allowedRefPatterns)throw new Error('REPOSITORY_REF_NOT_ALLOWED');if(/[\u0000-\u001f\u007f]/.test(ref)||ref.startsWith('-')||ref.includes('..')||ref.startsWith('/')||/^[A-Za-z]:[\\/]/.test(ref)||/[;&|`$()<>]/.test(ref))throw new Error('REPOSITORY_REF_INVALID');const allowed=policy.allowedRefs?.includes(ref)||policy.allowedRefPatterns?.some(p=>new RegExp(p).test(ref));if(!allowed)throw new Error('REPOSITORY_REF_NOT_ALLOWED');}
export function classify(policy:ResolvedRepositoryPolicy,requested?:Classification){return effectiveClassification(policy.classification,requested);}
export function principalForCredential(credential:string|undefined,config:{appMode:'local'|'deployed';authMode:'disabled'|'token';principals:Record<string,{id:string;roles:readonly string[];scopes:readonly string[];maxClassification?:Classification}>}):Principal {if(config.appMode==='local'&&config.authMode==='disabled')return Object.freeze({id:'local-development',roles:Object.freeze(['local']),scopes:Object.freeze(['workflow:create','workflow:run']),authType:'local',maxClassification:'RESTRICTED' as const});const mapped=credential?config.principals[credential]:undefined;if(!mapped)throw new Error('AUTHENTICATION_FAILED');return Object.freeze({id:mapped.id,roles:Object.freeze([...mapped.roles]),scopes:Object.freeze([...mapped.scopes]),authType:'token',maxClassification:mapped.maxClassification});}
function samePrincipal(a:Principal|undefined,b:Principal|undefined){return !!a&&!!b&&a.id===b.id&&a.authType===b.authType&&a.maxClassification===b.maxClassification&&JSON.stringify([...a.roles].sort())===JSON.stringify([...b.roles].sort())&&JSON.stringify([...a.scopes].sort())===JSON.stringify([...b.scopes].sort());}
export function assertWorkflowPrincipal(workflow:{context:unknown},currentPrincipal:Principal){const stored=(workflow.context as any)?.principal as Principal|undefined;if(!samePrincipal(currentPrincipal,stored))throw new Error('AUTHORIZATION_FAILED');}
export function contextFromWorkflow(workflow:{id:string;requestId:string;logicalSpecialistId:string|null;context:unknown;effectiveClassification?:Classification;runtimeId?:string},operation:string,executionType:string,currentPrincipal?:Principal,registry?:Record<string,ResolvedRepositoryPolicy|RepositoryPolicy>){if(!workflow.logicalSpecialistId)throw new Error('ROUTING_REQUIRED');const raw=workflow.context as any;if(currentPrincipal&&raw?.principal&&!samePrincipal(currentPrincipal,raw.principal))throw new Error('AUTHORIZATION_FAILED');const principal=currentPrincipal??raw?.principal as Principal|undefined;const stored=raw?.resolvedRepository as ResolvedRepositoryPolicy|undefined;if(raw?.repositoryId&&stored?.repositoryId&&raw.repositoryId!==stored.repositoryId)throw new Error('REPOSITORY_NOT_ALLOWED');if(raw?.specialistId&&raw.specialistId!==workflow.logicalSpecialistId)throw new Error('AUTHORIZATION_FAILED');const repositoryId=stored?.repositoryId??raw?.repositoryId;const current=registry&&repositoryId?resolveRepository(repositoryId,registry as Record<string,ResolvedRepositoryPolicy>):stored;if(!principal||!current)throw new Error('AUTHORIZATION_FAILED');const approvedRef=stored?.approvedRef;if(approvedRef!==undefined)validateRef(approvedRef,current);const repo=Object.freeze({...current,approvedRef});const duplicateClassifications=[workflow.effectiveClassification,raw?.effectiveClassification,raw?.classification].filter((x):x is Classification=>x!==undefined);if(new Set(duplicateClassifications).size>1)throw new Error('AUTHORIZATION_FAILED');const persisted=duplicateClassifications[0]??'PUBLIC';const effective=effectiveClassification(current.classification,persisted);return freezeContext({principal,operation,requestId:workflow.requestId,workflowId:workflow.id,specialistId:workflow.logicalSpecialistId,executionType,effectiveClassification:effective},repo);}
