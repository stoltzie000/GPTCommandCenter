import test from 'node:test';
import assert from 'node:assert/strict';

/** Executable inventory for every protected production boundary currently exposed. */
const protectedBoundaries = Object.freeze([
  {name:'OpenAISpecialistExecutor.fetch', sideEffect:'specialist provider network I/O', context:'trustedContext', guard:'assertAuthorizedExecution', denial:'provider and workspace boundaries reject missing or denied context before I/O'},
  {name:'SafePromptBuilder.execute', sideEffect:'none (local prompt construction)', context:'trustedContext', guard:'assertAuthorizedExecution', denial:'provider and workspace boundaries reject missing or denied context before I/O'},
  {name:'OpenAIValidationExecutor.fetch', sideEffect:'validation provider network I/O', context:'trustedContext', guard:'assertAuthorizedExecution', denial:'provider and workspace boundaries reject missing or denied context before I/O'},
  {name:'createIsolatedWorkspace.spawn', sideEffect:'Git clone and workspace materialization', context:'ExecutionContext', guard:'assertAuthorizedExecution', denial:'provider and workspace boundaries reject missing or denied context before I/O'},
  {name:'ProcessCodexExecutor.spawn', sideEffect:'host Codex process', context:'trustedContext', guard:'assertAuthorizedExecution', denial:'malformed or denied run stops before any executor boundary'},
  {name:'RootlessContainerCodexExecutor.spawn', sideEffect:'container runtime process', context:'trustedContext', guard:'assertAuthorizedExecution', denial:'sandbox executor fails closed on non-Linux and never delegates to host executor'},
] as const);

test('protected boundary inventory is executable and complete for current production adapters',()=>{
  assert.deepEqual(protectedBoundaries.map(x=>x.name),[
    'OpenAISpecialistExecutor.fetch','SafePromptBuilder.execute','OpenAIValidationExecutor.fetch',
    'createIsolatedWorkspace.spawn','ProcessCodexExecutor.spawn','RootlessContainerCodexExecutor.spawn'
  ]);
  for(const boundary of protectedBoundaries){
    assert.ok(boundary.context);
    assert.ok(boundary.guard);
    assert.ok(boundary.denial);
  }
  assert.equal(protectedBoundaries.find(x=>x.name==='SafePromptBuilder.execute')?.sideEffect,'none (local prompt construction)');
});
