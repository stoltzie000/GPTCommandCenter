import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const client = readFileSync(resolve(process.cwd(), 'client', 'app.js'), 'utf8');
const html = readFileSync(resolve(process.cwd(), 'client', 'index.html'), 'utf8');

test('Task 26 client submits only the public workflow intake contract', () => {
  assert.match(client, /fetch\(path/);
  assert.match(client, /objective/);
  assert.match(client, /repository/);
  assert.doesNotMatch(client, /requested_specialist/);
  assert.doesNotMatch(client, /runtimeId|allowedSpecialists|CODEX_ENABLED|DATABASE_URL/);
});

test('Task 26 client exposes authoritative workflow interactions', () => {
  for (const route of ['/clarification', '/clarification-response', '/approval', '/handoff', '/events', '/result', '/run', '/recover']) assert.ok(client.includes(route), `missing route ${route}`);
  assert.match(client, /returnEndpoint/);
  assert.match(client, /orchestrationPlan/);
  assert.match(client, /setInterval\(refresh/);
  assert.match(client, /MANUAL_HANDOFF_REQUIRED/);
});

test('Task 26 client treats custom GPT URLs as safe navigation only', () => {
  assert.match(client, /target = '_blank'/);
  assert.match(client, /noopener noreferrer/);
  assert.match(client, /does not transfer data or return output automatically/);
  assert.doesNotMatch(client, /eval\(|localStorage|sessionStorage/);
  assert.match(html, /session token.*kept in memory only/i);
});

test('Task 26 client does not expose unsupported stage-level manual return as working', () => {
  assert.match(client, /Stage-level return is not supported/);
  assert.match(client, /externally supplied/);
  assert.match(client, /workflowId/);
});
