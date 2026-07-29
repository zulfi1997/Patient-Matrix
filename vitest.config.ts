import { defineConfig } from 'vitest/config';

// Standalone rather than folded into vite.config.ts: these are pure-logic tests that need neither
// the React nor Tailwind plugin, and the IndexedDB-backed ones run against fake-indexeddb in Node.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    environment: 'node',
  },
});
