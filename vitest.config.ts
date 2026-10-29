import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 20_000,
    // Integration files share one Postgres and reset it between tests, so files run
    // one at a time. Tests inside a file can still fire concurrent requests.
    fileParallelism: false,
    coverage: { provider: 'v8', include: ['src/**'], exclude: ['src/server.ts'] },
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['test/unit/**/*.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          globalSetup: ['./test/global-setup.ts'],
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
