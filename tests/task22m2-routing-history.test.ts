import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MemoryStore } from '../src/store.js';
import { readRoutingDecisions } from '../src/routing-history-read-model.js';
import { RoutingDecision } from '../src/domain.js';

const id = () => randomUUID();
const decision = (workflowId: string, overrides: Partial<RoutingDecision> = {}): RoutingDecision => ({
  id: id(), workflowId, selectedSpecialistId: 'architecture-security-advisor', routingConfidence: 'CLEAR',
  routingReason: 'internal ownership evidence', decisionType: 'INITIAL', supersedesDecisionId: null,
  createdAt: new Date().toISOString(), ...overrides
});
const workflowInput = (requestId = id()) => ({requestId,workflowType:'non_code' as const,logicalSpecialistId:null,validationRequired:false,effectiveClassification:'PUBLIC' as const,objective:'routing history',context:{},requiresImplementation:false});

test('22M2-01 initial routing history is exposed as a public-safe persisted read model', async () => {
  const store = new MemoryStore(); const workflow = store.createWorkflow(workflowInput());
  const initial = decision(workflow.id); await store.recordRoutingDecision(initial);
  const result = await readRoutingDecisions(store, workflow.id);
  assert.deepEqual(result.map(x => x.id), [initial.id]);
  assert.equal(result[0].decisionType, 'INITIAL'); assert.equal(result[0].routingConfidence, 'CLEAR');
  assert.equal(result[0].selectedSpecialistId, initial.selectedSpecialistId); assert.equal(result[0].current, true);
  assert.equal(result[0].explanation, 'The selected specialist was established by the initial routing decision.');
  assert.doesNotMatch(result[0].explanation, /internal ownership evidence/);
});

test('22M2-02 history preserves superseded decisions and identifies current authority', async () => {
  const store = new MemoryStore(); const workflow = store.createWorkflow(workflowInput());
  const initial = decision(workflow.id, {createdAt:'2026-09-15T00:00:00.000Z'});
  const clarified = decision(workflow.id, {id:id(),decisionType:'POST_CLARIFICATION',routingConfidence:'PROBABLE',supersedesDecisionId:initial.id,createdAt:'2026-09-15T00:00:01.000Z'});
  await store.recordRoutingDecision(initial); await store.recordRoutingDecision(clarified);
  const result = await readRoutingDecisions(store, workflow.id);
  assert.deepEqual(result.map(x => x.id), [initial.id, clarified.id]); assert.equal(result[0].current, false); assert.equal(result[1].current, true);
  assert.equal(result[1].supersedesDecisionId, initial.id); assert.equal(result[1].explanation, 'Routing was updated after clarification.');
});

test('22M2-03 user override history is additive and does not mutate registry ownership', async () => {
  const store = new MemoryStore(); const workflow = store.createWorkflow({...workflowInput(),logicalSpecialistId:'previous-specialist'});
  const initial = decision(workflow.id, {selectedSpecialistId:'previous-specialist'}); await store.recordRoutingDecision(initial);
  const result = await store.applyUserOverride(workflow.id, 'architecture-security-advisor', 'use approved owner');
  const history = await readRoutingDecisions(store, workflow.id);
  assert.equal(result.decision.decisionType, 'USER_OVERRIDE'); assert.deepEqual(history.map(x => x.decisionType), ['INITIAL','USER_OVERRIDE']);
  assert.equal(history[1].supersedesDecisionId, initial.id); assert.equal(history[1].current, true);
  assert.equal(history[1].explanation, 'A user override selected the specialist for this workflow.');
});

test('22M2-04 ambiguous and post-clarification decisions remain truthful without hidden reasoning', async () => {
  const store = new MemoryStore(); const workflow = store.createWorkflow(workflowInput());
  const ambiguous = decision(workflow.id, {selectedSpecialistId:null,routingConfidence:'AMBIGUOUS',routingReason:'candidate A versus candidate B'});
  const resolved = decision(workflow.id, {decisionType:'POST_CLARIFICATION',routingConfidence:'PROBABLE',supersedesDecisionId:ambiguous.id,createdAt:new Date(Date.now()+1).toISOString()});
  await store.recordRoutingDecision(ambiguous); await store.recordRoutingDecision(resolved);
  const history = await readRoutingDecisions(store, workflow.id);
  assert.equal(history[0].explanation, 'Multiple possible owners remained; clarification was required.');
  assert.equal(history[1].current, true); assert.doesNotMatch(history[0].explanation, /candidate A|candidate B/);
});

test('22M2-05 no-match history retains a nullable specialist', async () => {
  const store = new MemoryStore(); const workflow = store.createWorkflow(workflowInput());
  const noMatch = decision(workflow.id, {selectedSpecialistId:null,routingConfidence:'NO_MATCH',decisionType:'FALLBACK'});
  await store.recordRoutingDecision(noMatch); const [result] = await readRoutingDecisions(store, workflow.id);
  assert.equal(result.selectedSpecialistId, null); assert.equal(result.explanation, 'No approved specialist matched the request.');
});

test('22M2-06 ordering is deterministic and 22M2-08 history reads are side-effect free', async () => {
  const store = new MemoryStore(); const workflow = store.createWorkflow(workflowInput());
  const later = decision(workflow.id, {createdAt:'2026-09-15T00:00:02.000Z'});
  const earlier = decision(workflow.id, {id:id(),createdAt:'2026-09-15T00:00:01.000Z'});
  await store.recordRoutingDecision(later); await store.recordRoutingDecision(earlier);
  const before = JSON.stringify({workflow:await store.getWorkflow(workflow.id),decisions:[...store.routingDecisions],events:store.getEvents(workflow.id),attempts:store.getAttempts(workflow.id)});
  const result = await readRoutingDecisions(store, workflow.id);
  const after = JSON.stringify({workflow:await store.getWorkflow(workflow.id),decisions:[...store.routingDecisions],events:store.getEvents(workflow.id),attempts:store.getAttempts(workflow.id)});
  assert.deepEqual(result.map(x => x.id), [earlier.id, later.id]); assert.equal(before, after);
});

test('22M2-07 unknown workflow has no routing-history read model', async () => {
  const store = new MemoryStore(); assert.deepEqual(await readRoutingDecisions(store, id()), []);
});

test('22M2-08 routing-history mapper uses persisted records without routing recomputation', async () => {
  let reads = 0;
  const store = {getRoutingHistory: async (workflowId: string) => { reads++; return [decision(workflowId)]; }} as any;
  const result = await readRoutingDecisions(store, 'persisted-workflow');
  assert.equal(reads, 1); assert.equal(result[0].workflowId, 'persisted-workflow');
});
