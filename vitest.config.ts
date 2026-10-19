import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'jsdom',
    passWithNoTests: true,
    // jsdom + fake-indexeddb integration tests can be CPU/memory intensive.
    // Bound worker fan-out to avoid unrelated 5s timeouts when many files run together.
    maxWorkers: 3,
    testTimeout: 15000,
  },
});
