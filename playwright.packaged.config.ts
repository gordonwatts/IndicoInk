import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /packaged\.spec\.ts/,
  workers: 1,
  timeout: 120_000,
  use: {
    trace: 'on-first-retry',
  },
});
