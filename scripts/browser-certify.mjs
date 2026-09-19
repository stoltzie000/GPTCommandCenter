import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['--test', 'dist/tests/task27-browser.acceptance.test.js'], {
  cwd: process.cwd(),
  env: { ...process.env, REQUIRE_BROWSER_CERTIFICATION: '1' },
  stdio: 'inherit'
});
process.exit(result.status ?? 1);
