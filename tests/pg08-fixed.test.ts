// @ts-nocheck
import test from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {PgStore} from '../src/pg-store.js';

const url = process.env.PG_TEST_URL;
const id = () => crypto.randomUUID();
const input = () => ({requestId: id(), workflowType: 'software', logicalSpecialistId: 'architecture-security-advisor', runtimeId: 'runtime', validationRequired: true, effectiveClassification: 'PUBLIC', objective: 'PG-08 deterministic ownership race', context: {}, requiresImplementation: true});

test('PG-08 deterministic PostgreSQL atomic owner predicate race', {skip: !url}, async () => {
  const setup = new PgStore(url);
  const ownerBStore = new PgStore(url);
  const ownerBPool = new Pool({connectionString: url, max: 1});
  const observerPool = new Pool({connectionString: url, max: 1});
  const ownerAPool = new Pool({connectionString: url, max: 1});
  ownerBStore.pool = ownerBPool;
  const trace = [];
  let ownerAClient;
  let observer;
  let ownerBPromise;
  let ownerBBackendPid;
  let ownerBOutcome;
  try {
    const workflow = await setup.createWorkflow(input(), 'task21', 'pg08');
    const claim = await setup.claimStage(workflow.id, 'codex:owner-race', 'codex', undefined, 'owner-a');
    const initial = await setup.pool.query('SELECT status, owner_id AS "ownerId", initiation_evidence AS "initiationEvidence" FROM workflow_attempts WHERE id=$1', [claim.attempt.id]);
    assert.deepEqual(initial.rows[0], {status: 'CLAIMED', ownerId: 'owner-a', initiationEvidence: null});
    trace.push('OWNER_A_AUTHORITATIVE_BEFORE_CONTENTION');

    ownerAClient = await ownerAPool.connect();
    await ownerAClient.query('BEGIN');
    await ownerAClient.query('SELECT id FROM workflow_attempts WHERE id=$1 FOR UPDATE', [claim.attempt.id]);
    trace.push('OWNER_A_ROW_HELD');

    const originalConnect = ownerBPool.connect.bind(ownerBPool);
    ownerBPool.connect = async () => {
      const client = await originalConnect();
      const pid = await client.query('SELECT pg_backend_pid() AS pid');
      ownerBBackendPid = pid.rows[0].pid;
      trace.push(`OWNER_B_SESSION_READY:${ownerBBackendPid}`);
      return client;
    };
    ownerBPromise = ownerBStore.recordInitiation(workflow.id, claim.attempt.id, {externalExecutionId: 'owner-b-must-not-persist'}, 'owner-b');
    ownerBOutcome = ownerBPromise.then(value => ({ok: true, value}), error => ({ok: false, error}));
    trace.push('OWNER_B_MUTATION_STARTED');
    await ownerBOutcome;
    trace.push('OWNER_B_ATOMIC_PREDICATE_EVALUATED');

    observer = await observerPool.connect();
    const activity = await observer.query('SELECT pg_blocking_pids($1::int) AS blockers FROM pg_stat_activity WHERE pid=$1::int', [ownerBBackendPid]);
    assert.equal(activity.rowCount, 1);
    assert.deepEqual(activity.rows[0].blockers, []);
    trace.push('OWNER_B_NOT_BLOCKED_ATOMIC_PREDICATE');
    await ownerAClient.query('COMMIT');
    trace.push('OWNER_A_COMMITTED');
    ownerAClient.release();
    ownerAClient = undefined;

    const ownerBResult = await ownerBOutcome;
    assert.equal(ownerBResult.ok, false);
    assert.match(String(ownerBResult.error), /ATTEMPT_NOT_OWNER/);
    trace.push('OWNER_B_ATTEMPT_NOT_OWNER');
    const ownerAResult = await setup.recordInitiation(workflow.id, claim.attempt.id, {externalExecutionId: 'owner-a-authoritative'}, 'owner-a');
    assert.equal(ownerAResult.ownerId, 'owner-a');
    trace.push('OWNER_A_VALID_MUTATION_CONFIRMED');

    const p = await setup.reconstructWorkflow(workflow.id);
    assert.equal(p.workflow.status, 'ROUTED');
    assert.equal(p.stages.length, 1);
    assert.equal(p.stages[0].status, 'PENDING');
    assert.equal(p.attempts.length, 1);
    assert.equal(p.attempts[0].state, 'RUNNING');
    assert.equal(p.attempts[0].ownerId, 'owner-a');
    assert.deepEqual(p.attempts[0].initiationEvidence, {externalExecutionId: 'owner-a-authoritative'});
    assert.equal(p.attempts[0].terminalEvidence, null);
    assert.equal(p.events.length, 2);
    assert.equal(p.artifacts.length, 0);
    trace.push('FINAL_DB_ASSERTIONS');
    assert.equal(ownerBBackendPid > 0, true);
    assert.deepEqual(trace.map(x => x.split(':')[0]), ['OWNER_A_AUTHORITATIVE_BEFORE_CONTENTION','OWNER_A_ROW_HELD','OWNER_B_MUTATION_STARTED','OWNER_B_SESSION_READY','OWNER_B_ATOMIC_PREDICATE_EVALUATED','OWNER_B_NOT_BLOCKED_ATOMIC_PREDICATE','OWNER_A_COMMITTED','OWNER_B_ATTEMPT_NOT_OWNER','OWNER_A_VALID_MUTATION_CONFIRMED','FINAL_DB_ASSERTIONS']);
  } finally {
    if (ownerAClient) { await ownerAClient.query('ROLLBACK').catch(() => {}); ownerAClient.release(); }
    observer?.release();
    await ownerBPool.end();
    await observerPool.end();
    await ownerAPool.end();
    await setup.pool.end();
  }
});
