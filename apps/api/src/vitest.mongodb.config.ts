import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.mongodb.test.ts'],
    testTimeout: 45_000,
    hookTimeout: 45_000,
    fileParallelism: false,
  },
});
