import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FileSpecialistInventoryProvider,
  createSpecialistInventoryProvider
} from '../src/specialist-inventory.js';

import { loadConfig } from '../src/config.js';

test('Task 22J file inventory provider loads valid specialists', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gptcc-inventory-'));
  const path = join(dir, 'inventory.json');

  await writeFile(path, JSON.stringify([
    {
      specialistId: 'alpha',
      displayName: 'Alpha',
      chatgptUrl: 'https://example.test/alpha',
      identityKey: 'alpha-key'
    },
    {
      displayName: 'Unidentified Specialist'
    }
  ]));

  const result = await new FileSpecialistInventoryProvider(path).discover();

  assert.equal(result.status, 'AVAILABLE');

  if (result.status === 'AVAILABLE') {
    assert.equal(result.specialists.length, 2);
    assert.equal(result.specialists[0].specialistId, 'alpha');
    assert.equal(result.specialists[0].displayName, 'Alpha');
    assert.equal(result.specialists[1].specialistId, undefined);
  }
});

test('Task 22J file inventory provider fails closed for malformed JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gptcc-inventory-'));
  const path = join(dir, 'inventory.json');

  await writeFile(path, '{not-json');

  const result = await new FileSpecialistInventoryProvider(path).discover();

  assert.equal(result.status, 'UNAVAILABLE');
});

test('Task 22J file inventory provider rejects malformed specialist records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gptcc-inventory-'));
  const path = join(dir, 'inventory.json');

  await writeFile(path, JSON.stringify([
    { specialistId: 'alpha' }
  ]));

  const result = await new FileSpecialistInventoryProvider(path).discover();

  assert.equal(result.status, 'UNAVAILABLE');
});

test('Task 22J missing inventory file fails closed', async () => {
  const result = await new FileSpecialistInventoryProvider(
    '/definitely/not/a/real/inventory.json'
  ).discover();

  assert.equal(result.status, 'UNAVAILABLE');
});

test('Task 22J provider factory returns file provider when configured', () => {
  const provider = createSpecialistInventoryProvider(
    'file',
    '/tmp/inventory.json'
  );

  assert.ok(provider instanceof FileSpecialistInventoryProvider);
});

test('Task 22J config accepts file inventory with a configured path', () => {
  const config = loadConfig({
    APP_MODE: 'local',
    AUTH_MODE: 'disabled',
    SPECIALIST_INVENTORY_PROVIDER: 'file',
    SPECIALIST_INVENTORY_FILE: '/tmp/inventory.json'
  });

  assert.equal(config.specialistInventoryProvider, 'file');
  assert.equal(config.specialistInventoryFile, '/tmp/inventory.json');
});

test('Task 22J config rejects file inventory without a path', () => {
  assert.throws(
    () => loadConfig({
      APP_MODE: 'local',
      AUTH_MODE: 'disabled',
      SPECIALIST_INVENTORY_PROVIDER: 'file'
    }),
    /INVALID_CONFIGURATION/
  );
});

test('Task 22J config rejects unknown inventory providers', () => {
  assert.throws(
    () => loadConfig({
      APP_MODE: 'local',
      AUTH_MODE: 'disabled',
      SPECIALIST_INVENTORY_PROVIDER: 'bogus'
    }),
    /INVALID_CONFIGURATION/
  );
});

test('Task 22J public reconciliation status omits discovery metadata', async () => {
  const { reconcileRegistry, publicRegistryReconciliationStatus } =
    await import('../src/registry-reconciliation.js');

  const result = reconcileRegistry(
    {},
    {
      status: 'AVAILABLE',
      source: 'test',
      observedAt: '2026-09-15T00:00:00.000Z',
      specialists: [{
        specialistId: 'new-specialist',
        displayName: 'New Specialist',
        chatgptUrl: 'https://sensitive.example.test/internal',
        navigationMetadata: {
          href: '/private/navigation/path'
        }
      }]
    }
  );

  const publicStatus = publicRegistryReconciliationStatus(result);

  assert.equal(publicStatus.freshness, 'VERIFIED');
  assert.equal(publicStatus.approvedRegistryChanged, false);
  assert.equal(publicStatus.outcomes.length, 1);
  assert.equal(publicStatus.outcomes[0].status, 'NEW_UNREVIEWED');
  assert.equal(publicStatus.outcomes[0].routable, false);

  assert.equal(
    Object.prototype.hasOwnProperty.call(publicStatus.outcomes[0], 'discovered'),
    false
  );
});

test('Task 22J public status preserves provider unavailability', async () => {
  const { reconcileRegistry, publicRegistryReconciliationStatus } =
    await import('../src/registry-reconciliation.js');

  const result = reconcileRegistry(
    {},
    {
      status: 'UNAVAILABLE',
      source: 'test',
      observedAt: '2026-09-15T00:00:00.000Z',
      reason: 'offline'
    }
  );

  const publicStatus = publicRegistryReconciliationStatus(result);

  assert.equal(publicStatus.freshness, 'UNVERIFIED');
  assert.equal(publicStatus.outcomes[0].status, 'PROVIDER_UNAVAILABLE');
  assert.equal(publicStatus.outcomes[0].routable, false);
});
