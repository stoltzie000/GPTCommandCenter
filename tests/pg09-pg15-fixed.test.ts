// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {PgStore} from '../src/pg-store.js';
import {Orchestrator} from '../src/orchestrator.js';
import {registry} from '../src/registry.js';
import {contextFromWorkflow, freezeContext} from '../src/trust.js';

const url = process.env.PG_TEST_URL;
const id = () => crypto.randomUUID();
const repo = {repositoryId: 'repo', source: './repo', classification: 'PUBLIC', allowedCallers: ['caller'], allowedSpecialists: ['architecture-security-advisor'], allowedExecutionTypes: ['specialist', 'codex', 'validation'], allowedRefs: ['main'], approvedRef: 'main'};
const principal = {id: 'caller', roles: ['developer'], scopes: ['run'], authType: 'token'};
const base = (context = {}) => ({requestId: id(), workflowType: 'software', logicalSpecialistId: 'architecture-security-advisor', runtimeId: 'runtime', validationRequired: true, effectiveClassification: 'PUBLIC', objective: 'Task 21 reliability', context, requiresImplementation: true});

async function observeBlocked(observer, pid) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const q = await observer.query('SELECT pg_blocking_pids($1::int) AS blockers FROM pg_stat_activity WHERE pid=$1::int', [pid]);
    if (q.rowCount === 1 && q.rows[0].blockers.length > 0) return q.rows[0].blockers;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`PG_BLOCKING_NOT_OBSERVED:${pid}`);
}

async function preparePromptReady(store) {
  const creationContext = freezeContext({principal, operation: 'create', requestId: id(), specialistId: 'architecture-security-advisor', executionType: 'codex', effectiveClassification: 'PUBLIC'}, repo);
  const workflow = await store.createWorkflow(base(creationContext), 'task21', 'pg15');
  await store.transitionWorkflow(workflow, 'SPECIALIST_RUNNING', 'test', 'setup');
  await store.transitionWorkflow(workflow, 'SPECIALIST_COMPLETE', 'test', 'setup');
  await store.addArtifact(workflow.id, 'codex_prompt', {task_summary: 'pg15'});
  await store.transitionWorkflow(workflow, 'CODEX_PROMPT_READY', 'test', 'setup');
  return await store.getWorkflow(workflow.id);
}

test('PG-09 rejects stale illegal transition after PostgreSQL serialization', {skip: !url}, async () => {
  const setup = new PgStore(url);
  const ownerA = new Pool({connectionString: url, max: 1});
  const ownerBPool = new Pool({connectionString: url, max: 1});
  const observerPool = new Pool({connectionString: url, max: 1});
  const ownerB = new PgStore(url);
  ownerB.pool = ownerBPool;
  let holder;
  let observer;
  let bOutcome;
  let bPid;
  let pidReadyResolve;
  const pidReady = new Promise(resolve => pidReadyResolve = resolve);
  try {
    const workflow = await setup.createWorkflow(base(), 'task21', 'pg09');
    holder = await ownerA.connect();
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM workflows WHERE id=$1 FOR UPDATE', [workflow.id]);

    const originalConnect = ownerBPool.connect.bind(ownerBPool);
    ownerBPool.connect = async () => {
      const client = await originalConnect();
      const pid = await client.query('SELECT pg_backend_pid() AS pid');
      bPid = pid.rows[0].pid;
      pidReadyResolve();
      return client;
    };
    const stale = await setup.getWorkflow(workflow.id);
    const bPromise = ownerB.transitionWorkflow(stale, 'SPECIALIST_COMPLETE', 'stale-writer', 'owner-b');
    bOutcome = bPromise.then(value => ({ok: true, value}), error => ({ok: false, error}));
    await pidReady;
    observer = await observerPool.connect();
    const blockers = await observeBlocked(observer, bPid);
    assert.ok(blockers.length > 0);
    await holder.query('COMMIT');
    holder.release();
    holder = undefined;
    const result = await bOutcome;
    assert.equal(result.ok, false);
    assert.match(String(result.error), /INVALID_STATE_TRANSITION/);

    const projection = await setup.reconstructWorkflow(workflow.id);
    assert.equal(projection.workflow.status, 'ROUTED');
    assert.equal(projection.stages.length, 0);
    assert.equal(projection.attempts.length, 0);
    assert.equal(projection.artifacts.length, 0);
    assert.equal(projection.events.length, 1);
  } finally {
    if (holder) { await holder.query('ROLLBACK').catch(() => {}); holder.release(); }
    if (bOutcome) await bOutcome.catch(() => {});
    observer?.release();
    await ownerBPool.end();
    await observerPool.end();
    await ownerA.end();
    await setup.pool.end();
  }
});

