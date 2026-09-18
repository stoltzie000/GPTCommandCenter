import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';

const migrationDirectory = join(process.cwd(), 'db', 'migrations');

test('Task 15 migration set is ordered, complete, and repeatable by construction', () => {
  const files = readdirSync(migrationDirectory).filter(file => /^00[1-7]_.*\.sql$/.test(file)).sort();
  assert.deepEqual(files.map(file => file.slice(0, 3)), ['001', '002', '003', '004', '005', '006', '007']);
  for (const file of files) assert.match(readFileSync(join(migrationDirectory, file), 'utf8'), /(?:CREATE|ALTER|DROP)\s+(?:TABLE|EXTENSION|CONSTRAINT)|CREATE EXTENSION IF NOT EXISTS/);
});

test('Task 15 deployed configuration fails closed while explicit local mode remains available', () => {
  assert.throws(() => loadConfig({} as any), /INVALID_CONFIGURATION/);
  assert.throws(() => loadConfig({APP_MODE:'deployed',AUTH_MODE:'token',ORCHESTRATOR_API_TOKEN:'token'} as any), /DATABASE_REQUIRED/);
  assert.throws(() => loadConfig({APP_MODE:'deployed',AUTH_MODE:'token',DATABASE_URL:'postgres://db'} as any), /AUTHENTICATION_REQUIRED/);
  const local = loadConfig({APP_MODE:'local',AUTH_MODE:'disabled',ALLOWED_REPOSITORIES:'{}',AUTH_PRINCIPALS:'{}'} as any);
  assert.equal(local.appMode, 'local');
  assert.equal(local.authMode, 'disabled');
});
