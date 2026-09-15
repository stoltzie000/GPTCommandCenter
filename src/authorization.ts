export type Classification='PUBLIC'|'INTERNAL'|'CONFIDENTIAL'|'RESTRICTED';
const rank:Record<Classification,number>={PUBLIC:0,INTERNAL:1,CONFIDENTIAL:2,RESTRICTED:3};
export interface RepositoryPolicy{readonly source:string;readonly classification:Classification;readonly allowedCallers?:readonly string[];readonly allowedSpecialists?:readonly string[];readonly allowedExecutionTypes?:readonly string[];readonly allowedRefs?:readonly string[];readonly allowedRefPatterns?:readonly string[];}
export interface AuthorizationInput{caller:string;operation:string;specialistId:string;repositoryId?:string;executionType:string;dataClassification:Classification;principalMaxClassification?:Classification;repository?:RepositoryPolicy;}
export interface CreationAuthorizationInput{caller:string;operation:'create';repositoryId?:string;executionType:string;dataClassification:Classification;principalMaxClassification?:Classification;repository?:RepositoryPolicy;}
export function effectiveClassification(server:Classification,requested?:Classification){if(!requested)return server;return rank[requested]>=rank[server]?requested:server;}
export function authorize(i:AuthorizationInput){if(!i.caller||!i.operation||!['create','run','prompt-build','validate'].includes(i.operation)||!i.specialistId||!i.dataClassification)throw new Error('AUTHORIZATION_FAILED');if(i.principalMaxClassification&&rank[i.dataClassification]>rank[i.principalMaxClassification])throw new Error('AUTHORIZATION_FAILED');const p=i.repository;if(p){if(i.repositoryId&&'repositoryId' in p&&i.repositoryId!==(p as RepositoryPolicy&{repositoryId?:string}).repositoryId)throw new Error('AUTHORIZATION_FAILED');if(p.allowedCallers&&!p.allowedCallers.includes(i.caller))throw new Error('AUTHORIZATION_FAILED');if(p.allowedSpecialists&&!p.allowedSpecialists.includes(i.specialistId))throw new Error('AUTHORIZATION_FAILED');if(p.allowedExecutionTypes&&!p.allowedExecutionTypes.includes(i.executionType))throw new Error('AUTHORIZATION_FAILED');if(rank[i.dataClassification]<rank[p.classification])throw new Error('AUTHORIZATION_FAILED');}else if(i.executionType==='codex')throw new Error('REPOSITORY_NOT_ALLOWED');return true;}

export function authorizeCreation(i:CreationAuthorizationInput){
  if(!i.caller||i.operation!=='create'||!i.executionType||!i.dataClassification)throw new Error('AUTHORIZATION_FAILED');
  if(i.principalMaxClassification&&rank[i.dataClassification]>rank[i.principalMaxClassification])throw new Error('AUTHORIZATION_FAILED');
  const p=i.repository;
  if(p){
    if(i.repositoryId&&'repositoryId' in p&&i.repositoryId!==(p as RepositoryPolicy&{repositoryId?:string}).repositoryId)throw new Error('AUTHORIZATION_FAILED');
    if(p.allowedCallers&&!p.allowedCallers.includes(i.caller))throw new Error('AUTHORIZATION_FAILED');
    if(p.allowedExecutionTypes&&!p.allowedExecutionTypes.includes(i.executionType))throw new Error('AUTHORIZATION_FAILED');
    if(rank[i.dataClassification]<rank[p.classification])throw new Error('AUTHORIZATION_FAILED');
  }else if(i.executionType==='codex')throw new Error('REPOSITORY_NOT_ALLOWED');
  return true;
}
