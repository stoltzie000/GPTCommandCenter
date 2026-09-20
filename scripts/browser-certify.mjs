import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

try {
  const { chromium } = await import('playwright');
  if (!existsSync(chromium.executablePath())) {
    console.error('ERROR: browser certification requires an installed Playwright Chromium browser');
    process.exit(1);
  }
} catch {
  console.error('ERROR: browser certification requires the Playwright package and an installed Chromium browser');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', 'dist/tests/task27-browser.acceptance.test.js', 'dist/tests/task29-live-client.integration.test.js'], {
  cwd: process.cwd(),
  env: { ...process.env, REQUIRE_BROWSER_CERTIFICATION: '1' },
  stdio: 'inherit'
});
process.exit(result.status ?? 1);
