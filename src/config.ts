export type AppMode='local'|'deployed';
export type AuthMode='disabled'|'token';
export type SpecialistInventoryProviderName='none'|'file';
import { Classification, RepositoryPolicy } from './authorization.js';

export interface Config { appMode:AppMode; authMode:AuthMode; apiToken?:string; databaseUrl?:string; workspaceRoot:string; repositories:Record<string,RepositoryPolicy>; principals:Record<string,{id:string;roles:readonly string[];scopes:readonly string[];maxClassification?:Classification}>; specialistInventoryProvider:SpecialistInventoryProviderName; specialistInventoryFile?:string; }
const classifications=['PUBLIC','INTERNAL','CONFIDENTIAL','RESTRICTED'] as const;
const isRecord=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const strings=(value:unknown)=>Array.isArray(value)&&value.every(item=>typeof item==='string'&&item.length>0);

function parsePolicies(value:unknown):Record<string,RepositoryPolicy>{
  if(!isRecord(value))throw new Error('INVALID_CONFIGURATION');
  const result:Record<string,RepositoryPolicy>={};
  for(const [id,raw] of Object.entries(value)){
    if(!id||!isRecord(raw)||typeof raw.source!=='string'||!raw.source.trim()||!classifications.includes(raw.classification as any))throw new Error('INVALID_CONFIGURATION');
    for(const key of ['allowedCallers','allowedSpecialists','allowedExecutionTypes','allowedRefs','allowedRefPatterns'])if(raw[key]!==undefined&&!strings(raw[key]))throw new Error('INVALID_CONFIGURATION');
    if(Array.isArray(raw.allowedRefPatterns))for(const pattern of raw.allowedRefPatterns){try{new RegExp(pattern);}catch{throw new Error('INVALID_CONFIGURATION');}}
    result[id]={source:raw.source,classification:raw.classification as Classification,...raw.allowedCallers!==undefined?{allowedCallers:raw.allowedCallers as string[]}: {},...raw.allowedSpecialists!==undefined?{allowedSpecialists:raw.allowedSpecialists as string[]}: {},...raw.allowedExecutionTypes!==undefined?{allowedExecutionTypes:raw.allowedExecutionTypes as string[]}: {},...raw.allowedRefs!==undefined?{allowedRefs:raw.allowedRefs as string[]}: {},...raw.allowedRefPatterns!==undefined?{allowedRefPatterns:raw.allowedRefPatterns as string[]}: {}};
  }
  return result;
}

function parsePrincipals(value:unknown):Config['principals']{
  if(!isRecord(value))throw new Error('INVALID_CONFIGURATION');
  const result:Config['principals']={};
  for(const [credential,raw] of Object.entries(value)){
    if(!credential||!isRecord(raw)||typeof raw.id!=='string'||!raw.id.trim()||!strings(raw.roles)||!strings(raw.scopes)||(raw.maxClassification!==undefined&&!classifications.includes(raw.maxClassification as any)))throw new Error('INVALID_CONFIGURATION');
    result[credential]={id:raw.id,roles:raw.roles as string[],scopes:raw.scopes as string[],...(raw.maxClassification!==undefined?{maxClassification:raw.maxClassification as Classification}:{})};
  }
  return result;
}

export function loadConfig(env=process.env):Config {
  if(!env.APP_MODE||!env.APP_MODE.trim())throw new Error('INVALID_CONFIGURATION');
  const appMode=env.APP_MODE as AppMode;
  const authMode=(env.AUTH_MODE??(appMode==='local'?'disabled':'token')) as AuthMode;
  const specialistInventoryProvider=(env.SPECIALIST_INVENTORY_PROVIDER??'none') as SpecialistInventoryProviderName;
  const specialistInventoryFile=env.SPECIALIST_INVENTORY_FILE;
  if(!['local','deployed'].includes(appMode)||!['disabled','token'].includes(authMode)||!['none','file'].includes(specialistInventoryProvider))throw new Error('INVALID_CONFIGURATION');
  if(specialistInventoryProvider==='file'&&(!specialistInventoryFile||!specialistInventoryFile.trim()))throw new Error('INVALID_CONFIGURATION');
  if(appMode==='deployed'&&authMode!=='token')throw new Error('AUTHENTICATION_REQUIRED');
  if(authMode==='token'&&(!env.ORCHESTRATOR_API_TOKEN||!env.ORCHESTRATOR_API_TOKEN.trim()))throw new Error('AUTHENTICATION_REQUIRED');
  if(appMode==='deployed'&&(!env.DATABASE_URL||!env.DATABASE_URL.trim()))throw new Error('DATABASE_REQUIRED');
  let rawRepositories:unknown,rawPrincipals:unknown;
  try{rawRepositories=JSON.parse(env.ALLOWED_REPOSITORIES??'{}');rawPrincipals=JSON.parse(env.AUTH_PRINCIPALS??'{}');}catch{throw new Error('INVALID_CONFIGURATION');}
  const repositories=parsePolicies(rawRepositories);const principals=parsePrincipals(rawPrincipals);
  if(authMode==='token'&&(!Object.keys(principals).length||!principals[env.ORCHESTRATOR_API_TOKEN!]))throw new Error('AUTHENTICATION_REQUIRED');
  return {appMode,authMode,apiToken:env.ORCHESTRATOR_API_TOKEN,databaseUrl:env.DATABASE_URL,workspaceRoot:env.WORKSPACE_ROOT?.trim()||'./workspaces',repositories,principals,specialistInventoryProvider,specialistInventoryFile};
}
