// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import {PgStore} from '../src/pg-store.js';
import {Orchestrator} from '../src/orchestrator.js';
import {registry} from '../src/registry.js';
import {contextFromWorkflow, freezeContext} from '../src/trust.js';

const url = process.env.PG_TEST_URL;
const id = () => crypto.randomUUID();
const repo = {repositoryId: 'repo', source: './repo', classification: 'PUBLIC', allowedCallers: ['caller'], allowedSpecialists: ['architecture-security-advisor'], allowedExecutionTypes: ['specialist', 'codex', 'validation'], allowedRefs: ['main'], approvedRef: 'main'};
const principal = {id: 'caller', roles: ['developer'], scopes: ['run'], authType: 'token'};
const base = (context, validationRequired = false) => ({requestId: id(), workflowType: 'software', logicalSpecialistId: 'architecture-security-advisor', runtimeId: 'runtime', validationRequired, effectiveClassification: 'PUBLIC', objective: 'Task 21 crash recovery', context, requiresImplementation: true});

async function promptReady(store, validationRequired = false) {
  const context = freezeContext({principal, operation: 'create', requestId: id(), specialistId: 'architecture-security-advisor', executionType: 'codex', effectiveClassification: 'PUBLIC'}, repo);
  const workflow = await store.createWorkflow(base(context, validationRequired), 'task21', 'crash');
  await store.addArtifact(workflow.id, 'codex_prompt', {task_summary: 'crash recovery'});
  await store.transitionWorkflow(workflow, 'SPECIALIST_RUNNING', 'test', 'setup');
  await store.transitionWorkflow(workflow, 'SPECIALIST_COMPLETE', 'test', 'setup');
  await store.transitionWorkflow(workflow, 'CODEX_PROMPT_READY', 'test', 'setup');
  return await store.getWorkflow(workflow.id);
}

function executors(store, launch, output = {changedFiles: [], testResults: [], resultSummary: 'ok', exitCode: 0, externalExecutionId: 'codex-crash'}) {
  const codex = {execute: async () => { launch.count++; return {kind: 'success', output, externalExecutionId: output.externalExecutionId}; }};
  const noop = {execute: async () => ({kind: 'success', output: {}})};
  const orchestrator = new Orchestrator(store, noop, noop, codex, noop, {repo});
  return orchestrator;
}

test('PG-16 external start before initiation failure becomes non-retriable ambiguity', {skip: !url}, async () => {
  const store = new PgStore(url);
  const launch = {count: 0};
  const workflow = await promptReady(store);
  const originalRecord = store.recordInitiation.bind(store);
  let injected = false;
  store.recordInitiation = async (...args) => {
    if (!injected) { injected = true; throw new Error('TASK21_INITIATION_PERSISTENCE_FAIL'); }
    return originalRecord(...args);
  };
  const orchestrator = executors(store, launch);
  try {
    await orchestrator.run(workflow.id, contextFromWorkflow(workflow, 'run', 'codex', principal, {repo}), 'pg16-owner');
    assert.equal(launch.count, 1);
    const after = await store.reconstructWorkflow(workflow.id);
    const attempt = after.attempts.find(x => x.logicalStageKey === 'codex');
    const stage = after.stages.find(x => x.logicalStageKey === 'codex');
    assert.equal(after.workflow.status, 'FAILED');
    assert.equal(attempt.state, 'STATUS_UNKNOWN');
    assert.equal(attempt.initiationEvidence, null);
    assert.equal(stage.status, 'FAILED');
    assert.equal(stage.externalExecutionId, null);
    assert.equal(after.artifacts.filter(x => x.artifactType === 'codex_result').length, 0);
    store.recordInitiation = originalRecord;
    await orchestrator.run(workflow.id, contextFromWorkflow(workflow, 'run', 'codex', principal, {repo}), 'pg16-retry');
    assert.equal(launch.count, 1);
    const retry = await store.reconstructWorkflow(workflow.id);
    assert.equal(retry.attempts.length, 1);
    assert.equal(retry.workflow.status, 'FAILED');
  } finally {
    store.recordInitiation = originalRecord;
    await store.pool.end();
  }
});

test('PG-17 durable initiation with missing terminal result does not relaunch', {skip: !url}, async () => {
  const store = new PgStore(url);
  const launch = {count: 0};
  const workflow = await promptReady(store);
  const originalArtifact = store.addArtifact.bind(store);
  let interrupted = false;
  store.addArtifact = async (...args) => {
    if (!interrupted && args[1] === 'codex_result') { interrupted = true; throw new Error('TASK21_TERMINAL_WORKER_STOP'); }
    return originalArtifact(...args);
  };
  const orchestrator = executors(store, launch);
  try {
    await assert.rejects(() => orchestrator.run(workflow.id, contextFromWorkflow(workflow, 'run', 'codex', principal, {repo}), 'pg17-owner'), /TERMINAL_WORKER_STOP/);
    assert.equal(launch.count, 1);
    const knownStarted = await store.reconstructWorkflow(workflow.id);
    const attempt = knownStarted.attempts.find(x => x.logicalStageKey === 'codex');
    assert.equal(knownStarted.workflow.status, 'CODEX_RUNNING');
    assert.equal(attempt.state, 'RUNNING');
    assert.deepEqual(attempt.initiationEvidence, {process: 'codex', terminalObserved: true, externalExecutionId: 'codex-crash'});
    assert.equal(attempt.terminalEvidence, null);
    assert.equal(knownStarted.artifacts.filter(x => x.artifactType === 'codex_result').length, 0);
    store.addArtifact = originalArtifact;
    await orchestrator.run(workflow.id, contextFromWorkflow(workflow, 'run', 'codex', principal, {repo}), 'pg17-retry');
    assert.equal(launch.count, 1);
    const retry = await store.reconstructWorkflow(workflow.id);
    assert.equal(retry.attempts.filter(x => x.logicalStageKey === 'codex').length, 1);
    assert.equal(retry.attempts.find(x => x.logicalStageKey === 'codex').state, 'RUNNING');
  } finally {
    store.addArtifact = originalArtifact;
    await store.pool.end();
  }
});

