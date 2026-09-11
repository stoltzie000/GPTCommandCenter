import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContainerSpec } from '../src/executors.js';

test('container command is explicit, isolated, and does not inherit secrets',()=>{
  const spec=buildContainerSpec('docker','codex-image','C:/approved/workspace','$(bad); --privileged');
  assert.equal(spec.command,'docker');
  assert.equal(spec.shell,false);
  for(const flag of ['--rm','--read-only','--network','none','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128','--cpus','2','--memory','2g'])assert.ok(spec.args.includes(flag),flag);
  assert.equal(spec.args.filter(x=>x.startsWith('--mount')).length,1);
  assert.ok(spec.args.includes('type=bind,src=C:/approved/workspace,dst=/workspace,rw'));
  assert.equal(spec.args.includes('$(bad); --privileged'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(spec.env,'DB_SECRET'),false);
});
