import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'apps/**/*.test.ts',
      'apps/**/*.spec.ts',
      'packages/**/*.test.ts',
      'database/**/*.test.mjs',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**', '**/*.mongodb.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['apps/*/src/**/*.ts', 'packages/*/src/**/*.ts'],
      exclude: ['**/*.d.ts', '**/main.ts', '**/generated/**'],
      thresholds: {
        statements: 35,
        branches: 30,
        functions: 30,
        lines: 35,
        'packages/domain/src/**': {
          statements: 90,
          branches: 85,
          functions: 90,
          lines: 90,
        },
        'apps/api/src/idempotency/idempotency.service.ts': {
          statements: 75,
          branches: 65,
          functions: 95,
          lines: 75,
        },
        'apps/worker/src/outbox-worker.ts': {
          statements: 70,
          branches: 50,
          functions: 75,
          lines: 70,
        },
      },
    },
  },
});