test('PG-18 terminal persistence failure is retried without external relaunch', {skip: !url}, async () => {
  const store = new PgStore(url);
  const launch = {count: 0};
  const workflow = await promptReady(store);
  const originalConnect = store.pool.connect.bind(store.pool);
  let updated = false;
  let failCommit = true;
  const wrapClient = client => {
    const query = client.query.bind(client);
    client.query = async (...args) => {
      const sql = typeof args[0] === 'string' ? args[0] : args[0].text;
      if (/UPDATE workflow_attempts SET status='SUCCEEDED'/i.test(sql)) updated = true;
      if (sql === 'COMMIT' && updated && failCommit) { failCommit = false; throw new Error('TASK21_TERMINAL_PERSISTENCE_FAIL'); }
      return query(...args);
    };
    return client;
  };
  store.pool.connect = (callback) => {
    if (callback) return originalConnect((error, client, release) => callback(error, error ? undefined : wrapClient(client), release));
    return originalConnect().then(wrapClient);
  };
  const orchestrator = executors(store, launch);
  try {
    await assert.rejects(() => orchestrator.run(workflow.id, contextFromWorkflow(workflow, 'run', 'codex', principal, {repo}), 'pg18-owner'), /TERMINAL_PERSISTENCE_FAIL/);
    assert.equal(launch.count, 1);
    store.pool.connect = originalConnect;
    const failed = await store.reconstructWorkflow(workflow.id);
    const attempt = failed.attempts.find(x => x.logicalStageKey === 'codex');
    const stage = failed.stages.find(x => x.logicalStageKey === 'codex');
    assert.equal(failed.workflow.status, 'CODEX_RUNNING');
    assert.equal(attempt.state, 'RUNNING');
    assert.equal(attempt.initiationEvidence.externalExecutionId, 'codex-crash');
    assert.equal(attempt.terminalEvidence, null);
    assert.equal(stage.status, 'PENDING');
    assert.equal(failed.artifacts.filter(x => x.artifactType === 'codex_result').length, 1);
    const artifact = failed.artifacts.find(x => x.artifactType === 'codex_result');
    await store.completeStage(workflow.id, attempt.id, 'codex-crash', artifact.id, {exitCode: 0}, 'pg18-owner');
    const current = await store.getWorkflow(workflow.id);
    await store.transitionWorkflow(current, 'CODEX_COMPLETE', 'reconciler', 'pg18');
    await store.transitionWorkflow(current, 'COMPLETE', 'reconciler', 'pg18');
    assert.equal(launch.count, 1);
    const final = await store.reconstructWorkflow(workflow.id);
    assert.equal(final.workflow.status, 'COMPLETE');
    assert.equal(final.attempts.filter(x => x.logicalStageKey === 'codex' && x.state === 'SUCCEEDED').length, 1);
    assert.equal(final.attempts.filter(x => x.logicalStageKey === 'codex').length, 1);
  } finally {
    store.pool.connect = originalConnect;
    await store.pool.end();
  }
});

test('PG-24 ambiguous claim acknowledgement re-reads and reuses committed claim', {skip: !url}, async () => {
  const store = new PgStore(url);
  try {
    const workflow = await store.createWorkflow(base({}), 'task21', 'pg24');
    const originalClaim = store.claimStage.bind(store);
    let injected = false;
    store.claimStage = async (...args) => {
      const result = await originalClaim(...args);
      if (!injected) { injected = true; throw new Error('TASK21_CLAIM_ACK_UNKNOWN'); }
      return result;
    };
    await assert.rejects(() => store.claimStage(workflow.id, 'codex:ambiguous', 'codex', undefined, 'pg24-owner'), /CLAIM_ACK_UNKNOWN/);
    store.claimStage = originalClaim;
    const retry = await store.claimStage(workflow.id, 'codex:ambiguous', 'codex', undefined, 'retry-owner');
    assert.equal(retry.existing, true);
    assert.equal(retry.attempt.ownerId, 'pg24-owner');
    const p = await store.reconstructWorkflow(workflow.id);
    assert.equal(p.attempts.length, 1);
    assert.equal(p.attempts[0].ownerId, 'pg24-owner');
    assert.equal(p.events.filter(x => x.eventType === 'STAGE_CLAIMED').length, 1);
  } finally { await store.pool.end(); }
});
