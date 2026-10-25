import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // services/* run their own node:test suites (pnpm test:agent).
    exclude: [...configDefaults.exclude, 'services/**'],
  },
});