test('PG-09 rejects all required illegal transition cases', {skip: !url}, async () => {
  const store = new PgStore(url);
  try {
    for (const target of ['SPECIALIST_COMPLETE', 'CODEX_COMPLETE']) {
      const workflow = await store.createWorkflow(base(), 'task21', `pg09-${target}`);
      await assert.rejects(() => store.transitionWorkflow(workflow, target, 'invalid', 'test'), /INVALID_STATE_TRANSITION/);
      const p = await store.reconstructWorkflow(workflow.id);
      assert.equal(p.workflow.status, 'ROUTED');
      assert.equal(p.events.length, 1);
      assert.equal(p.stages.length, 0);
      assert.equal(p.attempts.length, 0);
      assert.equal(p.artifacts.length, 0);
    }
    const workflow = await store.createWorkflow(base(), 'task21', 'pg09-prompt-ready');
    await store.transitionWorkflow(workflow, 'SPECIALIST_RUNNING', 'test', 'legal');
    await store.transitionWorkflow(workflow, 'SPECIALIST_COMPLETE', 'test', 'legal');
    await store.transitionWorkflow(workflow, 'CODEX_PROMPT_READY', 'test', 'legal');
    await assert.rejects(() => store.transitionWorkflow(workflow, 'CODEX_COMPLETE', 'invalid', 'test'), /INVALID_STATE_TRANSITION/);
    const p = await store.reconstructWorkflow(workflow.id);
    assert.equal(p.workflow.status, 'CODEX_PROMPT_READY');
    assert.equal(p.events.length, 4);
    assert.equal(p.stages.length, 0);
    assert.equal(p.attempts.length, 0);
    assert.equal(p.artifacts.length, 0);
  } finally { await store.pool.end(); }
});

test('PG-15 committed claim before executor invocation remains truthful', {skip: !url}, async () => {
  const store = new PgStore(url);
  const oldStatus = registry['architecture-security-advisor'].runtime?.status;
  if (registry['architecture-security-advisor'].runtime) registry['architecture-security-advisor'].runtime.status = 'ACTIVE';
  let launches = 0;
  let claimCommitted = false;
  const workflow = await preparePromptReady(store);
  const originalClaim = store.claimStage.bind(store);
  store.claimStage = async (...args) => {
    const result = await originalClaim(...args);
    if (args[1] === 'codex') {
      claimCommitted = true;
      throw new Error('TASK21_PRE_EXECUTION_STOP');
    }
    return result;
  };
  const codex = {execute: async () => { launches++; return {kind: 'success', output: {exitCode: 0}, externalExecutionId: 'must-not-start'}; }};
  const noop = {execute: async () => ({kind: 'success', output: {}})};
  const orchestrator = new Orchestrator(store, noop, noop, codex, noop, {repo});
  try {
    const runContext = contextFromWorkflow(workflow, 'run', 'codex', principal, {repo});
    await assert.rejects(() => orchestrator.run(workflow.id, runContext, 'pg15-owner'), /TASK21_PRE_EXECUTION_STOP/);
    assert.equal(claimCommitted, true);
    assert.equal(launches, 0);
    const interrupted = await store.reconstructWorkflow(workflow.id);
    const attempt = interrupted.attempts.find(x => x.logicalStageKey === 'codex');
    const stage = interrupted.stages.find(x => x.logicalStageKey === 'codex');
    assert.equal(interrupted.workflow.status, 'CODEX_PROMPT_READY');
    assert.equal(attempt.state, 'CLAIMED');
    assert.equal(attempt.ownerId, 'pg15-owner');
    assert.equal(attempt.initiationEvidence, null);
    assert.equal(stage.status, 'PENDING');
    assert.equal(stage.externalExecutionId, null);
    assert.equal(interrupted.artifacts.filter(x => x.artifactType === 'codex_result').length, 0);
    assert.equal(interrupted.events.filter(x => /CODEX_RUNNING|CODEX_COMPLETE/.test(x.eventType)).length, 0);

    store.claimStage = originalClaim;
    const retry = await orchestrator.run(workflow.id, contextFromWorkflow(workflow, 'run', 'codex', principal, {repo}), 'pg15-retry');
    assert.equal(retry.status, 'CODEX_PROMPT_READY');
    assert.equal(launches, 0);
    const final = await store.reconstructWorkflow(workflow.id);
    assert.equal(final.attempts.filter(x => x.logicalStageKey === 'codex').length, 1);
    assert.equal(final.attempts.find(x => x.logicalStageKey === 'codex').state, 'CLAIMED');
    assert.equal(final.artifacts.filter(x => x.artifactType === 'codex_result').length, 0);
  } finally {
    store.claimStage = originalClaim;
    if (registry['architecture-security-advisor'].runtime) registry['architecture-security-advisor'].runtime.status = oldStatus;
    await store.pool.end();
  }
});
