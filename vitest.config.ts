import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
