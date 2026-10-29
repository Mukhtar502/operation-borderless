import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Integration files share one Postgres and reset it between tests, so they run
    // one file at a time. Tests inside a file can still fire concurrent requests.
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 20_000,
    coverage: { provider: 'v8', include: ['src/**'], exclude: ['src/server.ts'] },
  },
});
