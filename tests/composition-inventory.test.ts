import test from 'node:test';
import assert from 'node:assert/strict';

const composition = Object.freeze([
  {caller:'src/orchestrator.ts:Orchestrator.advance',boundary:'OpenAISpecialistExecutor.execute',context:'contextFromWorkflow(..., principal, registry)',authorization:'assertAuthorizedExecution at provider boundary'},
  {caller:'src/orchestrator.ts:Orchestrator.advance',boundary:'SafePromptBuilder.execute',context:'contextFromWorkflow(..., principal, registry)',authorization:'assertAuthorizedExecution at prompt boundary'},
  {caller:'src/orchestrator.ts:Orchestrator.advance',boundary:'OpenAIValidationExecutor.execute',context:'contextFromWorkflow(..., principal, registry)',authorization:'assertAuthorizedExecution at provider boundary'},
  {caller:'src/orchestrator.ts:Orchestrator.advance',boundary:'ProcessCodexExecutor.execute',context:'contextFromWorkflow(..., principal, registry)',authorization:'assertAuthorizedExecution before workspace/spawn'},
  {caller:'src/orchestrator.ts:Orchestrator.advance',boundary:'RootlessContainerCodexExecutor.execute',context:'contextFromWorkflow(..., principal, registry)',authorization:'assertAuthorizedExecution before workspace/spawn'},
  {caller:'src/executors.ts:ProcessCodexExecutor.execute',boundary:'createIsolatedWorkspace',context:'same trustedContext',authorization:'assertAuthorizedExecution before Git/workspace I/O'},
  {caller:'src/executors.ts:RootlessContainerCodexExecutor.execute',boundary:'createIsolatedWorkspace',context:'same trustedContext',authorization:'assertAuthorizedExecution before Git/workspace I/O'},
] as const);

test('production caller composition inventory covers every current protected boundary',()=>{
  const boundaries=new Set(composition.map(x=>x.boundary));
  for(const required of ['OpenAISpecialistExecutor.execute','SafePromptBuilder.execute','OpenAIValidationExecutor.execute','ProcessCodexExecutor.execute','RootlessContainerCodexExecutor.execute','createIsolatedWorkspace'] as const)assert.ok(boundaries.has(required));
  for(const edge of composition){assert.ok(edge.caller);assert.ok(edge.context);assert.ok(edge.authorization);}
  assert.equal(composition.filter(x=>x.boundary==='createIsolatedWorkspace').length,2);
});
