import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests only; integration lives in vitest.integration.config.ts and
    // needs Docker, so it must never run implicitly.
    include: ['src/**/*.test.ts'],
    exclude: ['src/**/*.integration.test.ts', '**/node_modules/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/server.ts', 'src/openapi-emit.ts'],
    },
  },
});
