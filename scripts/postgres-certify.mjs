import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Client } = pg;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = process.env.PG_TEST_URL;
if (!url) {
  console.error('ERROR: PostgreSQL certification requires PG_TEST_URL');
  process.exit(1);
}

const migrations = readdirSync(join(root, 'db', 'migrations'))
  .filter(file => /^00[1-8]_.*\.sql$/.test(file))
  .sort();
if (migrations.length !== 8 || migrations.some((file, index) => !file.startsWith(`${String(index + 1).padStart(3, '0')}_`))) {
  throw new Error('POSTGRES_CERTIFICATION_MIGRATION_SET_INVALID');
}

async function withClient(connectionString, fn) {
  const client = new Client({ connectionString });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}

const version = await withClient(url, async client => (await client.query('SELECT version()')).rows[0].version);
console.log(`PostgreSQL reachable: ${String(version).split(' on ')[0]}`);

for (const pass of ['initial', 'rerun']) {
  await withClient(url, async client => {
    for (const migration of migrations) {
      await client.query(readFileSync(join(root, 'db', 'migrations', migration), 'utf8'));
      if (pass === 'initial') console.log(`Applied ${migration}`);
    }
  });
  console.log(`Migration ${pass} pass: OK`);
}

await withClient(url, async client => {
  const tables = (await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1::text[])", [['workflows', 'specialists', 'orchestration_plans', 'orchestration_plan_stages', 'artifacts']])).rows;
  if (tables.length !== 5) throw new Error('POSTGRES_CERTIFICATION_SCHEMA_INCOMPLETE');
});
const schemaCheck = spawnSync(process.execPath, ['-e', "import('./dist/src/pg-store.js').then(async ({PgStore})=>{const s=new PgStore(process.env.PG_TEST_URL);await s.verifySchema();await s.pool.end();}).catch(e=>{console.error(e.message);process.exit(1)})"], { cwd: root, env: process.env, encoding: 'utf8' });
if (schemaCheck.status !== 0) throw new Error('POSTGRES_CERTIFICATION_SCHEMA_CHECK_FAILED');
console.log('Application schema verification: OK');

if (process.env.PG_CERT_INCOMPLETE_URL) {
  const incompleteCheck = spawnSync(process.execPath, ['-e', "import('./dist/src/pg-store.js').then(async ({PgStore})=>{const s=new PgStore(process.env.PG_CERT_INCOMPLETE_URL);try{await s.verifySchema();console.error('incomplete schema was accepted');process.exit(1)}catch(e){if(e.message!=='DATABASE_SCHEMA_NOT_READY')throw e}finally{await s.pool.end()}}).catch(e=>{console.error(e.message);process.exit(1)})"], { cwd: root, env: process.env, encoding: 'utf8' });
  if (incompleteCheck.status !== 0) throw new Error('POSTGRES_CERTIFICATION_INCOMPLETE_SCHEMA_CHECK_FAILED');
  console.log('Incomplete schema fail-closed check: OK');
}

const tests = spawnSync(process.execPath, ['--test', 'dist/tests/*.test.js'], { cwd: root, env: process.env, shell: true, stdio: 'inherit' });
if (tests.status !== 0) process.exit(tests.status ?? 1);
console.log('Full PostgreSQL-enabled repository suite: OK');

if (process.env.PG_CERT_RESTORE_URL && process.env.PG_CERT_DUMP_FILE) {
  execFileSync('pg_dump', ['-Fc', '--file', process.env.PG_CERT_DUMP_FILE, url], { stdio: 'inherit' });
  execFileSync('pg_restore', ['--clean', '--if-exists', '--no-owner', '--dbname', process.env.PG_CERT_RESTORE_URL, process.env.PG_CERT_DUMP_FILE], { stdio: 'inherit' });
  const restoredSchemaCheck = spawnSync(process.execPath, ['-e', "import('./dist/src/pg-store.js').then(async ({PgStore})=>{const s=new PgStore(process.env.PG_TEST_URL);await s.verifySchema();await s.pool.end();}).catch(e=>{console.error(e.message);process.exit(1)})"], { cwd: root, env: { ...process.env, PG_TEST_URL: process.env.PG_CERT_RESTORE_URL }, encoding: 'utf8' });
  if (restoredSchemaCheck.status !== 0) throw new Error('POSTGRES_CERTIFICATION_RESTORED_SCHEMA_CHECK_FAILED');
  await withClient(process.env.PG_CERT_RESTORE_URL, async client => {
    const counts = await client.query("SELECT (SELECT count(*) FROM workflows)::int AS workflows, (SELECT count(*) FROM specialists)::int AS specialists, (SELECT count(*) FROM orchestration_plans)::int AS plans, (SELECT count(*) FROM artifacts WHERE artifact_type='multi_specialist_context')::int AS aggregate_artifacts");
    const row = counts.rows[0];
    if (row.workflows < 1 || row.specialists < 1 || row.plans < 1 || row.aggregate_artifacts < 1) throw new Error('POSTGRES_CERTIFICATION_RESTORE_DATA_INCOMPLETE');
    console.log(`Backup/restore validation: OK (${row.workflows} workflows, ${row.specialists} specialists, ${row.plans} plans, ${row.aggregate_artifacts} aggregate artifacts restored)`);
  });
}
